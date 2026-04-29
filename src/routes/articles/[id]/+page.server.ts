import type { PageServerLoad } from './$types';
import { query } from '$lib/server/db';
import { error, redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw redirect(302, '/');
	const userId = locals.user.id;

	const { rows: [article] } = await query(
		'SELECT * FROM articles WHERE id = $1 AND user_id = $2',
		[params.id, userId]
	);
	if (!article) throw error(404, 'Article not found');

	const { rows: annotations } = await query(
		'SELECT * FROM article_annotations WHERE article_id = $1 ORDER BY start_pos',
		[params.id]
	);

	const { rows: notebookWords } = await query(
		'SELECT lower(word) as word FROM vocab_notebook WHERE user_id = $1',
		[userId]
	);
	const savedWords = new Set(notebookWords.map((r: any) => r.word as string));

	return {
		article,
		annotations,
		savedWords: [...savedWords]
	};
};
