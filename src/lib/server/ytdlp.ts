import { spawn } from 'node:child_process';
import crypto from 'crypto';

export type VideoSource = 'youtube' | 'twitter' | 'other';

export interface VideoInfo {
	title: string;
	duration: number;
	thumbnail: string;
	source: VideoSource;
	videoId: string; // stable unique ID for dedup
}

const YOUTUBE_RE = /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/(?:embed|shorts)\/)([a-zA-Z0-9_-]{11})/;
const TWITTER_RE = /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/;

export function extractVideoId(url: string): string | null {
	const yt = url.match(YOUTUBE_RE);
	if (yt) return yt[1];
	const tw = url.match(TWITTER_RE);
	if (tw) return tw[1];
	return null;
}

export function detectSource(url: string): VideoSource {
	if (YOUTUBE_RE.test(url)) return 'youtube';
	if (TWITTER_RE.test(url)) return 'twitter';
	return 'other';
}

export function isSupportedUrl(url: string): boolean {
	try {
		const u = new URL(url);
		return extractVideoId(url) !== null || ['twitter.com','x.com','youtube.com','youtu.be'].includes(u.hostname.replace('www.',''));
	} catch {
		return false;
	}
}

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
			else reject(new Error(`${cmd} exited ${code}: ${(stderr || stdout).slice(-600).trim()}`));
		});
	});
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
	const source = detectSource(url);
	const rawId = extractVideoId(url);

	if (source === 'youtube' && rawId) {
		// YouTube: use oEmbed (no API key, fast)
		try {
			const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${rawId}&format=json`;
			const res = await fetch(oembedUrl);
			if (res.ok) {
				const data = await res.json();
				return {
					title: data.title || 'Unknown',
					duration: 0,
					thumbnail: `https://i.ytimg.com/vi/${rawId}/hqdefault.jpg`,
					source,
					videoId: rawId
				};
			}
		} catch {}
	}

	// Fallback: use yt-dlp --dump-json for title/thumbnail (works for X and others)
	try {
		const { stdout } = await spawnCapture('yt-dlp', ['--dump-json', '--no-download', url]);
		const data = JSON.parse(stdout.trim());
		const videoId = rawId || data.id || crypto.randomUUID();
		return {
			title: data.title || data.description?.slice(0, 80) || 'Video',
			duration: data.duration || 0,
			thumbnail: data.thumbnail || '',
			source,
			videoId
		};
	} catch {
		// Last resort: generate a random ID so the episode can still be created
		return {
			title: 'Video',
			duration: 0,
			thumbnail: '',
			source,
			videoId: rawId || crypto.randomUUID()
		};
	}
}

export async function downloadSubtitlesOnly(
	_videoId: string,
	_url: string
): Promise<{ subsText: string }> {
	throw new Error('Use transcribeYouTubeVideo directly');
}
