import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSettings } from '$lib/server/claude';
import OpenAI from 'openai';
import { rateLimit } from '$lib/server/ratelimit';

export interface HighlightSpan {
	text: string;
	type: 'collocation' | 'phrasal_verb';
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const userId = locals.user.id;
	if (!rateLimit(`highlight:${userId}`, 20, 60_000)) {
		return json({ spans: [] });
	}

	const { text } = await request.json();
	if (!text || typeof text !== 'string' || text.length > 500) {
		return json({ spans: [] });
	}

	const settings = await getSettings(userId);
	if (!settings.api_key) return json({ spans: [] });

	const client = new OpenAI({
		apiKey: settings.api_key,
		baseURL: settings.base_url + '/v1',
		timeout: 15_000
	});

	const prompt = `You are a language analysis tool. Given a sentence, find all collocations and phrasal verbs.

Sentence: "${text}"

Return JSON with a single "spans" array. Each item: {"text": "exact substring", "type": "collocation" or "phrasal_verb"}.
Only include multi-word phrases (2+ words). Do not include single common words.
Examples of what to highlight:
- Phrasal verbs: "figure out", "set up", "come up with", "look into"
- Collocations: "product visionary", "make sense", "take action", "strong foundation"

If none found, return {"spans":[]}.
Return valid JSON only, no markdown.`;

	try {
		const res = await client.chat.completions.create({
			model: settings.model,
			max_completion_tokens: 300,
			messages: [{ role: 'user', content: prompt }],
			response_format: { type: 'json_object' }
		} as any);

		const raw = res.choices[0]?.message?.content || '{"spans":[]}';
		const parsed = JSON.parse(raw);
		const spans: HighlightSpan[] = (parsed.spans || []).filter(
			(s: any) => typeof s.text === 'string' && s.text.length > 2 && text.includes(s.text)
		);
		return json({ spans });
	} catch {
		return json({ spans: [] });
	}
};
