<script lang="ts">
	import { onMount } from 'svelte';
	import { BookmarkPlus, X, Sparkles, Loader2, ExternalLink, ChevronLeft } from 'lucide-svelte';
	import WordPopup from '$lib/components/WordPopup.svelte';

	interface Annotation {
		id: number;
		article_id: string;
		type: string;
		text: string;
		explanation: string;
		start_pos: number;
		end_pos: number;
	}

	interface Article {
		id: string;
		title: string;
		url: string | null;
		source: string | null;
		content: string;
		status: string;
	}

	let { data } = $props();

	let article = $state(data.article);
	let annotations = $state<Annotation[]>(data.annotations);
	let savedWordsSet = $state(new Set(data.savedWords));

	// Analysis state
	let analyzing = $state(false);
	let analyzeError = $state('');

	// Annotation popup (inline bubble, positioned near click)
	let popupVisible = $state(false);
	let popupX = $state(0);
	let popupY = $state(0);
	let popupAbove = $state(true);
	let selectedAnnotation = $state<Annotation | null>(null);

	// Rendered content segments with highlights
	type Segment = { text: string; annotation: Annotation | null };

	let segments = $derived(buildSegments(article.content, annotations));

	function buildSegments(content: string, anns: Annotation[]): Segment[] {
		if (!anns.length) return [{ text: content, annotation: null }];

		// Sort by start_pos, resolve overlaps by taking first
		const sorted = [...anns].sort((a, b) => a.start_pos - b.start_pos);
		const result: Segment[] = [];
		let pos = 0;

		for (const ann of sorted) {
			if (ann.start_pos < pos) continue; // skip overlapping
			if (ann.end_pos > content.length) continue;
			if (ann.start_pos > pos) {
				result.push({ text: content.slice(pos, ann.start_pos), annotation: null });
			}
			result.push({ text: content.slice(ann.start_pos, ann.end_pos), annotation: ann });
			pos = ann.end_pos;
		}
		if (pos < content.length) {
			result.push({ text: content.slice(pos), annotation: null });
		}
		return result;
	}

	function typeColor(type: string): string {
		switch (type) {
			case 'phrasal_verb': return 'highlight-pv';
			case 'collocation': return 'highlight-col';
			case 'idiom': return 'highlight-idiom';
			case 'news_term': return 'highlight-news';
			case 'grammar': return 'highlight-grammar';
			default: return 'highlight-col';
		}
	}

	function typeLabel(type: string): string {
		switch (type) {
			case 'phrasal_verb': return 'Phrasal verb';
			case 'collocation': return 'Collocation';
			case 'idiom': return 'Idiom';
			case 'news_term': return 'News vocabulary';
			case 'grammar': return 'Grammar';
			default: return type;
		}
	}

	function openAnnotation(ann: Annotation, e: MouseEvent) {
		selectedAnnotation = ann;
		const popupWidth = Math.min(300, window.innerWidth - 24);
		let px = e.clientX;
		let py = e.clientY;
		// Clamp horizontal
		px = Math.max(popupWidth / 2 + 12, Math.min(px, window.innerWidth - popupWidth / 2 - 12));
		// Place above cursor if enough room, else below
		popupAbove = py > 200;
		popupX = px;
		popupY = popupAbove ? py - 12 : py + 12;
		popupVisible = true;
	}

	function closePopup() {
		popupVisible = false;
		selectedAnnotation = null;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') closePopup();
	}

	async function runAnalysis() {
		analyzing = true;
		analyzeError = '';
		try {
			const res = await fetch('/api/articles/analyze', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ articleId: article.id })
			});
			const data = await res.json();
			if (!res.ok) {
				analyzeError = data.error || 'Analysis failed.';
				return;
			}
			annotations = data.annotations || [];
			article = { ...article, status: 'ready' };
		} catch {
			analyzeError = 'Network error.';
		} finally {
			analyzing = false;
		}
	}

	async function saveAnnotationWord(ann: Annotation) {
		const res = await fetch('/api/notebook', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				word: ann.text,
				definition: ann.explanation,
				example: '',
				episode_id: null,
				category: ann.type
			})
		});
		if (res.ok || res.status === 409) {
			savedWordsSet = new Set([...savedWordsSet, ann.text.toLowerCase()]);
		}
	}

	// Render content paragraphs (split by double newline)
	let paragraphs = $derived(buildParagraphs(segments));

	type ParagraphSegment = Segment[];

	function buildParagraphs(segs: Segment[]): ParagraphSegment[] {
		const result: ParagraphSegment[] = [];
		let current: Segment[] = [];

		for (const seg of segs) {
			if (!seg.annotation) {
				// Split on double newlines
				const parts = seg.text.split(/\n\n+/);
				for (let i = 0; i < parts.length; i++) {
					const part = parts[i];
					// Single newlines within a paragraph: keep as-is
					if (part) {
						current.push({ text: part, annotation: null });
					}
					if (i < parts.length - 1) {
						result.push(current);
						current = [];
					}
				}
			} else {
				current.push(seg);
			}
		}
		if (current.length) result.push(current);
		return result.filter(p => p.some(s => s.text.trim()));
	}

	onMount(() => {
		// Auto-analyze if pending and has no annotations
		if (article.status === 'pending' && annotations.length === 0) {
			runAnalysis();
		}
	});
</script>

<div class="page">
	<!-- Top bar -->
	<header class="topbar">
		<a href="/" class="back-btn">
			<ChevronLeft size={18} />
			Home
		</a>
		<div class="article-meta">
			{#if article.source}
				<span class="source-badge">{article.source}</span>
			{/if}
			{#if article.url}
				<a href={article.url} target="_blank" rel="noopener" class="ext-link">
					<ExternalLink size={13} /> Original
				</a>
			{/if}
		</div>
		<button
			class="analyze-btn"
			onclick={runAnalysis}
			disabled={analyzing}
		>
			{#if analyzing}
				<Loader2 size={15} class="spin" /> Analyzing…
			{:else}
				<Sparkles size={15} /> {annotations.length ? 'Re-analyze' : 'Analyze'}
			{/if}
		</button>
	</header>

	<main class="main">
		<div class="content-wrap">
			<h1 class="article-title">{article.title}</h1>

			{#if analyzeError}
				<p class="analyze-error">{analyzeError}</p>
			{/if}

			{#if analyzing && annotations.length === 0}
				<div class="analyzing-banner">
					<Loader2 size={16} class="spin" />
					Analyzing for phrasal verbs, collocations, idioms…
				</div>
			{/if}

			<!-- Legend -->
			{#if annotations.length > 0}
				<div class="legend">
					<span class="legend-item"><mark class="highlight-pv legend-swatch"></mark>Phrasal verb</span>
					<span class="legend-item"><mark class="highlight-col legend-swatch"></mark>Collocation</span>
					<span class="legend-item"><mark class="highlight-idiom legend-swatch"></mark>Idiom</span>
					<span class="legend-item"><mark class="highlight-news legend-swatch"></mark>News vocab</span>
					<span class="legend-item"><mark class="highlight-grammar legend-swatch"></mark>Grammar</span>
				</div>
			{/if}

			<!-- Article body -->
			<div class="article-body">
				{#each paragraphs as para, pi}
					{#if para.some(s => s.text.trim())}
						<p class="para">
							{#each para as seg}
								{#if seg.annotation}
									<button
										class="highlight {typeColor(seg.annotation.type)}"
										onclick={(e) => openAnnotation(seg.annotation!, e)}
										title={seg.annotation.explanation}
									>{seg.text}</button>
								{:else}
									{seg.text}
								{/if}
							{/each}
						</p>
					{/if}
				{/each}
			</div>
		</div>

		<!-- Annotations sidebar -->
		{#if annotations.length > 0}
			<aside class="sidebar">
				<h2 class="sidebar-title">Language notes</h2>
				<div class="ann-list">
					{#each annotations as ann}
						<button class="ann-item" onclick={(e) => openAnnotation(ann, e)}>
							<div class="ann-header">
								<span class="ann-text">{ann.text}</span>
								<span class="ann-type {typeColor(ann.type)}">{typeLabel(ann.type)}</span>
							</div>
							<p class="ann-exp">{ann.explanation}</p>
						</button>
					{/each}
				</div>
			</aside>
		{/if}
	</main>
</div>

<!-- Annotation bubble popup -->
{#if popupVisible && selectedAnnotation}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="ann-backdrop" onclick={closePopup} onkeydown={() => {}}></div>
	<div
		class="ann-popup"
		class:above={popupAbove}
		style="left:{popupX}px; top:{popupY}px;"
		role="tooltip"
	>
		<div class="ann-popup-content">
			<div class="ann-popup-header">
				<div class="ann-popup-title">
					<span class="ann-popup-word">{selectedAnnotation.text}</span>
					<span class="ann-popup-type {typeColor(selectedAnnotation.type)}">{typeLabel(selectedAnnotation.type)}</span>
				</div>
				<button class="ann-popup-close" onclick={closePopup}><X size={15} /></button>
			</div>
			<div class="ann-popup-body">
				<p class="ann-popup-exp">{selectedAnnotation.explanation}</p>
			</div>
			<div class="ann-popup-footer">
				{#if savedWordsSet.has(selectedAnnotation.text.toLowerCase())}
					<span class="ann-saved-label">✓ Saved</span>
				{:else}
					<button class="ann-save-btn" onclick={() => saveAnnotationWord(selectedAnnotation!)}>
						<BookmarkPlus size={13} /> Save to notebook
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<svelte:window onkeydown={handleKeydown} />

<!-- Word popup for double-click / selection -->
<WordPopup episodeId={article.id} savedWords={savedWordsSet} />

<style>
	.page {
		min-height: 100vh;
		background: var(--bg);
		display: flex;
		flex-direction: column;
	}

	.topbar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 24px;
		background: var(--bg-card);
		border-bottom: 1px solid var(--border);
		position: sticky;
		top: 0;
		z-index: 100;
	}

	.back-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 13.5px;
		color: var(--text-muted);
		text-decoration: none;
		transition: color 0.12s;
	}
	.back-btn:hover { color: var(--text); }

	.article-meta {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
	}

	.source-badge {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--bg-dark);
		padding: 2px 8px;
		border-radius: var(--radius-pill);
	}

	.ext-link {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12.5px;
		color: var(--accent);
		text-decoration: none;
		opacity: 0.8;
		transition: opacity 0.12s;
	}
	.ext-link:hover { opacity: 1; }

	.analyze-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		padding: 8px 16px;
		font-size: 13.5px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: opacity 0.12s;
		min-height: auto;
	}
	.analyze-btn:disabled { opacity: 0.6; cursor: default; }

	.main {
		flex: 1;
		display: flex;
		gap: 0;
		max-width: 1200px;
		margin: 0 auto;
		width: 100%;
		padding: 32px 24px;
		gap: 32px;
		align-items: flex-start;
		box-sizing: border-box;
	}

	.content-wrap {
		flex: 1;
		min-width: 0;
	}

	.article-title {
		font-size: 26px;
		font-weight: 700;
		color: var(--text);
		line-height: 1.3;
		margin: 0 0 20px;
	}

	.analyze-error {
		color: var(--red, #e74c3c);
		font-size: 13.5px;
		margin-bottom: 16px;
	}

	.analyzing-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13.5px;
		color: var(--text-muted);
		padding: 12px 16px;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		margin-bottom: 20px;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 20px;
		font-size: 12px;
		color: var(--text-muted);
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.legend-swatch {
		display: inline-block;
		width: 28px;
		height: 14px;
		border-radius: 3px;
		padding: 0;
	}

	.article-body {
		font-size: 17px;
		line-height: 1.85;
		color: var(--text);
	}

	.para {
		margin: 0 0 1.4em;
	}

	/* Highlight styles — rendered as <button> for semantics */
	.highlight {
		cursor: pointer;
		border-radius: 2px;
		padding: 0 1px;
		transition: filter 0.1s;
		text-decoration: none;
		border: none;
		font: inherit;
		line-height: inherit;
		display: inline;
		min-height: auto;
	}
	.highlight:hover { filter: brightness(0.88); }

	.highlight-pv {
		background: rgba(59, 130, 246, 0.18);
		border-bottom: 2px solid rgba(59, 130, 246, 0.6);
		color: inherit;
	}
	.highlight-col {
		background: rgba(249, 115, 22, 0.15);
		border-bottom: 2px solid rgba(249, 115, 22, 0.55);
		color: inherit;
	}
	.highlight-idiom {
		background: rgba(168, 85, 247, 0.15);
		border-bottom: 2px solid rgba(168, 85, 247, 0.55);
		color: inherit;
	}
	.highlight-news {
		background: rgba(20, 184, 166, 0.15);
		border-bottom: 2px solid rgba(20, 184, 166, 0.5);
		color: inherit;
	}
	.highlight-grammar {
		background: rgba(234, 179, 8, 0.15);
		border-bottom: 2px solid rgba(234, 179, 8, 0.5);
		color: inherit;
	}

	/* Sidebar */
	.sidebar {
		width: 280px;
		flex-shrink: 0;
		position: sticky;
		top: 68px;
		max-height: calc(100vh - 88px);
		overflow-y: auto;
	}

	.sidebar-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin: 0 0 12px;
	}

	.ann-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.ann-item {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 10px 12px;
		text-align: left;
		cursor: pointer;
		transition: border-color 0.12s;
		min-height: auto;
		width: 100%;
	}
	.ann-item:hover { border-color: var(--accent); }

	.ann-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 4px;
	}

	.ann-text {
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
	}

	.ann-type {
		font-size: 10.5px;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: var(--radius-pill);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.ann-type.highlight-pv,    .ann-popup-type.highlight-pv    { background: rgba(59,130,246,0.2);  color: #3b82f6; }
	.ann-type.highlight-col,   .ann-popup-type.highlight-col   { background: rgba(249,115,22,0.18); color: #f97316; }
	.ann-type.highlight-idiom, .ann-popup-type.highlight-idiom { background: rgba(168,85,247,0.18); color: #a855f7; }
	.ann-type.highlight-news,  .ann-popup-type.highlight-news  { background: rgba(20,184,166,0.18); color: #14b8a6; }
	.ann-type.highlight-grammar, .ann-popup-type.highlight-grammar { background: rgba(234,179,8,0.18); color: #b45309; }

	.ann-exp {
		font-size: 12.5px;
		color: var(--text-muted);
		margin: 0;
		line-height: 1.45;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* Annotation bubble popup */
	.ann-backdrop {
		position: fixed;
		inset: 0;
		z-index: 999;
	}

	.ann-popup {
		position: fixed;
		transform: translate(-50%, -100%);
		z-index: 1000;
		width: min(300px, calc(100vw - 24px));
		animation: annPopIn 0.15s ease-out;
	}
	.ann-popup:not(.above) {
		transform: translate(-50%, 0);
	}

	@keyframes annPopIn {
		from { opacity: 0; transform: translate(-50%, -100%) translateY(6px); }
		to   { opacity: 1; transform: translate(-50%, -100%) translateY(0); }
	}
	.ann-popup:not(.above) {
		animation-name: annPopInBelow;
	}
	@keyframes annPopInBelow {
		from { opacity: 0; transform: translate(-50%, 0) translateY(-6px); }
		to   { opacity: 1; transform: translate(-50%, 0) translateY(0); }
	}

	.ann-popup-content {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
		box-shadow: 0 8px 32px rgba(0,0,0,0.18);
	}

	.ann-popup-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 8px;
		padding: 12px 14px 10px;
	}

	.ann-popup-title {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.ann-popup-word {
		font-size: 17px;
		font-weight: 700;
		color: var(--text);
	}

	.ann-popup-type {
		font-size: 10.5px;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: var(--radius-pill);
		white-space: nowrap;
	}

	.ann-popup-close {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0;
		min-height: auto;
		flex-shrink: 0;
		display: flex;
		align-items: center;
	}
	.ann-popup-close:hover { color: var(--text); }

	.ann-popup-body {
		padding: 0 14px 10px;
		border-top: 1px solid var(--border-light);
	}

	.ann-popup-exp {
		font-size: 14.5px;
		line-height: 1.65;
		color: var(--text);
		margin: 10px 0 0;
		font-weight: 500;
	}

	.ann-popup-footer {
		padding: 8px 14px 12px;
		border-top: 1px solid var(--border-light);
	}

	.ann-save-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		background: none;
		border: none;
		padding: 2px 0;
		font-size: 13px;
		font-weight: 500;
		color: var(--accent);
		cursor: pointer;
		min-height: auto;
		transition: opacity 0.12s;
	}
	.ann-save-btn:hover { opacity: 0.7; }

	.ann-saved-label {
		font-size: 13px;
		color: var(--green, #22c55e);
		font-weight: 500;
	}

	:global(.spin) {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@media (max-width: 768px) {
		.main {
			flex-direction: column;
			padding: 20px 16px;
		}
		.sidebar {
			width: 100%;
			position: static;
			max-height: none;
		}
		.article-title { font-size: 21px; }
		.article-body { font-size: 16px; }
	}
</style>
