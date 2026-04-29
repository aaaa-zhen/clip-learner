import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { Actions, PageServerLoad } from './$types';
import { query } from '$lib/server/db';
import { hashPassword, createSession } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) throw redirect(302, '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const username = (data.get('username') as string)?.trim();
		const password = data.get('password') as string;

		if (!username || username.length < 3) {
			return fail(400, { error: 'Username must be at least 3 characters.' });
		}
		if (!password || password.length < 8) {
			return fail(400, { error: 'Password must be at least 8 characters.' });
		}

		const { rows: existing } = await query(
			'SELECT id FROM users WHERE username = $1', [username]
		);
		if (existing.length > 0) {
			return fail(400, { error: 'Username already taken.' });
		}

		const hashed = await hashPassword(password);
		const { rows: [newUser] } = await query(
			'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id',
			[username, hashed]
		);

		const sessionId = await createSession(newUser.id as number);
		cookies.set('clip_session', sessionId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30,
			secure: !dev
		});

		throw redirect(302, '/');
	}
};
