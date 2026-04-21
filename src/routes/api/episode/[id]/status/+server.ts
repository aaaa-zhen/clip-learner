import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';
import { getJob } from '$lib/server/jobs';

/**
 * Lightweight read-only status poll for an episode.
 *
 * Returns DB status (source of truth) plus an in-memory progress snapshot
 * for ongoing work so the UI can show "elapsed 0:42 · estimated ~2:30" etc.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { rows: [episode] } = await query(
		'SELECT id, status, error_message, duration FROM episodes WHERE id = $1 AND user_id = $2',
		[params.id, locals.user.id]
	);

	if (!episode) {
		return json({ error: 'Episode not found' }, { status: 404 });
	}

	const job = getJob(params.id);
	const now = Date.now();

	return json({
		id: episode.id,
		status: episode.status,
		errorMessage: episode.error_message ?? null,
		durationSeconds: episode.duration ? Number(episode.duration) : null,
		progress: job
			? {
					stage: job.stage,
					elapsedSeconds: Math.max(0, Math.floor((now - job.startedAt) / 1000)),
					stageElapsedSeconds: Math.max(0, Math.floor((now - job.stageStartedAt) / 1000)),
					estimateSeconds: job.estimateSeconds,
					videoDurationSeconds: job.videoDurationSeconds
				}
			: null
	});
};
