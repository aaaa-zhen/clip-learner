import type { PageServerLoad } from './$types';
import { query } from '$lib/server/db';
import type { VocabEntry } from '$lib/types';

export const load: PageServerLoad = async ({ locals }) => {
	const { rows } = await query(
		`SELECT
			vn.*,
			e.title as episode_title,
			e.url as episode_url
		FROM vocab_notebook vn
		LEFT JOIN episodes e ON e.id = vn.episode_id AND e.user_id = vn.user_id
		WHERE vn.user_id = $1
		ORDER BY
			CASE WHEN vn.reviewed_at IS NULL THEN 0 ELSE 1 END,
			vn.reviewed_at ASC,
			vn.created_at DESC`,
		[locals.user!.id]
	);
	return { entries: rows as (VocabEntry & { episode_title?: string | null; episode_url?: string | null })[] };
};
