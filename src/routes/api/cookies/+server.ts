import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const COOKIES_PATH = path.join(process.cwd(), 'cookies.txt');

// Only the first user (site owner) can upload cookies
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || locals.user.id !== 1) {
		return json({ error: 'Unauthorized' }, { status: 403 });
	}

	const formData = await request.formData().catch(() => null);
	if (!formData) return json({ error: 'Invalid form data' }, { status: 400 });

	const file = formData.get('cookies') as File | null;
	if (!file || file.size === 0) return json({ error: 'No file provided' }, { status: 400 });
	if (file.size > 5 * 1024 * 1024) return json({ error: 'File too large (max 5MB)' }, { status: 413 });

	const text = await file.text();
	if (!text.includes('youtube.com') && !text.includes('Netscape')) {
		return json({ error: 'Does not look like a valid Netscape cookies file' }, { status: 400 });
	}

	await writeFile(COOKIES_PATH, text, 'utf8');
	return json({ success: true });
};
