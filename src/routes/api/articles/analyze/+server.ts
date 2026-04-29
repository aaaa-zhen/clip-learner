import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';
import { analyzeArticle } from '$lib/server/claude';
import { rateLimit } from '$lib/server/ratelimit';

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;

	if (!rateLimit(`article-analyze:${userId}`, 5, 60_000)) {
		return json({ error: 'Too many requests.' }, { status: 429 });
	}

	const { articleId } = await request.json();
	if (!articleId) return json({ error: 'articleId is required' }, { status: 400 });

	const { rows: [article] } = await query(
		'SELECT * FROM articles WHERE id = $1 AND user_id = $2',
		[articleId, userId]
	);
	if (!article) return json({ error: 'Article not found' }, { status: 404 });

	try {
		await query("UPDATE articles SET status = 'analyzing' WHERE id = $1", [articleId]);

		const annotations = await analyzeArticle(article.content, userId);

		// Delete old annotations then insert fresh ones
		await query('DELETE FROM article_annotations WHERE article_id = $1', [articleId]);
		for (const ann of annotations) {
			await query(
				'INSERT INTO article_annotations (article_id, type, text, explanation, start_pos, end_pos) VALUES ($1, $2, $3, $4, $5, $6)',
				[articleId, ann.type, ann.text, ann.explanation, ann.start_pos, ann.end_pos]
			);
		}

		await query("UPDATE articles SET status = 'ready' WHERE id = $1", [articleId]);

		return json({ annotations });
	} catch (err) {
		await query("UPDATE articles SET status = 'error' WHERE id = $1", [articleId]);
		const message = err instanceof Error ? err.message : 'Analysis failed';
		return json({ error: message }, { status: 500 });
	}
};
