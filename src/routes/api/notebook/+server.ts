import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';

export const GET: RequestHandler = async ({ locals }) => {
	const { rows } = await query(
		`SELECT
			vn.*,
			e.title as episode_title,
			e.url as episode_url
		FROM vocab_notebook vn
		LEFT JOIN episodes e ON e.id = vn.episode_id AND e.user_id = vn.user_id
		WHERE vn.user_id = $1
		ORDER BY vn.created_at DESC`,
		[locals.user!.id]
	);
	return json(rows);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const { word, definition, example, episode_id, source_time, category } = await request.json();

	if (!word) {
		return json({ error: 'word is required' }, { status: 400 });
	}

	// Check for duplicate (case-insensitive) for this user
	const { rows: existing } = await query(
		'SELECT id FROM vocab_notebook WHERE lower(word) = lower($1) AND user_id = $2 LIMIT 1',
		[word, locals.user!.id]
	);
	if (existing.length > 0) {
		return json({ id: existing[0].id, duplicate: true }, { status: 409 });
	}

	const sourceTime = Number(source_time);
	const normalizedSourceTime = Number.isFinite(sourceTime) && sourceTime >= 0 ? sourceTime : null;
	const { rows: [row] } = await query(
		'INSERT INTO vocab_notebook (word, definition, example, episode_id, source_time, category, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
		[word, definition, example, episode_id || null, normalizedSourceTime, category || 'general', locals.user!.id]
	);

	return json({ id: row.id });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const { id, confidence } = await request.json();

	if (!id) {
		return json({ error: 'id is required' }, { status: 400 });
	}

	const nextConfidence = Number(confidence);
	if (!Number.isInteger(nextConfidence) || nextConfidence < 0 || nextConfidence > 5) {
		return json({ error: 'confidence must be an integer from 0 to 5' }, { status: 400 });
	}

	await query(
		"UPDATE vocab_notebook SET confidence = $1, reviewed_at = datetime('now') WHERE id = $2 AND user_id = $3",
		[nextConfidence, id, locals.user!.id]
	);

	return json({ success: true, confidence: nextConfidence });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const { id } = await request.json();

	if (!id) {
		return json({ error: 'id is required' }, { status: 400 });
	}

	await query('DELETE FROM vocab_notebook WHERE id = $1 AND user_id = $2', [id, locals.user!.id]);
	return json({ success: true });
};
