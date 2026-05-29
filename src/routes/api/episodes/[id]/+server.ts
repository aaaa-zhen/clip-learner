import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';
import type { Episode, Segment, HumorAnnotation, SceneBreakdown, VocabEntry } from '$lib/types';

// Set (or clear) an episode's category. Scoped to the owner.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const userId = locals.user!.id;
	const { category } = await request.json();
	const value = typeof category === 'string' && category.trim() ? category.trim() : null;

	const { rows: [episode] } = await query(
		'SELECT id FROM episodes WHERE id = $1 AND user_id = $2',
		[params.id, userId]
	);
	if (!episode) throw error(404, 'Episode not found');

	await query(
		'UPDATE episodes SET category = $1 WHERE id = $2 AND user_id = $3',
		[value, params.id, userId]
	);
	return json({ success: true, category: value });
};

// JSON mirror of `src/routes/episode/[id]/+page.server.ts`, for the iOS client.
// Scoped to the owning user (404 otherwise) and updates studied_at, same as web.
export const GET: RequestHandler = async ({ params, locals }) => {
	const userId = locals.user!.id;

	const { rows: [episode] } = await query(
		'SELECT * FROM episodes WHERE id = $1 AND user_id = $2',
		[params.id, userId]
	);
	if (!episode) throw error(404, 'Episode not found');

	const { rows: segments } = await query(
		'SELECT * FROM segments WHERE episode_id = $1 ORDER BY index_num',
		[params.id]
	);

	const { rows: annotations } = await query(
		'SELECT * FROM humor_annotations WHERE episode_id = $1',
		[params.id]
	);

	const { rows: scenes } = await query(
		'SELECT * FROM scene_breakdowns WHERE episode_id = $1 ORDER BY start_seg',
		[params.id]
	);

	// humor_types is stored as a JSON string column; parse it for the client.
	const parsedScenes = scenes.map((s: any) => {
		let humor_types: string[] = [];
		try {
			humor_types = typeof s.humor_types === 'string' ? JSON.parse(s.humor_types) : (s.humor_types ?? []);
		} catch {
			humor_types = [];
		}
		return { ...s, humor_types };
	});

	const { rows: vocabulary } = await query(
		'SELECT * FROM vocab_notebook WHERE episode_id = $1 AND user_id = $2 ORDER BY created_at',
		[params.id, userId]
	);

	await query(
		"UPDATE episodes SET studied_at = datetime('now') WHERE id = $1 AND user_id = $2",
		[params.id, userId]
	);

	return json({
		episode: episode as Episode,
		segments: segments as Segment[],
		annotations: annotations as HumorAnnotation[],
		scenes: parsedScenes as SceneBreakdown[],
		vocabulary: vocabulary as VocabEntry[]
	});
};
