import OpenAI from 'openai';
import { query } from './db';
// Use SvelteKit's dynamic env accessor — `vite dev` doesn't push .env into
// process.env, so reading ANTHROPIC_* from process.env silently failed.
import { env } from '$env/dynamic/private';

const DEFAULTS = {
	api_key: '',
	base_url: 'https://aihubmix.com',
	model: 'gpt-5.4-nano'
};

async function getSettings(userId: number): Promise<typeof DEFAULTS> {
	try {
		const { rows } = await query(
			'SELECT key, value FROM user_settings WHERE user_id = $1',
			[userId]
		);
		const settings = { ...DEFAULTS };
		for (const row of rows) {
			if (row.key in settings) {
				(settings as any)[row.key] = row.value;
			}
		}
		if (rows.length === 0) {
			const { rows: legacyRows } = await query('SELECT key, value FROM app_settings');
			for (const row of legacyRows) {
				if (row.key in settings) {
					(settings as any)[row.key] = row.value;
				}
			}
		}
		// Fallback to env vars if no DB settings
		if (!settings.api_key && env.ANTHROPIC_API_KEY) {
			settings.api_key = env.ANTHROPIC_API_KEY;
		}
		if (env.ANTHROPIC_BASE_URL) {
			settings.base_url = settings.base_url || env.ANTHROPIC_BASE_URL;
		}
		return settings;
	} catch {
		return {
			api_key: env.ANTHROPIC_API_KEY || '',
			base_url: env.ANTHROPIC_BASE_URL || DEFAULTS.base_url,
			model: DEFAULTS.model
		};
	}
}

async function chat(
	prompt: string,
	maxTokens: number,
	userId: number,
	opts: { json?: boolean } = {}
): Promise<string> {
	const settings = await getSettings(userId);
	if (!settings.api_key) {
		throw new Error('API key not configured. Go to Settings to add your API key.');
	}
	const client = new OpenAI({
		apiKey: settings.api_key,
		baseURL: settings.base_url + '/v1',
		timeout: 180_000
	});
	const body: Record<string, unknown> = {
		model: settings.model,
		max_completion_tokens: maxTokens,
		messages: [{ role: 'user', content: prompt }]
	};
	// Ask the provider to return valid JSON when we're going to parse it.
	// Providers that don't support this field usually ignore it safely.
	if (opts.json) {
		body.response_format = { type: 'json_object' };
	}
	const res = await client.chat.completions.create(body as any);
	return res.choices[0]?.message?.content || '';
}

/**
 * Best-effort extraction of a JSON object from LLM output.
 *
 * Handles: plain JSON, ```json fences, and prose that happens to contain a
 * JSON block. Returns null if nothing parses.
 */
function extractJson<T = unknown>(text: string): T | null {
	if (!text) return null;
	const cleaned = text
		.replace(/^\s*```json\s*/im, '')
		.replace(/^\s*```\s*/im, '')
		.replace(/\s*```\s*$/im, '')
		.trim();
	try {
		return JSON.parse(cleaned) as T;
	} catch {
		// Fall through to bracket-based extraction.
	}
	const first = cleaned.indexOf('{');
	const last = cleaned.lastIndexOf('}');
	if (first === -1 || last === -1 || last <= first) return null;
	try {
		return JSON.parse(cleaned.slice(first, last + 1)) as T;
	} catch {
		return null;
	}
}

export async function analyzeTranscript(
	segments: { index: number; text: string }[],
	userId: number
): Promise<AnalysisResult> {
	const transcript = segments
		.map(s => `[${s.index}] ${s.text}`)
		.join('\n');

	const text = await chat(`You are helping someone learn English from videos. They understand basic grammar but struggle with jokes, slang, and culture. Write ALL explanations using very simple, easy words — like explaining to a 10-year-old.

IMPORTANT RULES:
1. This transcript comes from YouTube AUTO-CAPTIONS which often have mistakes, especially with accents. When something doesn't make sense, think about what they PROBABLY said.
2. British comedy is FULL of dirty jokes, sexual innuendo, and double meanings. ALWAYS check if a phrase could have a sexual or rude second meaning — this is often the actual joke. Don't be shy about explaining these. Words like "flicking", "coming", "banging", "blowing", etc. are often used as double entendres (one meaning is innocent, the other is sexual/rude).
3. Look for DOUBLE ENTENDRE — sentences that sound innocent but have a hidden dirty/funny meaning. This is one of the most common types of British humor and learners need to understand it.
4. Don't be polite or censor yourself. The learner needs the REAL explanation of why something is funny, even if it's rude or sexual.

TRANSCRIPT (each line prefixed with [segment_index]):
${transcript}

ONLY annotate moments that are genuinely one of these:
- Actually funny (jokes, wordplay, sarcasm)
- Genuinely difficult slang or idioms a learner wouldn't know
- Real cultural references that need explaining
- Moments where the auto-caption is clearly wrong and confusing

DO NOT annotate normal speech. DO NOT force things into categories — only annotate if it truly fits. Be selective — quality over quantity. If a line is just normal talking, skip it.

Categories: wordplay, cultural_reference, sarcasm, deadpan, callback, self_deprecation, banter, slang, idiom, absurdist, double_entendre, caption_error

For each annotation:
- excerpt: the exact words from the transcript
- segment_index: which line it's in
- category: one of the categories above (use "caption_error" when auto-captions got words wrong)
- explanation: what it means in very simple English. If caption is wrong, say what they probably said.

Also provide scene-by-scene breakdown and vocabulary suggestions.

Return as JSON:
{
  "annotations": [
    { "segment_index": 0, "excerpt": "exact words", "category": "sarcasm", "explanation": "Simple explanation...", "start_pos": 0, "end_pos": 10 }
  ],
  "scenes": [
    { "start_seg": 0, "end_seg": 5, "title": "Scene title", "explanation": "What happens and why it's funny in simple words", "humor_types": ["sarcasm"] }
  ],
  "vocabulary": [
    { "word": "chuffed", "definition": "Very happy (casual British word)", "example": "He was chuffed with his score", "category": "slang" }
  ]
}

Return ONLY valid JSON, no markdown code blocks.`, 4096, userId);

	// Strip markdown code blocks if present
	let cleaned = text.replace(/^```json\s*/m, '').replace(/\s*```\s*$/m, '').trim();

	try {
		return JSON.parse(cleaned);
	} catch {
		try {
			let fixed = cleaned;
			fixed = fixed.replace(/,\s*\{[^}]*$/s, '');
			const openBraces = (fixed.match(/\{/g) || []).length;
			const closeBraces = (fixed.match(/\}/g) || []).length;
			const openBrackets = (fixed.match(/\[/g) || []).length;
			const closeBrackets = (fixed.match(/\]/g) || []).length;
			for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += ']';
			for (let i = 0; i < openBraces - closeBraces; i++) fixed += '}';
			const result = JSON.parse(fixed);
			return {
				annotations: result.annotations || [],
				scenes: result.scenes || [],
				vocabulary: result.vocabulary || []
			};
		} catch {
			console.error('Could not parse AI response, returning empty analysis. Raw:', text.slice(0, 200));
			return { annotations: [], scenes: [], vocabulary: [] };
		}
	}
}

export async function explainSegment(
	segmentText: string,
	context: string[],
	userId: number
): Promise<string> {
	const contextStr = context.join('\n');

	return chat(`You explain English videos to someone who is still learning. Explain like you're talking to a 10-year-old — use the simplest words possible. Never use difficult words in your explanation.

Line: "${segmentText}"

Context:
${contextStr}

Give a SHORT explanation. Use markdown:

- **What they said:** Rewrite what they said in very simple, easy English (1 sentence)
- **Why it's funny/interesting:** Explain the joke or point like you're telling a friend. Keep it super simple (1-2 sentences)
- **Hard words:** List any difficult words and explain each one in baby-simple English
- **Tone:** Is this a joke? Serious? Sarcastic? Friendly teasing?

Skip sections that don't apply. No intro, just explain. Use words a child would know.`, 400, userId);
}

interface WordLookupContext {
	episodeTitle?: string;
	source?: 'transcript' | 'analysis' | 'generic';
	currentLine?: string;
	previousLine?: string;
	nextLine?: string;
}

/**
 * Per-user LRU cache for word lookups. Same word in the same context (current
 * line) returns instantly on repeat clicks — common when studying a single
 * transcript. 24h TTL, 200 entries per user.
 */
interface CachedLookup {
	value: WordEntry;
	expiresAt: number;
}
const lookupCache = new Map<string, CachedLookup>();
const LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;
const LOOKUP_CACHE_MAX = 400;

function lookupCacheKey(userId: number, word: string, context?: WordLookupContext): string {
	return [userId, word.toLowerCase().trim(), context?.currentLine || ''].join('\u0001');
}

export async function lookupWord(
	word: string,
	userId: number,
	context?: WordLookupContext
): Promise<object> {
	// --- cache hit?
	const cacheKey = lookupCacheKey(userId, word, context);
	const cached = lookupCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}

	const extraContext = [
		context?.episodeTitle ? `Episode title: ${context.episodeTitle}` : '',
		context?.source ? `Source: ${context.source}` : '',
		context?.previousLine ? `Previous line: ${context.previousLine}` : '',
		context?.currentLine ? `Current line: ${context.currentLine}` : '',
		context?.nextLine ? `Next line: ${context.nextLine}` : ''
	].filter(Boolean).join('\n');

	const isPhrase = word.trim().split(/\s+/).length > 2;
	const text = await chat(
		`You are explaining ${isPhrase ? 'a phrase or sentence' : 'a word'} to a 10-year-old child learning English. Use the SIMPLEST words possible. Short sentences. Fun and clear.

${isPhrase ? 'Phrase' : 'Word'}: "${word}"
Context: ${extraContext || 'No context.'}

Reply with valid JSON only (no markdown, no prose). All five fields are required; use "" for note if there's nothing extra to say.

Schema:
- phonetic: ${isPhrase ? '"(phrase)"' : 'IPA-style pronunciation like "/ teɪk /"'}
- partOfSpeech: ${isPhrase ? '"phrase" or "idiom" or "sentence"' : '"noun" or "verb" or "adjective" or similar'}
- definition: one simple sentence explaining what it means HERE in the video, max 20 words, like talking to a little kid
- example: one super simple example sentence, max 12 words
- note: one short sentence only if there's something extra important; otherwise "".

Example response:
{"phonetic":"/ teɪk /","partOfSpeech":"verb","definition":"To grab something and carry it away.","example":"She took the apple with her.","note":""}`,
		280,
		userId
	);

	const parsed = extractJson<WordEntry>(text);
	if (parsed) {
		// Cache successful lookups for 24h, evict oldest when over cap.
		if (lookupCache.size >= LOOKUP_CACHE_MAX) {
			const firstKey = lookupCache.keys().next().value;
			if (firstKey) lookupCache.delete(firstKey);
		}
		lookupCache.set(cacheKey, { value: parsed, expiresAt: Date.now() + LOOKUP_TTL_MS });
		return parsed;
	}
	// Log the raw response so we can diagnose JSON-parse failures without
	// resorting to print-debugging through the UI.
	console.error(
		`[lookupWord] JSON parse failed for word=${JSON.stringify(word)}. Raw response (${text.length} chars):`,
		text.slice(0, 800)
	);
	// Last-ditch fallback — at least show the word back to the user instead
	// of a broken JSON fragment.
	return {
		phonetic: '',
		partOfSpeech: '',
		definition: `Couldn't parse a definition for "${word}". Try again or check the model setting.`,
		note: ''
	};
}

interface WordEntry {
	phonetic?: string;
	partOfSpeech?: string;
	definition?: string;
	example?: string;
	note?: string;
}

export interface AnalysisResult {
	annotations: {
		segment_index: number;
		excerpt: string;
		category: string;
		explanation: string;
		start_pos: number;
		end_pos: number;
	}[];
	scenes: {
		start_seg: number;
		end_seg: number;
		title: string;
		explanation: string;
		humor_types: string[];
	}[];
	vocabulary: {
		word: string;
		definition: string;
		example: string;
		category: string;
	}[];
}

export async function generateQuiz(
	segments: { text: string }[],
	vocabulary: { word: string; definition: string; example?: string }[],
	userId: number
): Promise<{ type: string; question: string; options: string[]; correct: number; context?: string }[]> {
	// Pick a sample of segments spread across the video
	const step = Math.max(1, Math.floor(segments.length / 8));
	const sample = segments.filter((_, i) => i % step === 0).slice(0, 8);
	const transcript = sample.map((s, i) => `${i + 1}. ${s.text}`).join('\n');

	const vocabList = vocabulary.slice(0, 8)
		.map(v => `- "${v.word}": ${v.definition}`)
		.join('\n');

	const text = await chat(`You are a language learning quiz generator.

VIDEO TRANSCRIPT EXCERPTS:
${transcript}

VOCABULARY FROM THIS VIDEO:
${vocabList || '(none yet)'}

Generate 5 multiple-choice questions to test understanding of this video content. Mix:
- 2-3 comprehension questions about what was said/meant
- 2-3 vocabulary questions about words from the list (if available, else more comprehension)

Rules:
- Each question has exactly 4 options, only 1 correct
- Questions must be answerable from the transcript/vocabulary above
- Keep questions clear and concise
- correct is the 0-based index of the right answer

Reply with JSON only:
[
  {
    "type": "Comprehension",
    "question": "...",
    "options": ["A", "B", "C", "D"],
    "correct": 0,
    "context": "optional short quote from transcript"
  }
]`, 800, userId);

	try {
		const cleaned = text.replace(/^```json\s*/m, '').replace(/\s*```\s*$/m, '').trim();
		const parsed = JSON.parse(cleaned);
		if (Array.isArray(parsed)) return parsed;
		return [];
	} catch {
		return [];
	}
}
