import type { Handle } from '@sveltejs/kit';
import fs from 'fs';
import path from 'path';
import { query } from '$lib/server/db';
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
				event.locals.user = { id: rows[0].id as number, username: rows[0].username as string };
			} else {
				// Session expired or invalid — clear cookie and flag it so the
				// UI can tell the user instead of silently redirecting to `/`.
				event.cookies.delete('clip_session', { path: '/' });
				sessionExpired = true;
			}
		} catch {
			event.cookies.delete('clip_session', { path: '/' });
			sessionExpired = true;
		}
	}

	const currentPath = event.url.pathname;
	const protectedApiRoutes = [
		'/api/debug',
		'/api/download',
		'/api/episode',
		'/api/explain',
		'/api/logout',
		'/api/notebook',
		'/api/process',
		'/api/quiz',
		'/api/settings',
		'/api/stats'
	];
	const protectedPagePrefixes = ['/episode/', '/notebook'];
	const isProtectedApi = protectedApiRoutes.some((route) => currentPath.startsWith(route));
	const isProtectedPage = protectedPagePrefixes.some((prefix) => currentPath.startsWith(prefix));

	if (isProtectedApi && !event.locals.user) {
		const body = sessionExpired
			? { error: 'Session expired', code: 'SESSION_EXPIRED' }
			: { error: 'Unauthorized' };
		return new Response(JSON.stringify(body), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (isProtectedPage && !event.locals.user) {
		// Surface "you were signed out" via a query param so the landing page
		// can show a flash message instead of the redirect looking random.
		const target = new URL('/', event.url);
		if (sessionExpired) target.searchParams.set('signed_out', '1');
		return Response.redirect(target, 303);
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

	return resolve(event);
};
