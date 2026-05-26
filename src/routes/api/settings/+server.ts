import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';
import { getSettings } from '$lib/server/claude';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.user!.id;
	const { rows } = await query('SELECT key, value FROM user_settings WHERE user_id = $1', [userId]);
	const settings: Record<string, string> = {};
	for (const row of rows) {
		if (row.key === 'api_key') {
			settings[row.key] = row.value ? '••••••••' + row.value.slice(-4) : '';
		} else {
			settings[row.key] = row.value;
		}
	}
	// If user has no personal API key, check if server has a shared one
	if (!settings.api_key) {
		const resolved = await getSettings(userId);
		if (resolved.api_key) {
			settings.api_key = '(server)';
		}
	}
	return json(settings);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	const body = await request.json();

	const allowedKeys = ['api_key', 'base_url', 'model', 'target_language'];

	for (const key of allowedKeys) {
		if (key in body && body[key] !== undefined) {
			const value = String(body[key]).trim();
			if (!value) {
				await query('DELETE FROM user_settings WHERE user_id = $1 AND key = $2', [userId, key]);
			} else {
				// Skip if masked value (no change)
				if (key === "api_key" && (value.startsWith("••••") || value === "(server)")) continue;
				await query(
					`INSERT INTO user_settings (user_id, key, value) VALUES ($1, $2, $3)
					 ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value`,
					[userId, key, value]
				);
			}
		}
	}

	return json({ success: true });
};
