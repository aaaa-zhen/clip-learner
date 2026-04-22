import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.user!.id;
	const { rows } = await query('SELECT key, value FROM user_settings WHERE user_id = $1', [userId]);
	const settings: Record<string, string> = {};
	for (const row of rows) {
		// Mask the API key for security
		if (row.key === 'api_key') {
			settings[row.key] = row.value ? '••••••••' + row.value.slice(-4) : '';
		} else {
			settings[row.key] = row.value;
		}
	}
	return json(settings);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	const body = await request.json();

	const allowedKeys = ['api_key', 'base_url', 'model'];

	for (const key of allowedKeys) {
		if (key in body && body[key] !== undefined) {
			const value = String(body[key]).trim();
			if (!value) {
				await query('DELETE FROM user_settings WHERE user_id = $1 AND key = $2', [userId, key]);
			} else {
				// Skip if masked value (no change)
				if (key === 'api_key' && value.startsWith('••••')) continue;
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
