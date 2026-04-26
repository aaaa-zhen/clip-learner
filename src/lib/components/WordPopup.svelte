<script lang="ts">
	import { BookmarkPlus, Volume2 } from 'lucide-svelte';
	import { isPlaying, subtitleVisible } from '$lib/stores/player';
	import { requireAuth } from '$lib/stores/auth';

	interface LookupContext {
		episodeTitle?: string;
		source?: 'transcript' | 'analysis' | 'generic';
		currentLine?: string;
		previousLine?: string;
		nextLine?: string;
	}

	let {
		episodeTitle = '',
		episodeId = '',
		savedWords = new Set<string>()
	}: {
		episodeTitle?: string;
		episodeId?: string;
		savedWords?: Set<string>;
	} = $props();

	interface WordEntry {
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
	let saved = $state(false);
	let toastVisible = $state(false);
	let toastWord = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	let ttsLoading = $state(false);
	let ttsAudio: HTMLAudioElement | null = null;
	let chinese = $state('');
	let chineseLoading = $state(false);

	let lastLookedUp = '';
	let lookupContext = $state<LookupContext | null>(null);
	let wasPlayingBeforePopup = false;

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

		const popupWidth = Math.min(280, window.innerWidth - 24);

		let px = rect.left + rect.width / 2;
		let py = rect.top - 12;

		px = Math.max(popupWidth / 2 + 12, Math.min(px, window.innerWidth - popupWidth / 2 - 12));

		if (py < 180) {
			py = rect.bottom + 12;
		}

		x = px;
		y = py;

		lookupWord(w, context);
	}

	// Double-click to look up word directly
	function triggerLookup(selected: string, target: HTMLElement | null, rect: DOMRect) {
		const context = getLookupContext(target);
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

		const popupWidth = Math.min(280, window.innerWidth - 24);
		let px = rect.left + rect.width / 2;
		let py = rect.top - 12;
		px = Math.max(popupWidth / 2 + 12, Math.min(px, window.innerWidth - popupWidth / 2 - 12));
		if (py < 180) py = rect.bottom + 12;

		x = px;
		y = py;

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
		try {
			const res = await fetch('/api/explain', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ word: w, context })
			});
			const data = await res.json();
			entry = data.definition || { definition: 'No definition found.' };
		} catch {
			entry = { definition: 'Could not look up this word.' };
		} finally {
			loading = false;
		}
	}

	async function translate() {
		if (chineseLoading || chinese || !entry.definition) return;
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
			const res = await fetch('/api/tts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: word })
			});
			if (!res.ok) return;
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			if (ttsAudio) {
				ttsAudio.pause();
				URL.revokeObjectURL(ttsAudio.src);
			}
			ttsAudio = new Audio(url);
			ttsAudio.play();
			ttsAudio.onended = () => URL.revokeObjectURL(url);
		} catch {
			// silently fail
		} finally {
			ttsLoading = false;
		}
	}

	async function saveWord() {
		if (!word || !entry.definition) return;
		try {
			const res = await fetch('/api/notebook', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					word,
					definition: entry.definition,
					example: entry.example || '',
					episode_id: episodeId || null,
					category: entry.partOfSpeech || 'general'
				})
			});
			if (res.status === 401) {
				requireAuth();
				return;
			}
			if (res.status === 409) {
				saved = true;
				return;
			}
			if (!res.ok) {
				throw new Error('Save failed');
			}
			saved = true;
			// Show toast (use toastWord so it persists after popup closes)
			toastWord = word;
			toastVisible = true;
			if (toastTimer) clearTimeout(toastTimer);
			toastTimer = setTimeout(() => { toastVisible = false; }, 2500);
			// Notify episode page to increment count + update notebook drawer
			window.dispatchEvent(new CustomEvent('word:saved', {
				detail: { word, definition: entry.definition, example: entry.example, category: 'vocabulary' }
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

	function getLookupContext(target: HTMLElement | null): LookupContext | null {
		if (!target) return episodeTitle ? { episodeTitle, source: 'generic' } : null;

		const line = target.closest('.line') as HTMLElement | null;
		if (line) {
			const currentLine = line.querySelector('.text')?.textContent?.trim() || '';
			const previousLine = getLineText(line.previousElementSibling);
			const nextLine = getLineText(line.nextElementSibling);

			return {
				episodeTitle,
				source: 'transcript',
				currentLine,
				previousLine,
				nextLine
			};
		}

		const explanation = target.closest('.explanation') as HTMLElement | null;
		if (explanation) {
			return {
				episodeTitle,
				source: 'analysis',
				currentLine: explanation.textContent?.trim() || ''
			};
		}

		return episodeTitle ? { episodeTitle, source: 'generic' } : null;
	}

	function getLineText(node: Element | null): string {
		if (!(node instanceof HTMLElement) || !node.classList.contains('line')) return '';
		return node.querySelector('.text')?.textContent?.trim() || '';
	}

	function buildLookupKey(w: string, context: LookupContext | null): string {
		return `${w}::${context?.currentLine || ''}::${context?.source || ''}`;
	}
</script>

<svelte:window
	ondblclick={handleDblClick}
	onmouseup={handleMouseUp}
	onkeydown={handleKeydown}
/>

{#if toastVisible}
	<div class="toast">
		<span class="toast-check">✓</span> "<strong>{toastWord}</strong>" saved to notebook
	</div>
{/if}

{#if visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="backdrop" onclick={dismiss} onkeydown={() => {}}></div>
	<div class="popup" style="left: {x}px; top: {y}px;" role="tooltip">
		<div class="popup-content">
			<div class="popup-header">
				<span class="popup-word">{word}</span>
				<div class="popup-header-actions">
					<button class="tts-btn" class:loading={ttsLoading} onclick={playTTS} aria-label="Listen to pronunciation" title="Listen">
						<Volume2 size={14} strokeWidth={2} />
					</button>
					<button class="popup-close" onclick={dismiss}>&times;</button>
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
		animation: popupIn 0.15s ease-out;
	}

	@keyframes popupIn {
		from {
			opacity: 0;
			transform: translate(-50%, -100%) translateY(6px);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -100%) translateY(0);
		}
	}

	.popup-content {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
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
		border-radius: var(--radius-sm);
		background: none;
		border: none;
		color: var(--text-light);
		cursor: pointer;
		padding: 0;
		min-height: auto;
		min-width: auto;
		transition: color 0.12s, background 0.12s;
	}
	.tts-btn:hover { color: var(--accent); background: var(--accent-soft); }
	.tts-btn.loading { opacity: 0.5; cursor: default; }
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
		bottom: 28px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-left: 3px solid var(--green);
		border-radius: 10px;
		padding: 10px 18px;
		font-size: 13.5px;
		color: var(--text);
		box-shadow: 0 4px 20px rgba(0,0,0,0.15);
		white-space: nowrap;
		z-index: 2000;
		animation: toastIn 0.2s ease-out;
		pointer-events: none;
	}
	.toast-check { color: var(--green); font-weight: 700; margin-right: 4px; }
	@keyframes toastIn {
		from { opacity: 0; transform: translateX(-50%) translateY(8px); }
		to   { opacity: 1; transform: translateX(-50%) translateY(0); }
	}
</style>
