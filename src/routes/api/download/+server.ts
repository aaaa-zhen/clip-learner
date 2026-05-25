import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';
import { extractVideoId } from '$lib/server/ytdlp';
import fs from 'fs';
import path from 'path';
import {
	spawnCapture, baseYtdlpArgs, runYtdlpWithRetries
} from '$lib/server/ytdlp-utils';

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	const { episodeId } = await request.json();

	if (!episodeId) {
		return json({ error: 'episodeId is required' }, { status: 400 });
	}

	const { rows: [episode] } = await query(
		'SELECT * FROM episodes WHERE id = $1 AND user_id = $2', [episodeId, userId]
	);

	if (!episode) {
		return json({ error: 'Episode not found' }, { status: 404 });
	}

	// Already downloaded
	if (episode.video_path && fs.existsSync(episode.video_path)) {
		return json({ status: 'ready', path: `/media/${episodeId}/video.mp4` });
	}

	// Check if yt-dlp is available
	try {
		await spawnCapture('yt-dlp', ['--version']);
	} catch {
		return json({ error: 'yt-dlp is not installed on this server' }, { status: 501 });
	}

	const videoId =
		typeof episode.video_id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(episode.video_id)
			? episode.video_id
			: extractVideoId(String(episode.url || ''));
	if (!videoId) {
		return json({ error: 'Episode does not have a valid YouTube video id' }, { status: 400 });
	}

	const mediaDir = path.join(process.cwd(), 'media', episodeId);
	if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

	const outputPath = path.join(mediaDir, 'video.mp4');
	const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

	runYtdlpWithRetries([
		...baseYtdlpArgs(),
		'-f',
		'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
		'--merge-output-format',
		'mp4',
		'-o',
		outputPath,
		videoUrl
	]).then(async () => {
		await query('UPDATE episodes SET video_path = $1 WHERE id = $2 AND user_id = $3',
			[outputPath, episodeId, userId]);
	}).catch(err => {
		console.error(`Video download failed for ${episodeId}:`, err.message);
	});

	return json({ status: 'downloading' });
};
