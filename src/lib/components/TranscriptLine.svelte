<script lang="ts">
	import type { HumorAnnotation, HumorCategory } from '$lib/types';
	import { categoryColors, categoryLabels } from '$lib/utils/colors';
	import { formatTime } from '$lib/utils/time';

	let {
		text,
		startTime,
		active = false,
		dimmed = false,
		annotations = [],
		segmentId,
		onseek,
		onexplain
	}: {
		text: string;
		startTime: number;
		active?: boolean;
		dimmed?: boolean;
		annotations?: HumorAnnotation[];
		segmentId: number;
		onseek?: (time: number) => void;
		onexplain?: (id: number) => void;
	} = $props();

	function handleSeek() {
		onseek?.(startTime);
	}

	function handleExplain(e: Event) {
		e.stopPropagation();
		onexplain?.(segmentId);
	}

	function handleWordClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (target.classList.contains('word-token')) {
			// Dispatch a double-click event on the word so WordPopup picks it up
			const word = target.textContent?.trim();
			if (word && word.length > 1) {
				// Select the word so WordPopup's selection handler fires
				const range = document.createRange();
				range.selectNodeContents(target);
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
				// Fire the dblclick event that WordPopup listens for
				target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
			}
		}
	}

	function findExcerptInText(text: string, excerpt: string): { start: number; end: number } | null {
		// Try exact match first
		const exact = text.toLowerCase().indexOf(excerpt.toLowerCase());
		if (exact !== -1) return { start: exact, end: exact + excerpt.length };

		// Try stripping punctuation from excerpt edges and searching
		const trimmed = excerpt.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
		if (trimmed.length >= 2) {
			const idx = text.toLowerCase().indexOf(trimmed.toLowerCase());
			if (idx !== -1) return { start: idx, end: idx + trimmed.length };
		}

		// Try matching the first significant word sequence (first 3+ words)
		const words = excerpt.trim().split(/\s+/).filter(w => w.length > 2);
		if (words.length >= 2) {
			const partial = words.slice(0, Math.min(3, words.length)).join(' ');
			const idx = text.toLowerCase().indexOf(partial.toLowerCase());
			if (idx !== -1) return { start: idx, end: Math.min(text.length, idx + excerpt.length) };
		}

		return null;
	}

	function buildHighlightedText(text: string, annotations: HumorAnnotation[]): string {
		if (annotations.length === 0) return escapeHtml(text);

		const highlights: { start: number; end: number; color: string; explanation: string; category: string; categoryLabel: string }[] = [];

		for (const ann of annotations) {
			const found = findExcerptInText(text, ann.excerpt);
			if (found) {
				const color = categoryColors[ann.category as HumorCategory] || '#888';
				const label = categoryLabels[ann.category as HumorCategory] || ann.category;
				highlights.push({ start: found.start, end: found.end, color, explanation: ann.explanation, category: ann.category, categoryLabel: label });
			}
		}

		highlights.sort((a, b) => a.start - b.start);

		let result = '';
		let pos = 0;

		for (const h of highlights) {
			if (h.start < pos) continue;
			result += escapeHtml(text.slice(pos, h.start));
			result += `<mark style="background:${h.color}35;color:${h.color};border-bottom:2.5px solid ${h.color};padding:2px 4px;border-radius:3px;font-weight:600" title="${escapeHtml(h.categoryLabel)}: ${escapeHtml(h.explanation)}" data-category="${escapeHtml(h.category)}">${escapeHtml(text.slice(h.start, h.end))}</mark>`;
			pos = h.end;
		}

		result += escapeHtml(text.slice(pos));
		return result;
	}

	function escapeHtml(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	/** Wrap each word in a clickable span for tap-to-lookup */
	function tokenize(html: string): string {
		// Split on word boundaries but preserve HTML tags (marks)
		return html.replace(/(?<=>|^)([^<]+)(?=<|$)/g, (match) => {
			return match.replace(/(\S+)/g, '<span class="word-token">$1</span>');
		});
	}

	const highlightedHtml = $derived(tokenize(buildHighlightedText(text, annotations)));
</script>

<div
	class="line"
	class:active
	class:dimmed
	data-start-time={startTime}
>
	<button class="timestamp" onclick={handleSeek} title="Seek to {formatTime(startTime)}">{formatTime(startTime)}</button>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="content" onclick={handleWordClick}>
		<p class="text">{@html highlightedHtml}</p>
		{#if annotations.length > 0}
			<div class="annotations">
				{#each annotations as ann}
					{@const color = categoryColors[ann.category as HumorCategory] || '#888'}
					{@const label = categoryLabels[ann.category as HumorCategory] || ann.category}
					<div class="annotation-card" style="border-left-color: {color}">
						<span class="ann-category" style="color: {color}">{label}</span>
						<span class="ann-explanation">{ann.explanation}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
	<button class="explain-btn" onclick={handleExplain} title="Explain this line">
		Explain
	</button>
</div>

<style>
	.line {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 11px 16px;
		transition: background 0.15s, border-color 0.15s;
		border-left: 2px solid transparent;
		border-bottom: 1px solid var(--border-light);
	}

	.line:hover {
		background: rgba(128,128,128,0.04);
	}

	.line.active {
		background: color-mix(in srgb, var(--accent) 10%, var(--bg-card));
		border-left-color: var(--accent);
		border-left-width: 3px;
	}
	.line.dimmed {
		opacity: 0.45;
	}
	.line.dimmed:hover {
		opacity: 0.75;
	}

	.timestamp {
		color: var(--text-light);
		font-family: var(--font-ui);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		min-width: 40px;
		padding-top: 4px;
		cursor: pointer;
		background: none;
		border: none;
		text-align: left;
		transition: color 0.15s;
	}
	.timestamp:hover {
		color: var(--accent);
	}

	:global(.word-token) {
		cursor: pointer;
		border-radius: 2px;
		transition: background 0.1s;
	}
	:global(.word-token:hover) {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.content {
		flex: 1;
		min-width: 0;
	}

	.text {
		margin: 0;
		line-height: 1.7;
		font-size: 15px;
		font-family: var(--font-body);
		color: var(--text-muted);
	}
	.line.active .text {
		color: var(--text);
		font-weight: 500;
		font-size: 16px;
	}
	.line.dimmed .text {
		color: var(--text-muted);
	}

	.annotations {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 10px;
	}

	.annotation-card {
		background: var(--bg-card);
		border-left: 3px solid;
		border-radius: 0 4px 4px 0;
		padding: 8px 12px;
		font-size: 14px;
		line-height: 1.6;
	}

	.ann-category {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin-right: 8px;
	}

	.ann-explanation {
		color: var(--text-muted);
		font-family: var(--font-body);
	}

	.explain-btn {
		background: transparent;
		color: var(--text-light);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill, 999px);
		padding: 4px 10px;
		font-family: var(--font-ui);
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		flex-shrink: 0;
		opacity: 0;
	}
	.line:hover .explain-btn {
		opacity: 1;
	}
	.explain-btn:hover {
		background: var(--accent);
		border-color: var(--accent);
		color: white;
	}

	@media (max-width: 768px) {
		.line {
			padding: 14px 12px;
			gap: 10px;
		}

		.text {
			font-size: 16px;
		}

		.annotation-card {
			padding: 6px 10px;
		}

		.explain-btn {
			width: 32px;
			height: 32px;
			font-size: 15px;
		}
	}
</style>
