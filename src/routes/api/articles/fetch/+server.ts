import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { rateLimit } from '$lib/server/ratelimit';

/**
 * Server-side URL fetch: avoids CORS and strips HTML to plain text.
 * Returns { title, source, content } extracted from the page.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;

	if (!rateLimit(`article-fetch:${userId}`, 10, 60_000)) {
		return json({ error: 'Too many requests.' }, { status: 429 });
	}

	const { url } = await request.json();
	if (!url || typeof url !== 'string') {
		return json({ error: 'url is required' }, { status: 400 });
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return json({ error: 'Invalid URL' }, { status: 400 });
	}

	if (!['http:', 'https:'].includes(parsed.protocol)) {
		return json({ error: 'Only http/https URLs are supported' }, { status: 400 });
	}

	try {
		const res = await fetch(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; ClipLearner/1.0)',
				Accept: 'text/html,application/xhtml+xml'
			},
			signal: AbortSignal.timeout(15_000)
		});

		if (!res.ok) {
			return json({ error: `Failed to fetch: HTTP ${res.status}` }, { status: 502 });
		}

		const html = await res.text();
		const { title, source, content } = extractArticle(html, parsed.hostname);
		return json({ title, source, content });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Fetch failed';
		return json({ error: message }, { status: 502 });
	}
};

function extractArticle(html: string, hostname: string) {
	// Extract title
	const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
	const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : hostname;

	// Source = domain without www.
	const source = hostname.replace(/^www\./, '');

	// Extract body text: strip scripts/styles/nav/header/footer then tags
	let body = html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<nav[\s\S]*?<\/nav>/gi, '')
		.replace(/<header[\s\S]*?<\/header>/gi, '')
		.replace(/<footer[\s\S]*?<\/footer>/gi, '')
		.replace(/<aside[\s\S]*?<\/aside>/gi, '')
		.replace(/<figure[\s\S]*?<\/figure>/gi, '');

	// Try to find main article container
	const articleMatch =
		body.match(/<article[\s\S]*?<\/article>/i) ||
		body.match(/class="[^"]*(?:article-body|story-body|post-content|entry-content|article__body)[^"]*"[\s\S]*?>([\s\S]*?)<\/(?:div|section|article)>/i);

	if (articleMatch) {
		body = articleMatch[0];
	}

	// Convert block elements to newlines, strip all tags
	const text = body
		.replace(/<\/?(p|div|section|h[1-6]|li|br|blockquote)[^>]*>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	const content = decodeEntities(text).slice(0, 20000);

	return { title, source, content };
}

function decodeEntities(str: string): string {
	return str
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'");
}
