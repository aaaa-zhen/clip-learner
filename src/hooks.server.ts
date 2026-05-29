import type { Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import fs from 'fs';
import path from 'path';
import { query } from '$lib/server/db';
import { createGuestUser } from '$lib/server/auth';
import { runStartupTasks } from '$lib/server/startup';

// Make Node.js fetch use the system proxy (needed locally behind a proxy/VPN)
// EnvHttpProxyAgent respects NO_PROXY, so local base_url endpoints stay direct
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy ||
              process.env.HTTP_PROXY  || process.env.http_proxy;
if (proxy) {
	const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici');
	setGlobalDispatcher(new EnvHttpProxyAgent());
}

// One-time server boot tasks: clean up orphaned in-flight episodes (PM2
// restarts etc.) and log warnings if yt-dlp/ffmpeg/Whisper aren't set up.
// runStartupTasks() is idempotent so running it at module scope is safe.
runStartupTasks().catch((err) => console.error('[startup] unhandled:', err));

export const handle: Handle = async ({ event, resolve }) => {
	// Session validation
	event.locals.user = null;
	let sessionExpired = false;
	const sessionId = event.cookies.get('clip_session');

	if (sessionId) {
		try {
			const { rows } = await query(
				`SELECT u.id, u.username FROM sessions s
				 JOIN users u ON u.id = s.user_id
				 WHERE s.id = $1 AND s.expires_at > datetime('now')`,
				[sessionId]
			);
			if (rows.length > 0) {
				const username = rows[0].username as string;
				event.locals.user = {
					id: rows[0].id as number,
					username,
					isGuest: username.startsWith('guest_')
				};
			} else {
				event.cookies.delete('clip_session', { path: '/' });
				sessionExpired = true;
			}
		} catch {
			event.cookies.delete('clip_session', { path: '/' });
			sessionExpired = true;
		}
	}

	// Auto-create guest session only for real browser page requests (not bots/API/assets)
	const currentPath = event.url.pathname;
	const skipGuestPaths = ['/api/', '/login', '/signup', '/favicon', '/media/'];
	const isPageRequest = event.request.headers.get('accept')?.includes('text/html');
	if (!event.locals.user && isPageRequest && !skipGuestPaths.some((p) => currentPath.startsWith(p))) {
		try {
			const { userId, sessionId: guestSessionId } = await createGuestUser();
			event.cookies.set('clip_session', guestSessionId, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 * 30,
				secure: false // HTTP VPS: a Secure cookie won't persist over plain HTTP; revert to !dev once on HTTPS
			});
			const { rows } = await query('SELECT username FROM users WHERE id = $1', [userId]);
			event.locals.user = {
				id: userId,
				username: rows[0].username as string,
				isGuest: true
			};
		} catch (err) {
			console.error('[hooks] failed to create guest user:', err);
		}
	}

	// Guard API routes: if no session, return 401 (edge case: expired cookie on XHR).
	// `/api/auth` is exempt — a cold client (e.g. the iOS app, with no guest
	// cookie) must be able to log in / sign up. It has its own rate limiting.
	if (currentPath.startsWith('/api/') && currentPath !== '/api/auth' && !event.locals.user) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Serve media files (downloaded videos) only for the owning user
	if (currentPath.startsWith('/media/')) {
		if (!event.locals.user) {
			return new Response('Unauthorized', { status: 401 });
		}

		const [, , episodeId] = currentPath.split('/');
		if (!episodeId) {
			return new Response('Not found', { status: 404 });
		}

		const { rows: [episode] } = await query(
			'SELECT id FROM episodes WHERE id = $1 AND user_id = $2',
			[episodeId, event.locals.user.id]
		);
		if (!episode) {
			return new Response('Not found', { status: 404 });
		}

		const filePath = path.join(process.cwd(), currentPath);
		const resolved = path.resolve(filePath);
		const episodeMediaRoot = path.resolve(process.cwd(), 'media', episodeId);
		const insideEpisodeRoot =
			resolved === episodeMediaRoot || resolved.startsWith(`${episodeMediaRoot}${path.sep}`);
		if (!insideEpisodeRoot) {
			return new Response('Forbidden', { status: 403 });
		}

		if (fs.existsSync(filePath)) {
			const stat = fs.statSync(filePath);
			const ext = path.extname(filePath).toLowerCase();

			const mimeTypes: Record<string, string> = {
				'.mp4': 'video/mp4',
				'.webm': 'video/webm',
				'.srt': 'text/plain',
				'.vtt': 'text/vtt'
			};

			const contentType = mimeTypes[ext] || 'application/octet-stream';
			const range = event.request.headers.get('range');

			if (range && ext === '.mp4') {
				const parts = range.replace(/bytes=/, '').split('-');
				const start = parseInt(parts[0], 10);
				const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
				if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= stat.size || start > end) {
					return new Response('Range Not Satisfiable', {
						status: 416,
						headers: { 'Content-Range': `bytes */${stat.size}` }
					});
				}
				const chunkSize = end - start + 1;

				const stream = fs.createReadStream(filePath, { start, end });
				const readable = new ReadableStream({
					start(controller) {
						stream.on('data', (chunk) => controller.enqueue(chunk));
						stream.on('end', () => controller.close());
						stream.on('error', (err) => controller.error(err));
					}
				});

				return new Response(readable, {
					status: 206,
					headers: {
						'Content-Range': `bytes ${start}-${end}/${stat.size}`,
						'Accept-Ranges': 'bytes',
						'Content-Length': String(chunkSize),
						'Content-Type': contentType
					}
				});
			}

			const buffer = fs.readFileSync(filePath);
			return new Response(buffer, {
				headers: {
					'Content-Type': contentType,
					'Content-Length': String(stat.size),
					'Accept-Ranges': 'bytes'
				}
			});
		}
	}

	const response = await resolve(event);
	return response;
};
