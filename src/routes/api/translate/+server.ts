import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSettings } from '$lib/server/claude';
import OpenAI from 'openai';
import { rateLimit } from '$lib/server/ratelimit';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const userId = locals.user.id;
	if (!rateLimit(`translate:${userId}`, 30, 60_000)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}

	const { word, definition } = await request.json();
	if (!word || !definition) return json({ error: 'word and definition required' }, { status: 400 });

	const settings = await getSettings(userId);
	if (!settings.api_key) return json({ error: 'API key not configured' }, { status: 400 });

	const client = new OpenAI({
		apiKey: settings.api_key,
		baseURL: settings.base_url + '/v1',
		timeout: 15_000
	});

	try {
		const res = await client.chat.completions.create({
			model: settings.model,
			max_completion_tokens: 80,
			messages: [{
				role: 'user',
				content: `Translate this English word/phrase and its definition into natural Chinese (Simplified).

Word: "${word}"
Definition: "${definition}"

Reply with JSON only: {"chinese": "简洁的中文释义，不超过15字"}
No markdown, no extra text.`
			}],
			response_format: { type: 'json_object' }
		} as any);

		const raw = res.choices[0]?.message?.content || '{}';
		const parsed = JSON.parse(raw);
		return json({ chinese: parsed.chinese || '' });
	} catch {
		return json({ error: 'Translation failed' }, { status: 500 });
	}
};
