/**
 * Shared yt-dlp configuration, retry logic, and helpers.
 * Used by both whisper.ts (audio download) and api/download (video download).
 */

import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';

// --- config --------------------------------------------------------------

/** Path to a Netscape-format cookies.txt file for yt-dlp. */
export const YTDLP_COOKIES = env.YTDLP_COOKIES || path.join(process.cwd(), 'cookies.txt');
/** Optional HTTP/SOCKS proxy for yt-dlp (e.g. socks5://127.0.0.1:1080). */
export const YTDLP_PROXY = env.YTDLP_PROXY || '';
/** Many VPS networks have flaky or blocked IPv6 routes to YouTube. */
export const YTDLP_FORCE_IPV4 = env.YTDLP_FORCE_IPV4 !== 'false';
/** Last-resort workaround for broken TLS interception/proxies. */
export const YTDLP_NO_CHECK_CERTIFICATE = env.YTDLP_NO_CHECK_CERTIFICATE === 'true';
/** Enables yt-dlp's YouTube JS challenge solver distribution. */
export const YTDLP_REMOTE_COMPONENTS = env.YTDLP_REMOTE_COMPONENTS || 'ejs:github';
/** Full yt-dlp process retries for transient TLS EOF / connection reset errors. */
export const YTDLP_PROCESS_RETRIES = Number(env.YTDLP_PROCESS_RETRIES || 3);

// --- utilities -----------------------------------------------------------

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function spawnCapture(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
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

export function isTransientYtdlpError(message: string): boolean {
	return /UNEXPECTED_EOF_WHILE_READING|SSLError|TLS|timed out|Connection reset|Remote end closed connection/i.test(message);
}

export async function runYtdlpWithRetries(args: string[]): Promise<void> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= YTDLP_PROCESS_RETRIES; attempt++) {
		try {
			await spawnCapture('yt-dlp', args);
			return;
		} catch (err) {
			lastError = err;
			const message = err instanceof Error ? err.message : String(err);
			if (!isTransientYtdlpError(message) || attempt === YTDLP_PROCESS_RETRIES) {
				throw err;
			}
			console.warn(`[yt-dlp] transient failure, retrying (${attempt}/${YTDLP_PROCESS_RETRIES}): ${message.slice(-240)}`);
			await sleep(1500 * attempt);
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Build the common base args shared by all yt-dlp invocations. */
export function baseYtdlpArgs(useCookies?: boolean): string[] {
	const args = [
		'--retries', '10',
		'--fragment-retries', '10',
		'--extractor-retries', '5',
		'--socket-timeout', '30',
		'--remote-components', YTDLP_REMOTE_COMPONENTS
	];

	if (YTDLP_FORCE_IPV4) args.unshift('--force-ipv4');
	if (YTDLP_NO_CHECK_CERTIFICATE) args.unshift('--no-check-certificate');
	if (YTDLP_PROXY) args.unshift('--proxy', YTDLP_PROXY);
	if (useCookies) args.unshift('--cookies', YTDLP_COOKIES);

	return args;
}

/** Check whether cookies.txt exists on disk. */
export function hasCookiesFile(): Promise<boolean> {
	return stat(YTDLP_COOKIES).then(() => true, () => false);
}

export function isAuthRequiredError(message: string): boolean {
	return /Sign in to confirm|confirm you're not a bot|login required/i.test(message);
}

export function isCookiesExpiredError(message: string): boolean {
	return /cookies are no longer valid|cookies have expired|cookies.*rotated/i.test(message);
}
