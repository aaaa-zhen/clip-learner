import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';

/**
 * Lightweight status poll for an episode.
 *
 * Replaces the old pattern of POSTing to /api/process for status checks,
 * which had the nasty side-effect of re-triggering analysis when the
 * episode was in the `analyzing` or `error` state (e.g. on page refresh).
 *
 * This endpoint is read-only: it only reports the current status.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { rows: [episode] } = await query(
		'SELECT id, status, error_message FROM episodes WHERE id = $1 AND user_id = $2',
		[params.id, locals.user.id]
	);

	if (!episode) {
		return json({ error: 'Episode not found' }, { status: 404 });
	}

	return json({
		id: episode.id,
		status: episode.status,
		errorMessage: episode.error_message ?? null
	});
};
