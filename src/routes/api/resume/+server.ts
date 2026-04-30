import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';

// GET /api/resume?video_id=xxx — load resume position
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.user?.id;
	if (!userId) return json({ position: null });

	const videoId = url.searchParams.get('video_id');
	if (!videoId) return json({ position: null });

	const { rows } = await query(
		'SELECT position FROM resume_positions WHERE user_id = $1 AND video_id = $2',
		[userId, videoId]
	);
	return json({ position: rows[0]?.position ?? null });
};

// POST /api/resume — save resume position
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user?.id;
	if (!userId) return json({ ok: false }, { status: 401 });

	const { video_id, position } = await request.json();
	if (!video_id || typeof position !== 'number') {
		return json({ error: 'video_id and position required' }, { status: 400 });
	}

	await query(
		`INSERT INTO resume_positions (user_id, video_id, position, updated_at)
		 VALUES ($1, $2, $3, datetime('now'))
		 ON CONFLICT (user_id, video_id)
		 DO UPDATE SET position = $3, updated_at = datetime('now')`,
		[userId, video_id, Math.floor(position)]
	);
	return json({ ok: true });
};
