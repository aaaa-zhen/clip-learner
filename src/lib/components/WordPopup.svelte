<script lang="ts">
	import { BookmarkPlus } from 'lucide-svelte';
	import { currentTime, isPlaying, subtitleVisible } from '$lib/stores/player';
	import { requireAuth } from '$lib/stores/auth';
	import { playPronunciation } from '$lib/utils/tts';
	import { saveGuestWord } from '$lib/utils/guestVocab';
	import { page } from '$app/stores';

	interface LookupContext {
		episodeTitle?: string;
		source?: 'transcript' | 'analysis' | 'article' | 'generic';
		sourceTime?: number | null;
		currentLine?: string;
		previousLine?: string;
		nextLine?: string;
	}

	let {
		episodeTitle = '',
		articleTitle = '',
		episodeId = '',
		savedWords = new Set<string>()
	}: {
		episodeTitle?: string;
		articleTitle?: string;
		episodeId?: string;
		savedWords?: Set<string>;
	} = $props();

	interface WordEntry {
		phrase?: string;
		phonetic?: string;
		partOfSpeech?: string;
		definition?: string;
		example?: string;
		note?: string;
	}

	let visible = $state(false);
	let loading = $state(false);
	let word = $state('');
	let entry = $state<WordEntry>({});
	let x = $state(0);
	let y = $state(0);
	let below = $state(false);
	let saved = $state(false);
	let toastVisible = $state(false);
	let toastWord = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	let ttsLoading = $state(false);
	let chinese = $state('');
	let chineseLoading = $state(false);

	let lastLookedUp = '';
	let lookupContext = $state<LookupContext | null>(null);
	let wasPlayingBeforePopup = false;
	const explainCache = new Map<string, WordEntry>();
	const translateCache = new Map<string, string>();

	function showPopup(w: string, rect: DOMRect, context: LookupContext | null = null) {
		word = w;
		entry = {};
		saved = savedWords.has(w.toLowerCase());
		chinese = '';
		chineseLoading = false;
		visible = true;
		loading = true;
		lookupContext = context;
		lastLookedUp = buildLookupKey(w, context);
		// Pause video and show subtitle while popup is open
		wasPlayingBeforePopup = $isPlaying;
		subtitleVisible.set(true);
		// Dispatch a custom event so the video player can pause
		window.dispatchEvent(new CustomEvent('wordpopup:open'));

		positionPopup(rect);
		lookupWord(w, context);
	}

	function positionPopup(rect: DOMRect) {
		const popupWidth = Math.min(280, window.innerWidth - 24);
		let px = rect.left + rect.width / 2;
		px = Math.max(popupWidth / 2 + 12, Math.min(px, window.innerWidth - popupWidth / 2 - 12));

		if (rect.top < 360) {
			// Not enough room above — show below
			below = true;
			y = rect.bottom + 10;
		} else {
			below = false;
			y = rect.top - 10;
		}
		x = px;
	}

	// Double-click to look up word directly
	function triggerLookup(selected: string, target: HTMLElement | null, rect: DOMRect) {
		const context = getLookupContext(target, selected);
		const lookupKey = buildLookupKey(selected, context);
		if (visible && lookupKey === lastLookedUp) return;

		word = selected;
		entry = {};
		saved = savedWords.has(selected.toLowerCase());
		chinese = '';
		chineseLoading = false;
		visible = true;
		loading = true;
		lookupContext = context;
		lastLookedUp = lookupKey;

		wasPlayingBeforePopup = $isPlaying;
		subtitleVisible.set(true);
		window.dispatchEvent(new CustomEvent('wordpopup:open'));

		positionPopup(rect);
		lookupWord(selected, context);
	}

	// Double-click: look up single word
	function handleDblClick(e: MouseEvent) {
		const target = e.target as HTMLElement | null;
		if (target?.closest('.popup, .backdrop, .toast')) return;

		const selection = window.getSelection();
		const selected = selection?.toString().trim() || '';
		if (!selected || selected.length < 2 || selected.length > 300) return;

		triggerLookup(selected, target, selection!.getRangeAt(0).getBoundingClientRect());
	}

	// Mouse-up: look up multi-word selection (more than one word)
	function handleMouseUp(e: MouseEvent) {
		const target = e.target as HTMLElement | null;
		if (target?.closest('.popup, .backdrop, .toast')) return;

		const selection = window.getSelection();
		const selected = selection?.toString().trim() || '';
		if (!selected || selected.length < 2 || selected.length > 300) return;

		// Only trigger for multi-word selections (single word handled by dblclick)
		const wordCount = selected.split(/\s+/).filter(Boolean).length;
		if (wordCount < 2) return;

		triggerLookup(selected, target, selection!.getRangeAt(0).getBoundingClientRect());
	}


	async function lookupWord(w: string, context: LookupContext | null = null) {
		const cacheKey = buildLookupKey(w, context);
		const cached = explainCache.get(cacheKey);
		if (cached) {
			entry = cached;
			if (entry.phrase) word = entry.phrase;
			loading = false;
			return;
		}
		try {
			const res = await fetch('/api/explain', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ word: w, context })
			});
			const data = await res.json();
			if (data.error) {
				entry = { definition: data.error };
			} else {
				entry = data.definition || { definition: 'No definition found.' };
				if (entry.phrase) word = entry.phrase;
				if (entry.definition && entry.definition !== 'No definition found.') {
					if (explainCache.size >= 200) explainCache.delete(explainCache.keys().next().value!);
					explainCache.set(cacheKey, entry);
				}
			}
		} catch {
			entry = { definition: 'Could not look up this word.' };
		} finally {
			loading = false;
		}
	}

	async function translate() {
		if (chineseLoading || chinese || !entry.definition) return;
		const tKey = word.toLowerCase() + '|' + entry.definition.slice(0, 60);
		const cachedCN = translateCache.get(tKey);
		if (cachedCN) { chinese = cachedCN; return; }
		chineseLoading = true;
		try {
			const res = await fetch('/api/translate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ word, definition: entry.definition })
			});
			if (res.ok) {
				const data = await res.json();
				chinese = data.chinese || '';
				if (chinese) {
					if (translateCache.size >= 200) translateCache.delete(translateCache.keys().next().value!);
					translateCache.set(tKey, chinese);
				}
			}
		} catch {
			// silently fail
		} finally {
			chineseLoading = false;
		}
	}

	async function playTTS() {
		if (ttsLoading || !word) return;
		ttsLoading = true;
		try {
			await playPronunciation(word);
		} catch {
			// silently fail
		} finally {
			ttsLoading = false;
		}
	}

	/** Extract the sentence containing the word, max ~120 chars */
	function trimSourceText(line: string, word: string): string {
		if (!line || line.length <= 120) return line;
		// Try to find the sentence containing the word
		const lower = line.toLowerCase();
		const idx = lower.indexOf(word.toLowerCase());
		if (idx >= 0) {
			// Expand around the word to find sentence boundaries
			let start = line.lastIndexOf('.', idx);
			if (start === -1) start = line.lastIndexOf(',', idx);
			start = start === -1 ? 0 : start + 1;
			let end = line.indexOf('.', idx + word.length);
			if (end === -1) end = line.indexOf(',', idx + word.length);
			end = end === -1 ? line.length : end + 1;
			const snippet = line.slice(start, end).trim();
			if (snippet.length <= 120) return snippet;
		}
		// Fallback: just truncate
		return line.slice(0, 117).trim() + '…';
	}

	async function saveWord() {
		if (!word || !entry.definition) return;
		const isGuest = $page.data.user?.isGuest;
		const wordData = {
			word,
			definition: entry.definition,
			example: entry.example || '',
			phonetic: entry.phonetic || '',
			source_text: trimSourceText(lookupContext?.currentLine || '', word),
			episode_id: episodeId || null,
			episode_title: episodeTitle || null,
			source_time: episodeId ? lookupContext?.sourceTime ?? $currentTime : null,
			category: entry.partOfSpeech || 'general'
		};

		try {
			if (isGuest) {
				const result = saveGuestWord(wordData);
				if (result.duplicate) { saved = true; return; }
			} else {
				const res = await fetch('/api/notebook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(wordData)
				});
				if (res.status === 401) { requireAuth(); return; }
				if (res.status === 409) { saved = true; return; }
				if (!res.ok) throw new Error('Save failed');
			}
			saved = true;
			toastWord = word;
			toastVisible = true;
			if (toastTimer) clearTimeout(toastTimer);
			toastTimer = setTimeout(() => { toastVisible = false; }, 2500);
			window.dispatchEvent(new CustomEvent('word:saved', {
				detail: { ...wordData, source_text: lookupContext?.currentLine || '' }
			}));
			window.getSelection()?.removeAllRanges();
		} catch {
			console.error('Failed to save');
		}
	}

	function dismiss() {
		visible = false;
		lastLookedUp = '';
		lookupContext = null;
		window.getSelection()?.removeAllRanges();
		subtitleVisible.set(false);
		if (wasPlayingBeforePopup) {
			window.dispatchEvent(new CustomEvent('wordpopup:close'));
		}
	}

	// Close popup when video starts playing (e.g. spacebar press)
	$effect(() => {
		if ($isPlaying && visible) {
			dismiss();
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') dismiss();
	}

	function getLookupContext(target: HTMLElement | null, selected = ''): LookupContext | null {
		const title = articleTitle || episodeTitle;
		if (!target) return title ? { episodeTitle: title, source: articleTitle ? 'article' : 'generic' } : null;

		const line = target.closest('.line') as HTMLElement | null;
		if (line) {
			const currentLine = normalizeContextText(line.querySelector('.text')?.textContent || '');
			const previousLine = getLineText(line.previousElementSibling);
			const nextLine = getLineText(line.nextElementSibling);
			const sourceTime = Number(line.dataset.startTime);

			return {
				episodeTitle: title,
				source: 'transcript',
				sourceTime: Number.isFinite(sourceTime) ? sourceTime : null,
				currentLine,
				previousLine,
				nextLine
			};
		}

		const explanation = target.closest('.explanation') as HTMLElement | null;
		if (explanation) {
			return {
				episodeTitle: title,
				source: 'analysis',
				currentLine: normalizeContextText(explanation.textContent || '')
			};
		}

		const caption = target.closest('.caption-bar') as HTMLElement | null;
		if (caption) {
			const sourceTime = Number(caption.dataset.captionStart);
			return {
				episodeTitle: title,
				source: 'transcript',
				sourceTime: Number.isFinite(sourceTime) ? sourceTime : null,
				currentLine: normalizeContextText(caption.dataset.captionText || caption.textContent || '')
			};
		}

		const paragraph = target.closest('.para') as HTMLElement | null;
		if (paragraph) {
			const currentLine = normalizeContextText(paragraph.textContent || '');
			const previousLine = getParagraphText(paragraph.previousElementSibling);
			const nextLine = getParagraphText(paragraph.nextElementSibling);

			return {
				episodeTitle: title,
				source: 'article',
				currentLine: trimAroundSelection(currentLine, selected, 1200),
				previousLine: trimContextLine(previousLine, 600),
				nextLine: trimContextLine(nextLine, 600)
			};
		}

		return title ? { episodeTitle: title, source: articleTitle ? 'article' : 'generic' } : null;
	}

	function getLineText(node: Element | null): string {
		if (!(node instanceof HTMLElement) || !node.classList.contains('line')) return '';
		return normalizeContextText(node.querySelector('.text')?.textContent || '');
	}

	function getParagraphText(node: Element | null): string {
		if (!(node instanceof HTMLElement) || !node.classList.contains('para')) return '';
		return normalizeContextText(node.textContent || '');
	}

	function normalizeContextText(text: string): string {
		return text.replace(/\s+/g, ' ').trim();
	}

	function trimContextLine(text: string, maxLength: number): string {
		if (text.length <= maxLength) return text;
		return text.slice(0, maxLength - 1).trim() + '…';
	}

	function trimAroundSelection(text: string, selected: string, maxLength: number): string {
		if (text.length <= maxLength) return text;
		const idx = selected ? text.toLowerCase().indexOf(selected.toLowerCase()) : -1;
		if (idx < 0) return trimContextLine(text, maxLength);

		const half = Math.floor(maxLength / 2);
		let start = Math.max(0, idx - half);
		let end = Math.min(text.length, start + maxLength);
		start = Math.max(0, end - maxLength);

		const prefix = start > 0 ? '…' : '';
		const suffix = end < text.length ? '…' : '';
		return prefix + text.slice(start, end).trim() + suffix;
	}

	function buildLookupKey(w: string, context: LookupContext | null): string {
		return `${w}::${context?.episodeTitle || ''}::${context?.currentLine || ''}::${context?.source || ''}`;
	}
</script>

<svelte:window
	ondblclick={handleDblClick}
	onmouseup={handleMouseUp}
	onkeydown={handleKeydown}
/>

{#if toastVisible}
	<div class="toast">Saved to notebook</div>
{/if}

{#if visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="backdrop" onclick={dismiss} onkeydown={() => {}}></div>
	<div class="popup" class:below style="left: {x}px; top: {y}px;" role="tooltip">
		<div class="popup-content">
			<div class="popup-header">
				<span class="popup-word">{word}</span>
				<div class="popup-header-actions">
						<button class="tts-btn" class:playing={ttsLoading} onclick={playTTS} aria-label="Listen to pronunciation" title="Listen">
							<svg class="speaker-icon" width="14" height="11" viewBox="0 0 22 16" fill="none" overflow="visible">
								<path d="M10.15 1.9C10.1 1.51 9.64 1.33 9.34 1.59L5.33 5H1.89C1.57 5 1.29 5.23 1.24 5.55C1.14 6.18 1 7.23 1 8C1 8.77 1.14 9.82 1.24 10.45C1.29 10.77 1.57 11 1.89 11H5.33L9.34 14.41C9.64 14.67 10.1 14.49 10.15 14.1C10.28 12.88 10.5 10.5 10.5 8C10.5 5.45 10.28 3.12 10.15 1.9Z" fill="currentColor"/>
								<path class="wave wave-1" d="M14.42 4.75C15.33 5.65 15.84 6.88 15.84 8.16C15.84 9.45 15.33 10.67 14.42 11.58" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
								<path class="wave wave-2" d="M17.84 1.33C19.65 3.15 20.67 5.6 20.67 8.17C20.67 10.73 19.65 13.19 17.84 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						</button>
						<button class="popup-close" onclick={dismiss} aria-label="Close word lookup">&times;</button>
					</div>
				</div>
			{#if entry.phonetic || entry.partOfSpeech}
				<div class="popup-meta">
					{#if entry.phonetic}<span class="popup-phonetic">{entry.phonetic}</span>{/if}
					{#if entry.partOfSpeech}<span class="popup-pos">{entry.partOfSpeech}</span>{/if}
				</div>
			{/if}

			{#if loading}
				<div class="popup-loading">
					<svg class="spinner" viewBox="0 0 24 24" fill="none" aria-label="Loading…">
						<circle cx="12" cy="12" r="9" stroke="var(--border)" stroke-width="2"/>
						<path d="M12 3 a9 9 0 0 1 9 9" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
					</svg>
				</div>
			{:else}
				<div class="popup-body">
					{#if entry.definition}
						<p class="popup-def">{entry.definition}</p>
					{/if}
					{#if chinese}
						<p class="popup-chinese">{chinese}</p>
					{:else if entry.definition}
						<button class="translate-btn" onclick={translate} disabled={chineseLoading}>
							{chineseLoading ? '翻译中…' : '译'}
						</button>
					{/if}
					{#if entry.example}
						<p class="popup-example">e.g. "{entry.example}"</p>
					{/if}
					{#if entry.note}
						<p class="popup-note">{entry.note}</p>
					{/if}
				</div>
				<div class="popup-footer">
					<button class="popup-save" class:saved onclick={saveWord} disabled={saved}>
						<BookmarkPlus size={13} strokeWidth={2} />
						{saved ? 'Saved!' : 'Save word'}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 999;
	}

	.popup {
		position: fixed;
		transform: translate(-50%, -100%);
		z-index: 1000;
		width: min(280px, calc(100vw - 24px));
		animation: popupInAbove 0.15s ease-out;
	}
	.popup.below {
		transform: translate(-50%, 0);
		animation: popupInBelow 0.15s ease-out;
	}

	@keyframes popupInAbove {
		from { opacity: 0; transform: translate(-50%, -100%) translateY(6px); }
		to   { opacity: 1; transform: translate(-50%, -100%) translateY(0); }
	}
	@keyframes popupInBelow {
		from { opacity: 0; transform: translate(-50%, 0) translateY(-6px); }
		to   { opacity: 1; transform: translate(-50%, 0) translateY(0); }
	}

	.popup-content {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.03);
	}

	.popup-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 12px 14px 10px;
	}

	.popup-word {
		font-family: var(--font-ui);
		font-size: 18px;
		font-weight: 700;
		color: var(--text);
		letter-spacing: -0.01em;
	}

	.popup-meta {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 14px 10px;
	}

	.popup-phonetic {
		font-size: 12.5px;
		color: var(--text-light);
		font-family: var(--font-ui);
	}

	.popup-pos {
		font-size: 11px;
		color: var(--accent);
		font-style: italic;
		font-weight: 500;
		background: var(--accent-soft);
		padding: 1px 7px;
		border-radius: var(--radius-pill);
	}

	.popup-header-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}
	.tts-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 7px;
		background: var(--accent, #4285f4);
		border: none;
		color: #fff;
		cursor: pointer;
		padding: 0;
		min-height: auto;
		min-width: auto;
		transition: transform 0.15s, opacity 0.15s;
	}
	.tts-btn:hover { transform: scale(1.08); opacity: 0.9; }
	.tts-btn:active { transform: scale(0.95); }

	.speaker-icon .wave {
		opacity: 0.5;
		transition: opacity 0.2s;
	}
	.tts-btn:hover .wave { opacity: 0.8; }

	.tts-btn.playing .wave-1 {
		animation: waveIn 0.6s ease-in-out infinite alternate;
	}
	.tts-btn.playing .wave-2 {
		animation: waveIn 0.6s ease-in-out 0.15s infinite alternate;
	}

	@keyframes waveIn {
		0%   { opacity: 0.15; }
		100% { opacity: 1; }
	}
	.popup-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		background: none;
		border: none;
		font-size: 18px;
		color: var(--text-light);
		cursor: pointer;
		padding: 0;
		line-height: 1;
		min-height: auto;
		min-width: auto;
	}
	.popup-close:hover { color: var(--text); }

	.popup-loading {
		display: flex;
		justify-content: center;
		padding: 18px 0 22px;
	}

	.spinner {
		width: 24px;
		height: 24px;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.popup-body {
		display: flex;
		flex-direction: column;
		gap: 0;
		padding: 0 14px 4px;
		border-top: 1px solid var(--border-light);
	}

	.popup-def {
		font-size: 15px;
		line-height: 1.65;
		color: var(--text);
		margin: 0;
		padding: 12px 0 8px;
		white-space: pre-line;
		font-weight: 500;
	}

	.translate-btn {
		display: inline-flex;
		align-items: center;
		background: var(--bg-dark);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		padding: 2px 8px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		cursor: pointer;
		margin: 2px 0 6px;
		min-height: auto;
		transition: border-color 0.12s, color 0.12s;
	}
	.translate-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
	.translate-btn:disabled { opacity: 0.5; cursor: default; }
	.popup-chinese {
		font-size: 13.5px;
		color: var(--text-muted);
		margin: 0 0 6px;
		line-height: 1.5;
	}
	.popup-example {
		font-size: 13px;
		line-height: 1.5;
		color: var(--accent);
		margin: 0;
		padding-bottom: 8px;
		font-style: italic;
	}

	.popup-note {
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-muted);
		margin: 0;
		padding: 8px 0;
		border-top: 1px solid var(--border-light);
	}

	.popup-footer {
		padding: 8px 14px 12px;
		border-top: 1px solid var(--border-light);
	}

	.popup-save {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		background: none;
		border: none;
		padding: 2px 0;
		font-family: var(--font-ui);
		font-size: 13px;
		font-weight: 500;
		color: var(--accent);
		cursor: pointer;
		transition: opacity 0.15s;
		min-height: auto;
	}
	.popup-save:hover:not(:disabled) { opacity: 0.7; }

	.popup-save.saved {
		color: var(--green);
		cursor: default;
	}

	@media (max-width: 768px) {
		.popup {
			width: 90vw;
			max-width: 300px;
		}
	}

	.toast {
		position: fixed;
		bottom: 48px;
		left: 50%;
		transform: translateX(-50%);
		background: #0f0f0f;
		border-radius: 8px;
		padding: 8px 16px;
		font-family: var(--font-ui);
		font-size: 14px;
		font-weight: 500;
		color: #fff;
		white-space: nowrap;
		z-index: 2000;
		animation: toastIn 0.2s ease-out;
		pointer-events: none;
	}
	@keyframes toastIn {
		from { opacity: 0; transform: translateX(-50%) translateY(8px); }
		to   { opacity: 1; transform: translateX(-50%) translateY(0); }
	}
</style>
