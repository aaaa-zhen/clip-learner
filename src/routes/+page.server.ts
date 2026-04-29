import type { PageServerLoad } from './$types';
import { query } from '$lib/server/db';
import type { Episode } from '$lib/types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		return { episodes: [], clipsStudied: 0, wordsSaved: 0, jokesDecoded: 0 };
	}

	const userId = locals.user.id;

	const { rows: episodes } = await query(
		'SELECT * FROM episodes WHERE user_id = $1 ORDER BY created_at DESC', [userId]
	);
	const { rows: [clips] } = await query(
		"SELECT count(*) as count FROM episodes WHERE status = $1 AND user_id = $2", ['ready', userId]
	);
	const { rows: [words] } = await query(
		'SELECT count(*) as count FROM vocab_notebook WHERE user_id = $1', [userId]
	);
	const { rows: [annotations] } = await query(
		'SELECT count(*) as count FROM humor_annotations ha JOIN episodes e ON e.id = ha.episode_id WHERE e.user_id = $1',
		[userId]
	);

	const { rows: articles } = await query(
		'SELECT id, title, url, source, status, created_at FROM articles WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
		[userId]
	);

	return {
		episodes: episodes as Episode[],
		articles,
		clipsStudied: Number(clips.count),
		wordsSaved: Number(words.count),
		jokesDecoded: Number(annotations.count)
	};
};
