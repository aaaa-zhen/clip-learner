import { parseSrtTime } from '$lib/utils/time';

export interface ParsedSegment {
	index: number;
	startTime: number;
	endTime: number;
	text: string;
}

const TIME_RE =
	/(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/;
const MAX_CAPTION_SECONDS = 5.5;
const MAX_CAPTION_CHARS = 96;
const MIN_MERGE_SECONDS = 1.7;
const MAX_MERGED_SECONDS = 6.5;

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

	// Whisper and compatible gateways can return anything from word-sized
	// fragments to very long cues. Normalize both ends so the UI keeps moving
	// with the video instead of pinning one large paragraph under the player.
	return reindexSegments(mergeSegments(splitLongSegments(raw).sort((a, b) => a.startTime - b.startTime)));
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
		const currentDuration = current.endTime - current.startTime;
		const currentLooksComplete = /[.!?]["']?$/.test(current.text);

		// Merge only tiny continuation fragments. Complete short sentences such
		// as "I was shocked." should stay as their own caption, while fragments
		// like "and then" can be joined with the next cue.
		if (
			currentDuration < MIN_MERGE_SECONDS &&
			!currentLooksComplete &&
			duration <= MAX_MERGED_SECONDS &&
			gap <= 1 &&
			combinedText.length <= MAX_CAPTION_CHARS
		) {
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

function splitLongSegments(segments: ParsedSegment[]): ParsedSegment[] {
	const split: ParsedSegment[] = [];

	for (const seg of segments) {
		const duration = seg.endTime - seg.startTime;
		const desiredCount = Math.max(
			1,
			Math.ceil(duration / MAX_CAPTION_SECONDS),
			Math.ceil(seg.text.length / MAX_CAPTION_CHARS)
		);

		if (desiredCount <= 1) {
			split.push({ ...seg });
			continue;
		}

		const chunks = splitTextIntoChunks(seg.text, desiredCount);
		if (chunks.length <= 1) {
			split.push({ ...seg });
			continue;
		}

		const weights = chunks.map((chunk) => Math.max(1, chunk.split(/\s+/).length));
		const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
		let cursor = seg.startTime;

		for (let i = 0; i < chunks.length; i++) {
			const endTime =
				i === chunks.length - 1
					? seg.endTime
					: Math.min(seg.endTime, cursor + (duration * weights[i]) / totalWeight);
			if (endTime > cursor) {
				split.push({
					index: split.length,
					startTime: cursor,
					endTime,
					text: chunks[i]
				});
			}
			cursor = endTime;
		}
	}

	return split;
}

function splitTextIntoChunks(text: string, targetCount: number): string[] {
	const words = text.match(/\S+/g) || [];
	if (words.length === 0 || targetCount <= 1) return [text];

	const chunks: string[] = [];
	const targetWords = Math.max(4, Math.ceil(words.length / targetCount));
	let start = 0;

	while (start < words.length) {
		const remainingChunks = targetCount - chunks.length;
		if (remainingChunks <= 1) {
			chunks.push(words.slice(start).join(' '));
			break;
		}

		const minEnd = Math.min(words.length, start + Math.max(3, targetWords - 3));
		const maxEnd = Math.min(words.length, start + targetWords + 3);
		let end = Math.min(words.length, start + targetWords);

		for (let candidate = maxEnd; candidate >= minEnd; candidate--) {
			if (/[.!?,;:]["']?$/.test(words[candidate - 1])) {
				end = candidate;
				break;
			}
		}

		if (end <= start) end = Math.min(words.length, start + targetWords);
		chunks.push(words.slice(start, end).join(' '));
		start = end;
	}

	return chunks.map((chunk) => chunk.trim()).filter(Boolean);
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
