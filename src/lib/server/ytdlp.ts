import { transcribeYouTubeVideo } from './whisper';

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

export async function getVideoInfo(
	url: string
): Promise<{ title: string; duration: number; thumbnail: string }> {
	const videoId = extractVideoId(url);
	if (!videoId) throw new Error('Invalid YouTube URL');

	// Use YouTube oEmbed API (no API key needed). Duration isn't available
	// from oEmbed — we get it later from ffprobe after downloading audio.
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

/**
 * Get SRT captions for a YouTube video.
 *
 * Historically this called yt-dlp to fetch YouTube's auto-generated XML
 * captions. YouTube has been aggressively blocking that endpoint from
 * many IPs, so we now transcribe the audio locally with Whisper (or via
 * an OpenAI-compatible Whisper API).
 *
 * Kept as a thin wrapper around `transcribeYouTubeVideo` so older callers
 * don't need to change.
 */
export async function downloadSubtitlesOnly(
	videoId: string,
	_url: string
): Promise<{ subsText: string }> {
	const { srt } = await transcribeYouTubeVideo(videoId);
	if (!srt.trim()) {
		throw new Error('Transcription produced no captions — audio may be silent or unavailable.');
	}
	return { subsText: srt };
}
