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
 *   POST {episodeId, phase: "initial"}
 *     → { questions: 3 }
 *
 *   POST {episodeId, phase: "adaptive",
 *         previousQuestions, previousAnswers}
 *     → { questions: 2 }
 *
 *   POST {episodeId, phase: "diagnose",
 *         questions, answers}
 *     → { diagnosis }
 *
 * No sessions/DB rows — the frontend carries state between calls. Keeps the
 * backend stateless and lets users restart the quiz trivially.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	// 10 quiz calls per minute per user
	if (!rateLimit(`quiz:${userId}`, 10, 60_000)) {
		return json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
	}
	const body = await request.json();
	const { episodeId, phase } = body;

	if (!episodeId) return json({ error: 'Missing episodeId' }, { status: 400 });
	if (!['initial', 'adaptive', 'diagnose'].includes(phase)) {
		return json({ error: 'phase must be initial | adaptive | diagnose' }, { status: 400 });
	}

	// Verify episode ownership upfront.
	const { rows: [episode] } = await query(
		'SELECT id FROM episodes WHERE id = $1 AND user_id = $2',
		[episodeId, userId]
	);
	if (!episode) return json({ error: 'Episode not found' }, { status: 404 });

	try {
		if (phase === 'diagnose') {
			const questions: QuizQuestion[] = Array.isArray(body.questions) ? body.questions : [];
			const answers: QuizAnswer[] = Array.isArray(body.answers) ? body.answers : [];
			const diagnosis = await diagnoseQuiz(questions, answers, userId);
			return json({ diagnosis });
		}

		// Both initial and adaptive need transcript + saved words.
		const { rows: segments } = await query(
			'SELECT text FROM segments WHERE episode_id = $1 ORDER BY start_time',
			[episodeId]
		);
		const { rows: vocabulary } = await query(
			'SELECT word, definition, example FROM vocab_notebook WHERE episode_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 12',
			[episodeId, userId]
		);

		if (segments.length === 0) return json({ questions: [] });

		if (phase === 'initial') {
			const questions = await generateInitialQuiz(
				segments as { text: string }[],
				vocabulary as { word: string; definition: string; example?: string }[],
				userId
			);
			return json({ questions });
		}

		// adaptive
		const previousQuestions: QuizQuestion[] = Array.isArray(body.previousQuestions)
			? body.previousQuestions
			: [];
		const previousAnswers: QuizAnswer[] = Array.isArray(body.previousAnswers)
			? body.previousAnswers
			: [];
		const questions = await generateAdaptiveQuiz(
			segments as { text: string }[],
			vocabulary as { word: string; definition: string; example?: string }[],
			previousQuestions,
			previousAnswers,
			userId
		);
		return json({ questions });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};
