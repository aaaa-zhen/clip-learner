export function extractVideoId(url: string): string | null {
	const patterns = [
		/(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
		/(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
		/(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
		/(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
	];
	for (const pattern of patterns) {
		const match = url.match(pattern);
		if (match) return match[1];
	}
	return null;
}

export async function getVideoInfo(url: string): Promise<{ title: string; duration: number; thumbnail: string }> {
	const videoId = extractVideoId(url);
	if (!videoId) throw new Error('Invalid YouTube URL');

	// Use YouTube oEmbed API (no API key needed)
	const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
	const res = await fetch(oembedUrl);
	if (!res.ok) throw new Error('Failed to fetch video info');
	const data = await res.json();

	return {
		title: data.title || 'Unknown',
		duration: 0,
		thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
	};
}

export async function downloadSubtitlesOnly(videoId: string, _url: string): Promise<{ subsText: string }> {
	const { execFile } = await import('child_process');
	const { promisify } = await import('util');
	const { mkdtempSync, readFileSync, readdirSync, rmSync } = await import('fs');
	const { tmpdir } = await import('os');
	const { join } = await import('path');
	const execFileAsync = promisify(execFile);

	const tmpDir = mkdtempSync(join(tmpdir(), 'subs-'));

	try {
		// Try manual English subs first, then auto-generated
		for (const args of [
			['--skip-download', '--write-subs', '--sub-lang', 'en', '--sub-format', 'srv3', '-o', join(tmpDir, 'subs'), `https://www.youtube.com/watch?v=${videoId}`],
			['--skip-download', '--write-auto-subs', '--sub-lang', 'en,en-GB,en-US,en-en-GB', '--sub-format', 'srv3', '-o', join(tmpDir, 'subs'), `https://www.youtube.com/watch?v=${videoId}`],
		]) {
			try {
				await execFileAsync('yt-dlp', args, { timeout: 30000 });
			} catch { /* ignore errors, check if file was written */ }

			const files = readdirSync(tmpDir).filter(f => f.endsWith('.srv3'));
			for (const file of files) {
				const xml = readFileSync(join(tmpDir, file), 'utf-8');
				const srtText = xmlToSrt(xml);
				if (srtText.trim()) return { subsText: srtText };
				// parsed empty — delete and try next format
				rmSync(join(tmpDir, file));
			}
		}

		throw new Error('No captions available for this video. Try a video with subtitles/auto-captions enabled.');
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

function xmlToSrt(xml: string): string {
	const segments: string[] = [];
	const regex = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>(.*?)<\/text>/gs;
	let match;
	let index = 1;

	while ((match = regex.exec(xml)) !== null) {
		const start = parseFloat(match[1]);
		const dur = parseFloat(match[2]);
		const end = start + dur;
		let text = match[3]
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/<[^>]+>/g, '')
			.trim();

		if (!text) continue;

		segments.push(
			`${index}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`
		);
		index++;
	}

	return segments.join('\n');
}

function formatSrtTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const ms = Math.round((seconds % 1) * 1000);
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
