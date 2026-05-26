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

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { getSettings, getLangConfig, isUsingSharedKey } from './claude';
import {
	spawnCapture, sleep, runYtdlpWithRetries, baseYtdlpArgs,
	hasCookiesFile, isAuthRequiredError, isCookiesExpiredError,
	YTDLP_COOKIES
} from './ytdlp-utils';

// --- config -------------------------------------------------------------

const WHISPER_MODEL = env.WHISPER_MODEL || 'whisper-1';
const WHISPER_LOCAL_MODEL = env.WHISPER_LOCAL_MODEL || 'tiny.en';
const CHUNK_SECONDS = Number(env.WHISPER_CHUNK_SECONDS || 10 * 60);
const MAX_PARALLEL_CHUNKS = Number(env.WHISPER_MAX_PARALLEL_CHUNKS || 2);
const MAX_RETRIES = 5;
const WHISPER_REQUEST_TIMEOUT_MS = Number(env.WHISPER_REQUEST_TIMEOUT_MS || 300_000);

function normalizeOpenAIBaseUrl(value: string): string {
	const trimmed = value.replace(/\/+$/, '');
	return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/** Resolve Whisper API credentials: user settings first, then env vars. */
async function getWhisperConfig(userId?: number): Promise<{ apiKey: string; baseUrl: string }> {
	// Only use user's own API key if they explicitly configured one (not the shared server key)
	if (userId && !(await isUsingSharedKey(userId))) {
		const settings = await getSettings(userId);
		if (settings.api_key) {
			const baseUrl = normalizeOpenAIBaseUrl(settings.base_url || 'https://aihubmix.com');
			return { apiKey: settings.api_key, baseUrl };
		}
	}
	// Fall back to server-side env vars (Groq Whisper key)
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

function buildAudioArgs(url: string, outPath: string, useCookies: boolean): string[] {
	return [
		...baseYtdlpArgs(useCookies),
		'-f', 'bestaudio[ext=m4a]/bestaudio',
		'-x', '--audio-format', 'mp3',
		'-o', outPath,
		url
	];
}

async function downloadAudioMp3(url: string, outPath: string): Promise<void> {
	const hasCookies = await hasCookiesFile();

	// Phase 1: try without cookies first (most videos don't need them)
	try {
		await runYtdlpWithRetries(buildAudioArgs(url, outPath, false));
		return;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (!isAuthRequiredError(message)) {
			throw err;
		}
		console.warn('[yt-dlp] auth required, will retry with cookies');
	}

	// Phase 2: auth required — retry with cookies
	if (!hasCookies) {
		throw new Error(
			'YouTube requires login verification for this video but no cookies.txt file was found. ' +
			'Please upload YouTube cookies via Settings to process this video.'
		);
	}

	try {
		await runYtdlpWithRetries(buildAudioArgs(url, outPath, true));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (isCookiesExpiredError(message) || isAuthRequiredError(message)) {
			throw new Error(
				'YouTube cookies have expired. Please re-export and upload fresh cookies via Settings to process this video.'
			);
		}
		throw err;
	}
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
	baseUrl: string,
	whisperLang: string = 'en'
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
		form.append('language', whisperLang);

		const resp = await fetch(`${baseUrl}/audio/transcriptions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}` },
			body: form,
			signal: AbortSignal.timeout(WHISPER_REQUEST_TIMEOUT_MS)
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

async function transcribeViaOpenAI(audioPath: string, tmpDir: string, apiKey: string, baseUrl: string, whisperLang: string = 'en'): Promise<TranscribeResult> {
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
		const segs = await transcribeChunkOpenAI(spec.path, apiKey, baseUrl, whisperLang);
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
	tmpDir: string,
	whisperLang: string = 'en'
): Promise<TranscribeResult> {
	await spawnCapture('whisper', [
		audioPath,
		'--model',
		WHISPER_LOCAL_MODEL,
		'--language',
		whisperLang,
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
 * @param url full video URL (YouTube, X/Twitter, or any yt-dlp supported site)
 * @param progress optional callbacks to report stage transitions
 */
export async function transcribeYouTubeVideo(
	url: string,
	progress: TranscribeProgress = {},
	userId?: number
): Promise<TranscribeResult> {
	const safeId = url.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
	const dir = await mkdtemp(path.join(tmpdir(), `clip-ws-${safeId}-`));
	const audioPath = path.join(dir, 'audio.mp3');

	try {
		await downloadAudioMp3(url, path.join(dir, 'audio.%(ext)s'));
		const audioStat = await stat(audioPath).catch(() => null);
		const duration = audioStat ? await ffprobeDuration(audioPath) : null;
		progress.onAudioDownloaded?.(duration);

		progress.onTranscribeStart?.();
		const whisperCfg = await getWhisperConfig(userId);
		const userSettings = userId ? await getSettings(userId) : null;
		const whisperLang = getLangConfig(userSettings?.target_language || 'english').whisperCode;
		if (whisperCfg.apiKey) {
			return await transcribeViaOpenAI(audioPath, dir, whisperCfg.apiKey, whisperCfg.baseUrl, whisperLang);
		} else {
			return await transcribeViaLocalWhisper(audioPath, dir, whisperLang);
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

/**
 * Transcribe an already-downloaded audio file (e.g. extracted client-side
 * from a local video and uploaded to the server as mp3).
 * Unlike transcribeYouTubeVideo, this skips the yt-dlp download step.
 */
export async function transcribeAudioFile(
	audioPath: string,
	userId?: number
): Promise<TranscribeResult> {
	const dir = await mkdtemp(path.join(tmpdir(), 'clip-upload-'));
	try {
		const whisperCfg = await getWhisperConfig(userId);
		const userSettings = userId ? await getSettings(userId) : null;
		const whisperLang = getLangConfig(userSettings?.target_language || 'english').whisperCode;
		if (whisperCfg.apiKey) {
			return await transcribeViaOpenAI(audioPath, dir, whisperCfg.apiKey, whisperCfg.baseUrl, whisperLang);
		} else {
			return await transcribeViaLocalWhisper(audioPath, dir, whisperLang);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
