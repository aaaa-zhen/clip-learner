import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';
import { randomUUID } from 'crypto';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.user!.id;
	const { rows } = await query(
		'SELECT id, title, url, source, status, created_at FROM articles WHERE user_id = $1 ORDER BY created_at DESC',
		[userId]
	);
	return json(rows);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	const { title, url, source, content } = await request.json();

	if (!title || !content) {
		return json({ error: 'title and content are required' }, { status: 400 });
	}

	const id = randomUUID();
	await query(
		'INSERT INTO articles (id, user_id, title, url, source, content, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
		[id, userId, title, url || null, source || null, content, 'pending']
	);

	return json({ id });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	const { id } = await request.json();
	if (!id) return json({ error: 'id is required' }, { status: 400 });

	await query('DELETE FROM articles WHERE id = $1 AND user_id = $2', [id, userId]);
	return json({ success: true });
};
