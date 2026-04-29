import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { Actions, PageServerLoad } from './$types';
import { query } from '$lib/server/db';
import { verifyPassword, createSession } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) throw redirect(302, '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const username = (data.get('username') as string)?.trim();
		const password = data.get('password') as string;

		if (!username || !password) {
			return fail(400, { error: 'Username and password are required.' });
		}

		const { rows } = await query(
			'SELECT id, password FROM users WHERE username = $1', [username]
		);

		const user = rows[0];
		const valid = user && await verifyPassword(password, user.password as string);

		if (!valid) {
			return fail(400, { error: 'Invalid username or password.' });
		}

		const sessionId = await createSession(user.id as number);
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
