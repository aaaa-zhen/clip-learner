import { query } from './db';
import { parseSrt } from './subtitles';
import { analyzeTranscript } from './claude';

export async function processEpisode(episodeId: string, subsText: string, userId: number) {
	const { rows: [episode] } = await query('SELECT * FROM episodes WHERE id = $1', [episodeId]);
	if (!episode) throw new Error('Episode not found');

	await query('UPDATE episodes SET status = $1 WHERE id = $2', ['analyzing', episodeId]);

	try {
		// Clean up any previous data for this episode
		await query('DELETE FROM humor_annotations WHERE episode_id = $1', [episodeId]);
		await query('DELETE FROM scene_breakdowns WHERE episode_id = $1', [episodeId]);
		await query('DELETE FROM segments WHERE episode_id = $1', [episodeId]);

		// Parse subtitles from text
		const segments = parseSrt(subsText);

		// Store segments
		for (const seg of segments) {
			await query(
				'INSERT INTO segments (episode_id, index_num, start_time, end_time, text) VALUES ($1, $2, $3, $4, $5)',
				[episodeId, seg.index, seg.startTime, seg.endTime, seg.text]
			);
		}

		// Get segment IDs for annotation linking
		const { rows: storedSegments } = await query(
			'SELECT id, index_num FROM segments WHERE episode_id = $1 ORDER BY index_num',
			[episodeId]
		);

		const segmentIdMap = new Map(storedSegments.map((s: any) => [s.index_num, s.id]));

		// Analyze with Claude
		const analysis = await analyzeTranscript(
			segments.map(s => ({ index: s.index, text: s.text })),
			userId
		);

		// Helpers: coerce LLM-returned values to the shapes SQLite expects.
		// Smaller models (gpt-5.4-nano etc.) sometimes omit optional fields
		// or return numbers as strings, which the native node:sqlite binding
		// rejects with "Provided value cannot be bound".
		const toInt = (v: unknown, fallback = 0): number => {
			const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
			return Number.isFinite(n) ? n : fallback;
		};
		const toStr = (v: unknown, fallback = ''): string =>
			v == null ? fallback : String(v);

		// Store annotations
		for (const ann of analysis.annotations ?? []) {
			const segId = segmentIdMap.get(ann.segment_index);
			if (!segId) continue;
			await query(
				'INSERT INTO humor_annotations (episode_id, segment_id, category, explanation, excerpt, start_pos, end_pos) VALUES ($1, $2, $3, $4, $5, $6, $7)',
				[
					episodeId,
					segId,
					toStr(ann.category, 'general'),
					toStr(ann.explanation),
					toStr(ann.excerpt),
					toInt(ann.start_pos, 0),
					toInt(ann.end_pos, 0)
				]
			);
		}

		// Store scene breakdowns
		for (const scene of analysis.scenes ?? []) {
			await query(
				'INSERT INTO scene_breakdowns (episode_id, start_seg, end_seg, title, explanation, humor_types) VALUES ($1, $2, $3, $4, $5, $6)',
				[
					episodeId,
					toInt(scene.start_seg, 0),
					toInt(scene.end_seg, 0),
					toStr(scene.title),
					toStr(scene.explanation),
					JSON.stringify(Array.isArray(scene.humor_types) ? scene.humor_types : [])
				]
			);
		}

		// Store vocabulary suggestions
		for (const vocab of analysis.vocabulary ?? []) {
			if (!vocab?.word) continue;
			await query(
				'INSERT INTO vocab_notebook (word, definition, example, episode_id, category, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
				[
					toStr(vocab.word),
					toStr(vocab.definition),
					toStr(vocab.example),
					episodeId,
					toStr(vocab.category, 'general'),
					userId
				]
			);
		}

		// Mark as ready
		await query('UPDATE episodes SET status = $1 WHERE id = $2', ['ready', episodeId]);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		await query('UPDATE episodes SET status = $1, error_message = $2 WHERE id = $3',
			['error', message, episodeId]);
		// Don't re-throw — status is already set to 'error'. Caller handles logging.
	}
}
