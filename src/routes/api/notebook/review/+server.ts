import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';
import { nextSchedule, type Grade } from '$lib/utils/srs';

/**
 * Record a spaced-repetition review result for a saved word.
 * Body: { id: number, grade: 0 | 1 }  (0 = Forgot, 1 = Got it)
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { id, grade } = await request.json();

	if (!id) {
		return json({ error: 'id is required' }, { status: 400 });
	}
	if (grade !== 0 && grade !== 1) {
		return json({ error: 'grade must be 0 (Forgot) or 1 (Got it)' }, { status: 400 });
	}

	const { rows } = await query(
		'SELECT review_interval, review_reps FROM vocab_notebook WHERE id = $1 AND user_id = $2 LIMIT 1',
		[id, locals.user!.id]
	);
	if (rows.length === 0) {
		return json({ error: 'not found' }, { status: 404 });
	}

	const prev = {
		review_interval: Number(rows[0].review_interval) || 0,
		review_reps: Number(rows[0].review_reps) || 0
	};
	const next = nextSchedule(grade as Grade, prev);

	await query(
		`UPDATE vocab_notebook
		 SET review_interval = $1, review_reps = $2, review_due = $3, reviewed_at = datetime('now')
		 WHERE id = $4 AND user_id = $5`,
		[next.interval, next.reps, next.due, id, locals.user!.id]
	);

	return json({ success: true, due: next.due, interval: next.interval, reps: next.reps });
};
