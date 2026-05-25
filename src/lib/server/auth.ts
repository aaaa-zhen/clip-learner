import crypto from 'crypto';
import { query } from './db';

// Hash password using scrypt (Node built-in, no external deps)
export async function hashPassword(plain: string): Promise<string> {
	const salt = crypto.randomBytes(16).toString('hex');
	const hash = await new Promise<string>((resolve, reject) => {
		crypto.scrypt(plain, salt, 64, (err, derived) => {
			if (err) reject(err);
			else resolve(derived.toString('hex'));
		});
	});
	return `${salt}:${hash}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
	const [salt, hash] = stored.split(':');
	if (!salt || !hash) return false;
	const derived = await new Promise<string>((resolve, reject) => {
		crypto.scrypt(plain, salt, 64, (err, buf) => {
			if (err) reject(err);
			else resolve(buf.toString('hex'));
		});
	});
	// Constant-time comparison to prevent timing attacks
	return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(hash));
}

export function generateSessionId(): string {
	return crypto.randomBytes(32).toString('hex');
}

export async function createSession(userId: number): Promise<string> {
	const id = generateSessionId();
	await query(
		`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, datetime('now', '+30 days'))`,
		[id, userId]
	);
	return id;
}

export async function deleteSession(sessionId: string): Promise<void> {
	await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

/** Create an anonymous guest user and return its session ID. */
export async function createGuestUser(): Promise<{ userId: number; sessionId: string }> {
	const guestName = `guest_${crypto.randomBytes(8).toString('hex')}`;
	const dummyHash = await hashPassword(crypto.randomBytes(16).toString('hex'));
	const { rows: [row] } = await query(
		'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id',
		[guestName, dummyHash]
	);
	const userId = row.id as number;
	const sessionId = await createSession(userId);
	return { userId, sessionId };
}
