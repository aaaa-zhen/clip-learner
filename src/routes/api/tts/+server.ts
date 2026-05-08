import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSettings } from '$lib/server/claude';
import { env } from '$env/dynamic/private';

function normalizeOpenAIBaseUrl(value: string): string {
	const trimmed = value.trim().replace(/\/+$/, '');
	return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { text } = await request.json();
	if (!text || typeof text !== 'string' || text.length > 300) {
		return json({ error: 'Invalid text' }, { status: 400 });
	}

	const settings = await getSettings(locals.user.id);
	if (!settings.api_key) {
		return json({ error: 'API key not configured' }, { status: 400 });
	}

	const baseUrl = normalizeOpenAIBaseUrl(settings.base_url);
	const res = await fetch(`${baseUrl}/audio/speech`, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${settings.api_key}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: env.TTS_MODEL || 'gpt-4o-mini-tts',
			input: text,
			voice: env.TTS_VOICE || 'coral'
		})
	});

	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		console.error('[tts] provider failed:', res.status, detail.slice(0, 300));
		return json({ error: 'TTS failed', providerStatus: res.status }, { status: 502 });
	}

	const audio = await res.arrayBuffer();
	return new Response(audio, {
		headers: {
			'Content-Type': 'audio/mpeg',
			'Cache-Control': 'private, max-age=3600'
		}
	});
};
