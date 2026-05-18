import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';
import { rateLimit } from '$lib/server/ratelimit';
import {
	generateInitialQuiz,
	generateAdaptiveQuiz,
	diagnoseQuiz,
	type QuizQuestion,
	type QuizAnswer
} from '$lib/server/claude';

/**
 * Adaptive quiz endpoint. Three phases:
 *
 *   POST {episodeId | articleId, phase: "initial"}
 *   POST {episodeId | articleId, phase: "adaptive", previousQuestions, previousAnswers}
 *   POST {episodeId | articleId, phase: "diagnose", questions, answers}
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	if (!rateLimit(`quiz:${userId}`, 10, 60_000)) {
		return json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
	}
	const body = await request.json();
	const { episodeId, articleId, phase } = body;

	if (!episodeId && !articleId) return json({ error: 'Missing episodeId or articleId' }, { status: 400 });
	if (!['initial', 'adaptive', 'diagnose'].includes(phase)) {
		return json({ error: 'phase must be initial | adaptive | diagnose' }, { status: 400 });
	}

	try {
		if (phase === 'diagnose') {
			const questions: QuizQuestion[] = Array.isArray(body.questions) ? body.questions : [];
			const answers: QuizAnswer[] = Array.isArray(body.answers) ? body.answers : [];
			const diagnosis = await diagnoseQuiz(questions, answers, userId);
			return json({ diagnosis });
		}

		let segments: { text: string }[] = [];
		let vocabulary: { word: string; definition: string; example?: string }[] = [];

		if (articleId) {
			// Article quiz — verify ownership, split content into paragraph segments
			const { rows: [article] } = await query(
				'SELECT id, content FROM articles WHERE id = $1 AND user_id = $2',
				[articleId, userId]
			);
			if (!article) return json({ error: 'Article not found' }, { status: 404 });

			// Split article content into paragraph-sized "segments" for the quiz generator
			segments = (article.content as string)
				.split(/\n+/)
				.map((p: string) => p.trim())
				.filter((p: string) => p.length > 30)
				.map((p: string) => ({ text: p }));

			// Use saved words from the notebook (not tied to a specific episode)
			const { rows: vocab } = await query(
				'SELECT word, definition, example FROM vocab_notebook WHERE user_id = $1 ORDER BY created_at DESC LIMIT 12',
				[userId]
			);
			vocabulary = vocab as { word: string; definition: string; example?: string }[];
		} else {
			// Episode quiz — original path
			const { rows: [episode] } = await query(
				'SELECT id FROM episodes WHERE id = $1 AND user_id = $2',
				[episodeId, userId]
			);
			if (!episode) return json({ error: 'Episode not found' }, { status: 404 });

			const { rows: segs } = await query(
				'SELECT text FROM segments WHERE episode_id = $1 ORDER BY start_time',
				[episodeId]
			);
			segments = segs as { text: string }[];

			const { rows: vocab } = await query(
				'SELECT word, definition, example FROM vocab_notebook WHERE episode_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 12',
				[episodeId, userId]
			);
			vocabulary = vocab as { word: string; definition: string; example?: string }[];
		}

		if (segments.length === 0) return json({ questions: [] });

		if (phase === 'initial') {
			const questions = await generateInitialQuiz(segments, vocabulary, userId);
			return json({ questions });
		}

		// adaptive
		const previousQuestions: QuizQuestion[] = Array.isArray(body.previousQuestions) ? body.previousQuestions : [];
		const previousAnswers: QuizAnswer[] = Array.isArray(body.previousAnswers) ? body.previousAnswers : [];
		const questions = await generateAdaptiveQuiz(segments, vocabulary, previousQuestions, previousAnswers, userId);
		return json({ questions });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};
