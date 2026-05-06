import { parseSrtTime } from '$lib/utils/time';

export interface ParsedSegment {
	index: number;
	startTime: number;
	endTime: number;
	text: string;
}

const TIME_RE =
	/(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/;
const MAX_MERGED_SECONDS = 12;
const MAX_MERGED_CHARS = 220;
const MAX_MERGE_GAP_SECONDS = 1.2;

export function parseSrt(content: string): ParsedSegment[] {
	const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '');
	const blocks = normalized.trim().split(/\n\s*\n/);
	const raw: ParsedSegment[] = [];

	for (const block of blocks) {
		const lines = block
			.trim()
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
		if (lines.length < 2) continue;

		const timeLineIndex = lines.findIndex((line) => TIME_RE.test(line));
		if (timeLineIndex === -1) continue;

		const timeLine = lines[timeLineIndex];
		const timeMatch = timeLine.match(TIME_RE);
		if (!timeMatch) continue;

		const startTime = parseSrtTime(timeMatch[1]);
		const endTime = parseSrtTime(timeMatch[2]);
		const text = cleanCaptionText(lines.slice(timeLineIndex + 1).join(' '));

		if (!text || !(endTime > startTime)) continue;

		raw.push({ index: raw.length, startTime, endTime, text });
	}

	// Whisper and compatible gateways often return word-sized fragments. Keep
	// those as sentence-like captions so shadowing follows the original line
	// instead of jumping through artificial chunks.
	return reindexSegments(mergeSegments(raw.sort((a, b) => a.startTime - b.startTime)));
}

function cleanCaptionText(text: string): string {
	return text
		.replace(/<[^>]+>/g, '') // remove HTML tags
		.replace(/\[[^\]]*]/g, '') // remove [Music] etc.
		.replace(/^>>\s*/g, '') // remove leading >>
		.replace(/\s*>>\s*/g, ' - ') // replace >> with dash for speaker changes
		.replace(/\s+/g, ' ')
		.trim();
}

function reindexSegments(segments: ParsedSegment[]): ParsedSegment[] {
	return segments.map((seg, index) => ({ ...seg, index }));
}

function mergeSegments(segments: ParsedSegment[]): ParsedSegment[] {
	if (segments.length === 0) return [];

	const merged: ParsedSegment[] = [];
	let current = { ...segments[0] };

	for (let i = 1; i < segments.length; i++) {
		const seg = segments[i];
		const duration = seg.endTime - current.startTime;
		const gap = seg.startTime - current.endTime;
		const combinedText = `${current.text} ${seg.text}`;

		if (shouldMergeCaption(current, seg, combinedText, duration, gap)) {
			current.endTime = seg.endTime;
			current.text = combinedText;
		} else {
			current.index = merged.length;
			merged.push(current);
			current = { ...seg };
		}
	}

	current.index = merged.length;
	merged.push(current);

	// Deduplicate repeated text (common in auto-captions)
	return merged.map(seg => ({
		...seg,
		text: deduplicateText(seg.text)
	}));
}

function shouldMergeCaption(
	current: ParsedSegment,
	next: ParsedSegment,
	combinedText: string,
	duration: number,
	gap: number
): boolean {
	if (gap > MAX_MERGE_GAP_SECONDS) return false;
	if (combinedText.length > MAX_MERGED_CHARS) return false;
	if (duration > MAX_MERGED_SECONDS) return false;
	if (!endsSentence(current.text)) return true;
	return startsLikeContinuation(next.text);
}

function endsSentence(text: string): boolean {
	return /[.!?]["')\]]?$/.test(text.trim());
}

function startsLikeContinuation(text: string): boolean {
	return /^(and|but|or|so|because|then|that|which|who|when|while|where|what|why|how|to|of|in|on|for|with|from|as|at|by)\b/i.test(
		text.trim()
	);
}

function deduplicateText(text: string): string {
	const words = text.split(' ');
	const result: string[] = [];
	let i = 0;

	while (i < words.length) {
		// Check for repeated phrases (2-5 words)
		let found = false;
		for (let len = 2; len <= 5 && i + len * 2 <= words.length; len++) {
			const phrase = words.slice(i, i + len).join(' ');
			const next = words.slice(i + len, i + len * 2).join(' ');
			if (phrase.toLowerCase() === next.toLowerCase()) {
				result.push(...words.slice(i, i + len));
				i += len * 2;
				found = true;
				break;
			}
		}
		if (!found) {
			result.push(words[i]);
			i++;
		}
	}

	return result.join(' ');
}
