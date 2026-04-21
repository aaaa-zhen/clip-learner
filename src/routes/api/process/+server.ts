import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';
import { extractVideoId, getVideoInfo } from '$lib/server/ytdlp';
import {
	transcribeYouTubeVideo,
	estimateTranscribeSeconds,
	whisperEngineDescription
} from '$lib/server/whisper';
import { processEpisode } from '$lib/server/analysis';
import { startJob, setStage, setEstimate, finishJob } from '$lib/server/jobs';
import crypto from 'crypto';

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	const { url } = await request.json();

	if (!url) {
		return json({ error: 'URL is required' }, { status: 400 });
	}

	const videoId = extractVideoId(url);
	if (!videoId) {
		return json({ error: 'Invalid YouTube URL' }, { status: 400 });
	}

	const { rows: [existing] } = await query(
		'SELECT id, status FROM episodes WHERE video_id = $1 AND user_id = $2',
		[videoId, userId]
	);

	if (existing) {
		// Re-run only for terminal "error" states (user-initiated retry).
		// We no longer silently reprocess `analyzing` rows — a page refresh
		// would otherwise blow away work in progress.
		if (existing.status === 'error') {
			await query('DELETE FROM humor_annotations WHERE episode_id = $1', [existing.id]);
			await query('DELETE FROM scene_breakdowns WHERE episode_id = $1', [existing.id]);
			await query('DELETE FROM vocab_notebook WHERE episode_id = $1 AND user_id = $2', [
				existing.id,
				userId
			]);
			await query('DELETE FROM segments WHERE episode_id = $1', [existing.id]);
			await query(
				'UPDATE episodes SET status = $1, error_message = NULL WHERE id = $2 AND user_id = $3',
				['fetching_audio', existing.id, userId]
			);
			startJob(existing.id as string);
			fetchAndAnalyze(existing.id as string, videoId, url, userId);
			return json({ id: existing.id, status: 'fetching_audio' });
		}
		return json({ id: existing.id, status: existing.status });
	}

	try {
		const info = await getVideoInfo(url);
		const episodeId = crypto.randomUUID();

		await query(
			'INSERT INTO episodes (id, video_id, title, url, thumbnail, duration, status, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
			[episodeId, videoId, info.title, url, info.thumbnail, info.duration, 'fetching_audio', userId]
		);

		startJob(episodeId);
		fetchAndAnalyze(episodeId, videoId, url, userId);

		return json({ id: episodeId, status: 'fetching_audio', title: info.title });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	const { id } = await request.json();
	if (!id) return json({ error: 'id is required' }, { status: 400 });

	// Verify ownership before deleting
	const { rows: [episode] } = await query(
		'SELECT id FROM episodes WHERE id = $1 AND user_id = $2',
		[id, userId]
	);
	if (!episode) return json({ error: 'Episode not found' }, { status: 404 });

	try {
		await query('DELETE FROM humor_annotations WHERE episode_id = $1', [id]);
		await query('DELETE FROM scene_breakdowns WHERE episode_id = $1', [id]);
		await query('DELETE FROM vocab_notebook WHERE episode_id = $1 AND user_id = $2', [id, userId]);
		await query('DELETE FROM segments WHERE episode_id = $1', [id]);
		await query('DELETE FROM episodes WHERE id = $1 AND user_id = $2', [id, userId]);
		return json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};

async function fetchAndAnalyze(
	episodeId: string,
	videoId: string,
	_url: string,
	userId: number
): Promise<void> {
	console.log(`[${episodeId}] ${whisperEngineDescription()}`);

	try {
		setStage(episodeId, 'fetching_audio');

		const { srt, durationSeconds } = await transcribeYouTubeVideo(videoId, {
			onAudioDownloaded: (durationSec) => {
				setStage(episodeId, 'transcribing');
				if (durationSec) {
					setEstimate(episodeId, {
						videoDurationSeconds: durationSec,
						estimateSeconds: estimateTranscribeSeconds(durationSec)
					});
				}
			}
		});

		if (durationSeconds) {
			await query('UPDATE episodes SET duration = $1 WHERE id = $2 AND user_id = $3', [
				Math.round(durationSeconds),
				episodeId,
				userId
			]);
		}

		if (!srt.trim()) {
			throw new Error('Transcription produced no captions.');
		}

		setStage(episodeId, 'analyzing');
		await query('UPDATE episodes SET status = $1 WHERE id = $2 AND user_id = $3', [
			'analyzing',
			episodeId,
			userId
		]);

		await processEpisode(episodeId, srt, userId);

		// processEpisode updates status to 'ready' on success, 'error' on failure.
		const { rows: [finalEp] } = await query(
			'SELECT status, error_message FROM episodes WHERE id = $1',
			[episodeId]
		);
		if (finalEp?.status === 'error') {
			finishJob(episodeId, 'error', finalEp.error_message as string | undefined);
		} else {
			finishJob(episodeId, 'ready');
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error(`[${episodeId}] processing failed:`, message);
		await query(
			'UPDATE episodes SET status = $1, error_message = $2 WHERE id = $3 AND user_id = $4',
			['error', message, episodeId, userId]
		);
		finishJob(episodeId, 'error', message);
	}
}
