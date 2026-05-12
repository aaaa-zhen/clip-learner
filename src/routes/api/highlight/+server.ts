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
		baseURL: settings.base_url.endsWith('/v1') ? settings.base_url : settings.base_url + '/v1',
		timeout: 15_000
	});

	const prompt = `You are a language analysis tool. Given a sentence, find phrasal verbs and genuinely interesting collocations that a language learner would benefit from knowing.

Sentence: "${text}"

Rules:
- Only highlight phrases where the words BELONG TOGETHER as a single meaning unit with a NON-OBVIOUS meaning.
- The words must be CONSECUTIVE and in the SAME clause — never span across commas, "and", "but", or sentence boundaries.
- Only include multi-word phrases (2–4 words). No single words.
- Be VERY selective — most sentences have ZERO highlights. Only highlight if a learner would genuinely struggle to understand the phrase from the individual words alone.
- NEVER highlight basic modifier+noun or modifier+adjective pairs that any beginner would understand.

Examples of GOOD highlights:
- Phrasal verbs: "figure out", "set up", "come up with", "get used to", "break down"
- Idioms/collocations with non-obvious meaning: "in your shoes", "make sense", "take for granted", "on the fence", "big deal"

Examples of BAD highlights (do NOT highlight these):
- "very hard", "very easy", "really good" — basic intensifier + adjective, obvious meaning
- "right amount", "the product", "the problem" — basic determiner/adjective + noun
- "to build", "to be", "it is" — basic grammar structures
- "I think", "you know", "of course" — too common
- "hardwired, and" — spans across clause boundary
- "food is" — not a meaningful collocation

Return JSON: {"spans": [{"text": "exact substring", "type": "collocation" or "phrasal_verb"}]}
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
