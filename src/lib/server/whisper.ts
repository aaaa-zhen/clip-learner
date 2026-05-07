/**
 * Whisper transcription pipeline.
 *
 * Replaces the yt-dlp caption fetcher that YouTube has been aggressively
 * rate-limiting / IP-blocking. We download the audio (which uses a
 * completely different code path on YouTube's side) and transcribe it
 * locally or through an OpenAI-compatible Whisper API.
 *
 * Engine selection:
 *   - If WHISPER_API_KEY is set → OpenAI-compatible API (fast, paid)
 *   - Otherwise → local `whisper` CLI (free, slow; needs whisper on PATH)
 *
 * Output: SRT-formatted text, so the existing `parseSrt` pipeline in
 * analysis.ts continues to work unchanged.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// SvelteKit's dynamic env accessor — reads .env in dev and real env in prod.
// process.env doesn't pick up .env reliably under `vite dev`, so go through
// this instead.
import { env } from '$env/dynamic/private';
import { getSettings } from './claude';

// --- config -------------------------------------------------------------

const WHISPER_MODEL = env.WHISPER_MODEL || 'whisper-1';
const WHISPER_LOCAL_MODEL = env.WHISPER_LOCAL_MODEL || 'tiny.en';
const CHUNK_SECONDS = Number(env.WHISPER_CHUNK_SECONDS || 10 * 60);
const MAX_PARALLEL_CHUNKS = Number(env.WHISPER_MAX_PARALLEL_CHUNKS || 2);
const MAX_RETRIES = 5;

function normalizeOpenAIBaseUrl(value: string): string {
	const trimmed = value.replace(/\/+$/, '');
	return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/** Resolve Whisper API credentials: user settings first, then env vars. */
async function getWhisperConfig(userId?: number): Promise<{ apiKey: string; baseUrl: string }> {
	// Try user's own API key (same key they use for LLM)
	if (userId) {
		const settings = await getSettings(userId);
		if (settings.api_key) {
			const baseUrl = normalizeOpenAIBaseUrl(settings.base_url || 'https://aihubmix.com');
			return { apiKey: settings.api_key, baseUrl };
		}
	}
	// Fall back to server-side env vars
	const apiKey = env.WHISPER_API_KEY || '';
	const baseUrl = normalizeOpenAIBaseUrl(env.WHISPER_BASE_URL || 'https://api.openai.com/v1');
	return { apiKey, baseUrl };
}

// --- types --------------------------------------------------------------

export interface TranscribeProgress {
	onAudioDownloaded?: (durationSeconds: number | null) => void;
	onTranscribeStart?: () => void;
}

export interface TranscribeResult {
	srt: string;
	durationSeconds: number | null;
}

// --- utilities ----------------------------------------------------------

function spawnCapture(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args);
		let stdout = '';
		let stderr = '';
		proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
		proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
		proc.on('error', reject);
		proc.on('close', (code) => {
			if (code === 0) resolve({ stdout, stderr });
			else
				reject(
					new Error(
						`${cmd} exited ${code}: ${(stderr || stdout).slice(-600).trim() || 'no output'}`
					)
				);
		});
	});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Convert seconds to an SRT timestamp like "00:01:23,456". */
function toSrtTimestamp(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
	const total = Math.floor(seconds * 1000);
	const ms = total % 1000;
	const totalSec = Math.floor(total / 1000);
	const s = totalSec % 60;
	const totalMin = Math.floor(totalSec / 60);
	const m = totalMin % 60;
	const h = Math.floor(totalMin / 60);
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function cuesToSrt(cues: Array<{ start: number; end: number; text: string }>): string {
	const blocks: string[] = [];
	cues.forEach((c, i) => {
		const text = c.text?.trim();
		if (!text || !(c.end > c.start)) return;
		blocks.push(`${i + 1}\n${toSrtTimestamp(c.start)} --> ${toSrtTimestamp(c.end)}\n${text}`);
	});
	return blocks.join('\n\n') + '\n';
}

// --- audio download (yt-dlp) -------------------------------------------

/** Path to a Netscape-format cookies.txt file for yt-dlp. */
const YTDLP_COOKIES = env.YTDLP_COOKIES || path.join(process.cwd(), 'cookies.txt');
/** Optional HTTP/SOCKS proxy for yt-dlp (e.g. socks5://127.0.0.1:1080). */
const YTDLP_PROXY = env.YTDLP_PROXY || '';

async function downloadAudioMp3(videoId: string, outPath: string): Promise<void> {
	const args = [
		'-f',
		'bestaudio[ext=m4a]/bestaudio',
		'-x',
		'--audio-format',
		'mp3',
		'-o',
		outPath,
		`https://www.youtube.com/watch?v=${videoId}`
	];

	// If a proxy is configured, route yt-dlp through it to avoid IP bans.
	if (YTDLP_PROXY) {
		args.unshift('--proxy', YTDLP_PROXY);
	}

	// If a cookies file exists, pass it to yt-dlp to bypass YouTube bot detection.
	try {
		await stat(YTDLP_COOKIES);
		args.unshift('--cookies', YTDLP_COOKIES);
	} catch {
		// No cookies file — proceed without
	}

	await spawnCapture('yt-dlp', args);
}

async function ffprobeDuration(filePath: string): Promise<number | null> {
	try {
		const { stdout } = await spawnCapture('ffprobe', [
			'-v',
			'error',
			'-show_entries',
			'format=duration',
			'-of',
			'default=noprint_wrappers=1:nokey=1',
			filePath
		]);
		const n = parseFloat(stdout.trim());
		return Number.isFinite(n) ? n : null;
	} catch {
		return null;
	}
}

async function sliceToSpeechMp3(
	srcPath: string,
	startSec: number,
	durSec: number,
	dstPath: string
): Promise<void> {
	await spawnCapture('ffmpeg', [
		'-y',
		'-hide_banner',
		'-loglevel',
		'error',
		'-ss',
		String(startSec),
		'-t',
		String(durSec),
		'-i',
		srcPath,
		'-ac',
		'1',
		'-ar',
		'16000',
		'-b:a',
		'48k',
		dstPath
	]);
}

// --- OpenAI-compatible Whisper API --------------------------------------

function retryDelayFromResponse(resp: Response, bodyText: string): number | null {
	const header = resp.headers.get('retry-after');
	if (header) {
		const n = parseFloat(header);
		if (Number.isFinite(n)) return Math.max(1000, n * 1000);
	}
	const m = /retry after (\d+(?:\.\d+)?)\s*seconds?/i.exec(bodyText || '');
	if (m) return Math.max(1000, parseFloat(m[1]) * 1000);
	return null;
}

function isRateLimited(resp: Response, bodyText: string): boolean {
	if (resp.status === 429) return true;
	return /RateLimitReached|rate limit/i.test(bodyText || '');
}

async function transcribeChunkOpenAI(
	chunkPath: string,
	apiKey: string,
	baseUrl: string
): Promise<
	Array<{ start: number; end: number; text: string }>
> {
	let attempt = 0;
	while (true) {
		const blob = await openAsBlob(chunkPath);
		const form = new FormData();
		form.append('file', blob, path.basename(chunkPath));
		form.append('model', WHISPER_MODEL);
		form.append('response_format', 'verbose_json');
		form.append('language', 'en');

		const resp = await fetch(`${baseUrl}/audio/transcriptions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}` },
			body: form
		});

		const text = await resp.text();
		let data: any = null;
		try {
			data = JSON.parse(text);
		} catch {}

		if (resp.ok) {
			const segs = Array.isArray(data?.segments) ? data.segments : [];
			return segs.map((s: any) => ({
				start: Number(s.start) || 0,
				end: Number(s.end) || 0,
				text: String(s.text || '').replace(/\s+/g, ' ').trim()
			}));
		}

		if (isRateLimited(resp, text) && attempt < MAX_RETRIES) {
			const hinted = retryDelayFromResponse(resp, text);
			const backoff = Math.round(1000 * Math.pow(2, attempt) + Math.random() * 500);
			await sleep(hinted ?? backoff);
			attempt++;
			continue;
		}

		const msg = data?.error?.message || text.slice(0, 300);
		throw new Error(`Whisper API ${resp.status}: ${msg}`);
	}
}

async function runWithLimit<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
	const results: T[] = new Array(tasks.length);
	let next = 0;
	const worker = async () => {
		while (true) {
			const i = next++;
			if (i >= tasks.length) return;
			results[i] = await tasks[i]();
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
	return results;
}

async function transcribeViaOpenAI(audioPath: string, tmpDir: string, apiKey: string, baseUrl: string): Promise<TranscribeResult> {
	const totalDuration = (await ffprobeDuration(audioPath)) ?? 0;
	const numChunks = Math.max(1, Math.ceil(totalDuration / CHUNK_SECONDS));

	const chunkSpecs: Array<{ path: string; offsetSec: number }> = [];
	for (let i = 0; i < numChunks; i++) {
		const start = i * CHUNK_SECONDS;
		const dur = Math.min(CHUNK_SECONDS, Math.max(1, totalDuration - start));
		const chunkPath = path.join(tmpDir, `chunk-${i}.mp3`);
		await sliceToSpeechMp3(audioPath, start, dur, chunkPath);
		chunkSpecs.push({ path: chunkPath, offsetSec: start });
	}

	const tasks = chunkSpecs.map((spec) => async () => {
		const segs = await transcribeChunkOpenAI(spec.path, apiKey, baseUrl);
		return segs.map((s) => ({
			start: s.start + spec.offsetSec,
			end: s.end + spec.offsetSec,
			text: s.text
		}));
	});

	const chunkResults = await runWithLimit(tasks, MAX_PARALLEL_CHUNKS);
	const cues = chunkResults.flat().filter((c) => c.text && c.end > c.start);
	cues.sort((a, b) => a.start - b.start);

	return { srt: cuesToSrt(cues), durationSeconds: totalDuration || null };
}

// --- local whisper CLI --------------------------------------------------

async function transcribeViaLocalWhisper(
	audioPath: string,
	tmpDir: string
): Promise<TranscribeResult> {
	await spawnCapture('whisper', [
		audioPath,
		'--model',
		WHISPER_LOCAL_MODEL,
		'--language',
		'en',
		'--output_format',
		'json',
		'--output_dir',
		tmpDir,
		'--verbose',
		'False'
	]);
	const baseName = path.basename(audioPath, path.extname(audioPath));
	const raw = await readFile(path.join(tmpDir, `${baseName}.json`), 'utf8');
	const data = JSON.parse(raw);
	const cues = (data.segments || [])
		.map((s: any) => ({
			start: Number(s.start) || 0,
			end: Number(s.end) || 0,
			text: String(s.text || '').replace(/\s+/g, ' ').trim()
		}))
		.filter((c: any) => c.text && c.end > c.start);
	const totalDuration = (await ffprobeDuration(audioPath)) ?? null;
	return { srt: cuesToSrt(cues), durationSeconds: totalDuration };
}

// --- public entry -------------------------------------------------------

/**
 * Download audio + transcribe. Returns SRT text ready for the existing
 * parseSrt() pipeline.
 *
 * @param videoId 11-char YouTube video id
 * @param progress optional callbacks to report stage transitions
 */
export async function transcribeYouTubeVideo(
	videoId: string,
	progress: TranscribeProgress = {},
	userId?: number
): Promise<TranscribeResult> {
	const dir = await mkdtemp(path.join(tmpdir(), `clip-ws-${videoId}-`));
	const audioPath = path.join(dir, 'audio.mp3');

	try {
		await downloadAudioMp3(videoId, path.join(dir, 'audio.%(ext)s'));
		const audioStat = await stat(audioPath).catch(() => null);
		const duration = audioStat ? await ffprobeDuration(audioPath) : null;
		progress.onAudioDownloaded?.(duration);

		progress.onTranscribeStart?.();
		const whisperCfg = await getWhisperConfig(userId);
		if (whisperCfg.apiKey) {
			return await transcribeViaOpenAI(audioPath, dir, whisperCfg.apiKey, whisperCfg.baseUrl);
		} else {
			return await transcribeViaLocalWhisper(audioPath, dir);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/**
 * Rough estimate for how long transcription will take (seconds).
 * Used to display an ETA while the job runs.
 */
export function estimateTranscribeSeconds(videoDurationSeconds: number): number {
	if (!Number.isFinite(videoDurationSeconds) || videoDurationSeconds <= 0) return 60;
	// Audio download + parallel chunked API calls. Very rough.
	const chunks = Math.ceil(videoDurationSeconds / CHUNK_SECONDS);
	const batches = Math.ceil(chunks / MAX_PARALLEL_CHUNKS);
	const download = Math.max(15, videoDurationSeconds * 0.05);
	const transcribe = batches * 20; // ~20s per batch incl. upload
	return Math.round(download + transcribe);
}

/** Human-readable description of the active engine, for status/logs. */
export async function whisperEngineDescription(userId?: number): Promise<string> {
	const cfg = await getWhisperConfig(userId);
	return cfg.apiKey
		? `OpenAI-compatible Whisper API (${cfg.baseUrl}, model=${WHISPER_MODEL})`
		: `local whisper CLI (model=${WHISPER_LOCAL_MODEL})`;
}
