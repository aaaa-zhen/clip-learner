import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { query, transaction } from '$lib/server/db';
import { hashPassword, verifyPassword, createSession } from '$lib/server/auth';
import { rateLimit } from '$lib/server/ratelimit';

/** Migrate all guest data to the target user, then delete the guest account. */
async function migrateGuestData(guestId: number, targetId: number): Promise<void> {
	await transaction(async () => {
		// Move episodes (skip duplicates by video_id)
		await query(
			`UPDATE episodes SET user_id = $1
			 WHERE user_id = $2
			 AND video_id NOT IN (SELECT video_id FROM episodes WHERE user_id = $1)`,
			[targetId, guestId]
		);
		// Move vocab (skip duplicates by word)
		await query(
			`UPDATE vocab_notebook SET user_id = $1
			 WHERE user_id = $2
			 AND lower(word) NOT IN (SELECT lower(word) FROM vocab_notebook WHERE user_id = $1)`,
			[targetId, guestId]
		);
		// Move articles
		await query('UPDATE articles SET user_id = $1 WHERE user_id = $2', [targetId, guestId]);
		// Clean up guest: sessions, remaining data, then user row
		await query('DELETE FROM sessions WHERE user_id = $1', [guestId]);
		await query('DELETE FROM episodes WHERE user_id = $1', [guestId]);
		await query('DELETE FROM vocab_notebook WHERE user_id = $1', [guestId]);
		await query('DELETE FROM usage_log WHERE user_id = $1', [guestId]);
		await query('DELETE FROM users WHERE id = $1', [guestId]);
	});
}

export const POST: RequestHandler = async ({ request, cookies, locals, getClientAddress }) => {
	const ip = getClientAddress();
	if (!rateLimit(`auth:${ip}`, 10, 60_000)) {
		return json({ error: 'Too many attempts. Please wait a moment.' }, { status: 429 });
	}

	const body = await request.json();
	const { action, username, password } = body;

	if (!username?.trim() || !password) {
		return json({ error: 'Username and password are required.' }, { status: 400 });
	}

	const guestUser = locals.user?.isGuest ? locals.user : null;

	if (action === 'signup') {
		if (username.trim().length < 3) {
			return json({ error: 'Username must be at least 3 characters.' }, { status: 400 });
		}
		if (password.length < 8) {
			return json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
		}

		const { rows: existing } = await query('SELECT id FROM users WHERE username = $1', [username.trim()]);
		if (existing.length > 0) {
			return json({ error: 'Username already taken.' }, { status: 400 });
		}

		if (guestUser) {
			// Upgrade guest account in-place: rename + set password
			const hashed = await hashPassword(password);
			await query('UPDATE users SET username = $1, password = $2 WHERE id = $3', [username.trim(), hashed, guestUser.id]);
			// Keep existing session — just reload the page
			return json({ ok: true });
		}

		const hashed = await hashPassword(password);
		const { rows: [newUser] } = await query(
			'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id',
			[username.trim(), hashed]
		);

		const sessionId = await createSession(newUser.id as number);
		cookies.set('clip_session', sessionId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30,
			secure: false // HTTP VPS: a Secure cookie won't persist over plain HTTP; revert to !dev once on HTTPS
		});
		return json({ ok: true });
	}

	if (action === 'login') {
		const { rows } = await query('SELECT id, password FROM users WHERE username = $1', [username.trim()]);
		const user = rows[0];
		const valid = user && await verifyPassword(password, user.password as string);

		if (!valid) {
			return json({ error: 'Invalid username or password.' }, { status: 400 });
		}

		// Migrate guest data to the logged-in account
		if (guestUser && guestUser.id !== (user.id as number)) {
			await migrateGuestData(guestUser.id, user.id as number);
		}

		const sessionId = await createSession(user.id as number);
		cookies.set('clip_session', sessionId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30,
			secure: false // HTTP VPS: a Secure cookie won't persist over plain HTTP; revert to !dev once on HTTPS
		});
		return json({ ok: true });
	}

	return json({ error: 'Invalid action.' }, { status: 400 });
};
