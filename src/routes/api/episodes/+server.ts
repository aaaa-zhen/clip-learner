import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';
import type { Episode } from '$lib/types';

// JSON mirror of `src/routes/+page.server.ts` episode list, for the iOS client.
// `locals.user` is guaranteed by hooks.server.ts (it 401s unauthenticated /api/).
// Ordering matches the web: pinned first, then newest first.
export const GET: RequestHandler = async ({ locals }) => {
	const { rows } = await query(
		`SELECT * FROM episodes
		 WHERE user_id = $1
		 ORDER BY pinned_at IS NOT NULL DESC, pinned_at DESC, created_at DESC`,
		[locals.user!.id]
	);
	return json(rows as Episode[]);
};
