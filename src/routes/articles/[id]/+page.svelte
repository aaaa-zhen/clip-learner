<script lang="ts">
	import { onMount } from 'svelte';
	import { BookmarkPlus, X, Sparkles, Loader2, ExternalLink, ChevronLeft, BrainCircuit, CheckCircle2, XCircle, RotateCcw } from 'lucide-svelte';
	import WordPopup from '$lib/components/WordPopup.svelte';
	import { playPronunciation } from '$lib/utils/tts';

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
	let annTtsLoading = $state(false);

	async function playAnnotationTTS() {
		if (annTtsLoading || !selectedAnnotation) return;
		annTtsLoading = true;
		try {
			await playPronunciation(selectedAnnotation.text);
		} catch {}
		annTtsLoading = false;
	}

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
		if (annotations.length > 0 && !confirm('Re-analyze will replace the current highlights. Continue?')) return;
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

	function handleWordClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.classList.contains('word-token')) return;
		e.stopPropagation();
		const word = target.textContent?.trim();
		if (!word || word.length < 2) return;
		// Close annotation popup if open
		closePopup();
		const range = document.createRange();
		range.selectNodeContents(target);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
		target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
	}

	/** Wrap each word in a clickable span */
	function tokenizeText(text: string): string {
		const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
		return escaped.replace(/(\S+)/g, '<span class="word-token">$1</span>');
	}

	onMount(() => {
		// Auto-analyze if pending and has no annotations
		if (article.status === 'pending' && annotations.length === 0) {
			runAnalysis();
		}
		// Close annotation popup when word popup opens
		const handleWordPopupOpen = () => closePopup();
		window.addEventListener('wordpopup:open', handleWordPopupOpen);
		return () => window.removeEventListener('wordpopup:open', handleWordPopupOpen);
	});

	// ── Quiz ─────────────────────────────────────────────────────────────────
	type QuizQuestion = {
		type: string; category: string; question: string;
		options: string[]; correct: number; context?: string;
	};
	type QuizAnswer = { questionIndex: number; selected: number; correct: boolean; };
	type QuizDiagnosis = {
		score: number; total: number; percentage?: number;
		comprehension?: string | Record<string, { correct: number; total: number }>;
		byCategory?: { category: string; correct: number; total: number }[];
		summary: string; recommendations: string[];
	};
	type QuizRound = 'initial' | 'adaptive';

	let quizOpen = $state(false);
	let quizPhase = $state<'idle'|'loading'|'answering'|'diagnosis'>('idle');
	let quizQuestions = $state<QuizQuestion[]>([]);
	let quizAnswers = $state<QuizAnswer[]>([]);
	let quizSelected = $state<number | null>(null);
	let quizCurrentIdx = $state(0);
	let quizDiagnosis = $state<QuizDiagnosis | null>(null);
	let quizError = $state('');
	let quizAllQuestions = $state<QuizQuestion[]>([]);
	let quizAllAnswers = $state<QuizAnswer[]>([]);
	let quizRound = $state<QuizRound>('initial');

	async function startQuiz() {
		quizOpen = true;
		quizPhase = 'loading';
		quizError = '';
		quizQuestions = [];
		quizAnswers = [];
		quizAllQuestions = [];
		quizAllAnswers = [];
		quizCurrentIdx = 0;
		quizDiagnosis = null;
		quizRound = 'initial';
		try {
			const res = await fetch('/api/quiz', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ articleId: article.id, phase: 'initial' })
			});
			const d = await res.json();
			if (!res.ok) throw new Error(d.error || 'Quiz generation failed');
			quizQuestions = d.questions || [];
			quizAllQuestions = [...quizQuestions];
			quizPhase = quizQuestions.length ? 'answering' : 'idle';
		} catch (e) {
			quizError = e instanceof Error ? e.message : 'Error';
			quizPhase = 'idle';
		}
	}

	function selectAnswer(idx: number) {
		if (quizSelected !== null) return;
		const q = quizQuestions[quizCurrentIdx];
		quizSelected = idx;
		const ans: QuizAnswer = { questionIndex: quizCurrentIdx, selected: idx, correct: idx === q.correct };
		quizAnswers = [...quizAnswers, ans];
		quizAllAnswers = [...quizAllAnswers, { ...ans, questionIndex: quizAllQuestions.indexOf(q) }];
	}

	async function nextQuestion() {
		quizSelected = null;
		if (quizCurrentIdx + 1 < quizQuestions.length) {
			quizCurrentIdx++;
			return;
		}
		// All answered — adaptive round or diagnose
		if (quizRound === 'adaptive') {
			await finishQuiz();
			return;
		}

		quizPhase = 'loading';
		try {
			const res = await fetch('/api/quiz', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					articleId: article.id,
					phase: 'adaptive',
					previousQuestions: quizQuestions,
					previousAnswers: quizAnswers
				})
			});
			const d = await res.json();
			if (!res.ok) throw new Error(d.error || 'Failed');
			if (!d.questions?.length) { await finishQuiz(); return; }
			quizQuestions = d.questions;
			quizAllQuestions = [...quizAllQuestions, ...quizQuestions];
			quizAnswers = [];
			quizCurrentIdx = 0;
			quizRound = 'adaptive';
			quizPhase = 'answering';
		} catch (e) {
			quizError = e instanceof Error ? e.message : 'Error';
			quizPhase = 'idle';
		}
	}

	async function finishQuiz() {
		quizPhase = 'loading';
		try {
			const res = await fetch('/api/quiz', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					articleId: article.id,
					phase: 'diagnose',
					questions: quizAllQuestions,
					answers: quizAllAnswers
				})
			});
			const d = await res.json();
			if (!res.ok) throw new Error(d.error || 'Failed');
			const diagnosis = d.diagnosis as QuizDiagnosis;
			quizDiagnosis = {
				...diagnosis,
				percentage: diagnosis.percentage ?? Math.round((diagnosis.score / Math.max(1, diagnosis.total)) * 100)
			};
			quizPhase = 'diagnosis';
		} catch (e) {
			quizError = e instanceof Error ? e.message : 'Error';
			quizPhase = 'idle';
		}
	}
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
		<div class="header-actions">
			<button class="analyze-btn quiz-btn" onclick={startQuiz} disabled={quizPhase === 'loading'}>
				{#if quizPhase === 'loading'}
					<Loader2 size={15} class="spin" /> Loading…
				{:else}
					<BrainCircuit size={15} /> Quiz me
				{/if}
			</button>
		</div>
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
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="article-body" onclick={handleWordClick}>
				{#each paragraphs as para, pi}
					{#if para.some(s => s.text.trim())}
						<p class="para">
							{#each para as seg}
								{#if seg.annotation}
									<button
										class="highlight {typeColor(seg.annotation.type)}"
										onclick={(e) => openAnnotation(seg.annotation!, e)}
										title={seg.annotation.explanation}
									>{@html tokenizeText(seg.text)}</button>
								{:else}
									{@html tokenizeText(seg.text)}
								{/if}
							{/each}
						</p>
					{/if}
				{/each}
			</div>
		</div>

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
				<div class="ann-popup-actions">
					<button class="ann-tts-btn" class:playing={annTtsLoading} onclick={playAnnotationTTS} aria-label="Listen to pronunciation" title="Listen">
						<svg width="14" height="11" viewBox="0 0 22 16" fill="none" overflow="visible">
							<path d="M10.15 1.9C10.1 1.51 9.64 1.33 9.34 1.59L5.33 5H1.89C1.57 5 1.29 5.23 1.24 5.55C1.14 6.18 1 7.23 1 8C1 8.77 1.14 9.82 1.24 10.45C1.29 10.77 1.57 11 1.89 11H5.33L9.34 14.41C9.64 14.67 10.1 14.49 10.15 14.1C10.28 12.88 10.5 10.5 10.5 8C10.5 5.45 10.28 3.12 10.15 1.9Z" fill="currentColor"/>
							<path class="wave wave-1" d="M14.42 4.75C15.33 5.65 15.84 6.88 15.84 8.16C15.84 9.45 15.33 10.67 14.42 11.58" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
							<path class="wave wave-2" d="M17.84 1.33C19.65 3.15 20.67 5.6 20.67 8.17C20.67 10.73 19.65 13.19 17.84 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
					</button>
					<button class="ann-popup-close" onclick={closePopup}><X size={15} /></button>
				</div>
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


{#if quizOpen}
<div class="quiz-overlay" onclick={() => { quizOpen = false; quizPhase = 'idle'; }}>
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="quiz-card" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Comprehension quiz">
	<div class=quiz-header>
		<span class=quiz-title><BrainCircuit size={15} /> Comprehension Quiz</span>
		<button class=quiz-close onclick={() => { quizOpen = false; quizPhase = 'idle'; }}><X size={15} /></button>
	</div>

	{#if quizError}
		<p class=quiz-error>{quizError}</p>
	{:else if quizPhase === 'loading'}
		<div class=quiz-loading><Loader2 size={20} class=spin /><span>Generating questions…</span></div>
	{:else if quizPhase === 'answering'}
		{@const q = quizQuestions[quizCurrentIdx]}
		<div class=quiz-progress>Question {quizCurrentIdx + 1} / {quizQuestions.length}</div>
		{#if q.context}
			<blockquote class=quiz-context>{q.context}</blockquote>
		{/if}
		<p class=quiz-question>{q.question}</p>
		<div class=quiz-options>
			{#each q.options as opt, i}
				<button
					class=quiz-option
					class:selected={quizSelected === i}
					class:correct={quizSelected !== null && i === q.correct}
					class:wrong={quizSelected === i && i !== q.correct}
					onclick={() => selectAnswer(i)}
					disabled={quizSelected !== null}
				>
					{#if quizSelected !== null}
						{#if i === q.correct}<CheckCircle2 size={13} />{:else if quizSelected === i}<XCircle size={13} />{/if}
					{/if}
					{opt}
				</button>
			{/each}
		</div>
		{#if quizSelected !== null}
			<div class=quiz-feedback>
				{#if quizSelected === q.correct}
					<span class=correct-msg>Correct!</span>
				{:else}
					<span class=wrong-msg>The correct answer is: <strong>{q.options[q.correct]}</strong></span>
				{/if}
			</div>
			<button class=quiz-next-btn onclick={nextQuestion}>
				{quizCurrentIdx + 1 < quizQuestions.length ? 'Next question →' : 'See results →'}
			</button>
		{/if}
	{:else if quizPhase === 'diagnosis' && quizDiagnosis}
		<div class=quiz-score>
			<span class=score-num>{quizDiagnosis.score}/{quizDiagnosis.total}</span>
			<span class=score-pct>{quizDiagnosis.percentage}%</span>
		</div>
		<p class=quiz-summary>{quizDiagnosis.summary}</p>
		{#if quizDiagnosis.recommendations?.length}
			<ul class=quiz-recs>
				{#each quizDiagnosis.recommendations as rec}
					<li>{rec}</li>
				{/each}
			</ul>
		{/if}
		<button class=quiz-restart-btn onclick={startQuiz}>
			<RotateCcw size={13} /> Try again
		</button>
	{/if}
</div>
</div>
{/if}

<svelte:window onkeydown={handleKeydown} />

<!-- Word popup for double-click / selection -->
<WordPopup episodeId={article.id} articleTitle={article.title} savedWords={savedWordsSet} />

<style>
	.page {
		min-height: 100vh;
		background: var(--gray1);
		display: flex;
		flex-direction: column;
	}

	/* ── Top bar ── */
	.topbar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 32px;
		background: var(--gray1);
		border-bottom: 1px solid var(--gray3);
		position: sticky;
		top: 0;
		z-index: 100;
	}

	.back-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 13px;
		color: var(--gray9);
		text-decoration: none;
		transition: color var(--duration-fast) var(--ease);
	}
	.back-btn:hover { color: var(--gray12); }

	.article-meta {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
	}

	.source-badge {
		font-size: 12px;
		font-weight: 600;
		color: var(--gray11);
		background: var(--gray3);
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
		transition: opacity var(--duration-fast) var(--ease);
	}
	.ext-link:hover { opacity: 1; }

	.analyze-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: var(--radius-pill);
		padding: 8px 18px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: background var(--duration-fast) var(--ease), opacity var(--duration-fast) var(--ease);
		min-height: auto;
	}
	.analyze-btn:hover:not(:disabled) { background: var(--accent-hover); }
	.analyze-btn:disabled { opacity: 0.5; cursor: default; }

	/* ── Main layout ── */
	.main {
		flex: 1;
		display: flex;
		justify-content: center;
		max-width: 800px;
		margin: 0 auto;
		width: 100%;
		padding: 48px 32px;
		box-sizing: border-box;
	}

	/* ── Article content ── */
	.content-wrap {
		flex: 1;
		min-width: 0;
		max-width: 720px;
	}

	.article-title {
		font-family: var(--font-display);
		font-size: 32px;
		font-weight: 500;
		color: var(--gray12);
		line-height: 1.25;
		margin: 0 0 28px;
		letter-spacing: -0.02em;
	}

	.analyze-error {
		color: var(--red);
		font-size: 13px;
		margin-bottom: 16px;
	}

	.analyzing-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--gray11);
		padding: 12px 16px;
		background: var(--gray2);
		border: 1px solid var(--gray4);
		border-radius: var(--radius-sm);
		margin-bottom: 24px;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
		margin-bottom: 28px;
		padding: 10px 14px;
		background: var(--gray2);
		border-radius: var(--radius-sm);
		border: 1px solid var(--gray3);
		font-size: 12px;
		color: var(--gray9);
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.legend-swatch {
		display: inline-block;
		width: 24px;
		height: 12px;
		border-radius: 3px;
		padding: 0;
	}

	/* ── Article body typography ── */
	.article-body {
		font-size: 18px;
		line-height: 1.9;
		color: var(--gray12);
		letter-spacing: -0.005em;
	}

	.para {
		margin: 0 0 1.5em;
	}

	:global(.word-token) {
		cursor: pointer;
		border-radius: 2px;
		transition: background 0.1s;
	}
	:global(.word-token:hover) {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.highlight {
		cursor: pointer;
		border-radius: 3px;
		padding: 1px 2px;
		transition: filter 0.1s;
		text-decoration: none;
		border: none;
		font: inherit;
		line-height: inherit;
		display: inline;
		min-height: auto;
	}
	.highlight:hover { filter: brightness(0.88); }

	.highlight-pv { background: rgba(59, 130, 246, 0.18); border-bottom: 2px solid rgba(59, 130, 246, 0.6); color: inherit; }
	.highlight-col { background: rgba(249, 115, 22, 0.15); border-bottom: 2px solid rgba(249, 115, 22, 0.55); color: inherit; }
	.highlight-idiom { background: rgba(168, 85, 247, 0.15); border-bottom: 2px solid rgba(168, 85, 247, 0.55); color: inherit; }
	.highlight-news { background: rgba(20, 184, 166, 0.15); border-bottom: 2px solid rgba(20, 184, 166, 0.5); color: inherit; }
	.highlight-grammar { background: rgba(234, 179, 8, 0.15); border-bottom: 2px solid rgba(234, 179, 8, 0.5); color: inherit; }

	/* ── Annotation type colors (popup) ── */
	.ann-popup-type.highlight-pv    { background: rgba(59,130,246,0.35);  color: #2563eb; }
	.ann-popup-type.highlight-col   { background: rgba(249,115,22,0.3); color: #ea580c; }
	.ann-popup-type.highlight-idiom { background: rgba(168,85,247,0.3); color: #9333ea; }
	.ann-popup-type.highlight-news  { background: rgba(20,184,166,0.3); color: #0d9488; }
	.ann-popup-type.highlight-grammar { background: rgba(234,179,8,0.3); color: #a16207; }

	/* ── Annotation popup ── */
	.ann-backdrop {
		position: fixed;
		inset: 0;
		z-index: 999;
	}

	.ann-popup {
		position: fixed;
		transform: translate(-50%, -100%);
		z-index: 1000;
		width: min(320px, calc(100vw - 24px));
		animation: annPopIn var(--duration-fast) var(--ease);
	}
	.ann-popup:not(.above) { transform: translate(-50%, 0); }

	@keyframes annPopIn {
		from { opacity: 0; transform: translate(-50%, -100%) translateY(6px); }
		to   { opacity: 1; transform: translate(-50%, -100%) translateY(0); }
	}
	.ann-popup:not(.above) { animation-name: annPopInBelow; }
	@keyframes annPopInBelow {
		from { opacity: 0; transform: translate(-50%, 0) translateY(-6px); }
		to   { opacity: 1; transform: translate(-50%, 0) translateY(0); }
	}

	.ann-popup-content {
		background: var(--bg-card, var(--gray2));
		border: 1px solid var(--gray4);
		border-radius: var(--radius-md);
		overflow: hidden;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.03);
	}

	.ann-popup-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 8px;
		padding: 14px 16px 10px;
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
		color: var(--gray12);
	}

	.ann-popup-type {
		font-size: 10.5px;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: var(--radius-pill);
		white-space: nowrap;
	}

	.ann-popup-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.ann-tts-btn {
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
	.ann-tts-btn:hover { transform: scale(1.08); opacity: 0.9; }
	.ann-tts-btn:active { transform: scale(0.95); }

	.ann-tts-btn .wave { opacity: 0.5; transition: opacity 0.2s; }
	.ann-tts-btn:hover .wave { opacity: 0.8; }
	.ann-tts-btn.playing .wave-1 { animation: waveIn 0.6s ease-in-out infinite alternate; }
	.ann-tts-btn.playing .wave-2 { animation: waveIn 0.6s ease-in-out 0.15s infinite alternate; }
	@keyframes waveIn { 0% { opacity: 0.15; } 100% { opacity: 1; } }

	.ann-popup-close {
		background: none;
		border: none;
		color: var(--gray8);
		cursor: pointer;
		padding: 0;
		min-height: auto;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		transition: color var(--duration-fast) var(--ease);
	}
	.ann-popup-close:hover { color: var(--gray12); }

	.ann-popup-body {
		padding: 0 16px 12px;
		border-top: 1px solid var(--gray3);
	}

	.ann-popup-exp {
		font-size: 15px;
		line-height: 1.65;
		color: var(--gray12);
		margin: 12px 0 0;
		font-weight: 500;
	}

	.ann-popup-footer {
		padding: 8px 16px 12px;
		border-top: 1px solid var(--gray3);
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
		transition: opacity var(--duration-fast) var(--ease);
	}
	.ann-save-btn:hover { opacity: 0.7; }

	.ann-saved-label {
		font-size: 13px;
		color: var(--green);
		font-weight: 500;
	}

	:global(.spin) { animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	/* ── Responsive ── */
	@media (max-width: 768px) {
		.main { padding: 24px 20px; }
		.content-wrap { max-width: 100%; }
		.article-title { font-size: 24px; }
		.article-body { font-size: 16px; line-height: 1.8; }
		.topbar { padding: 12px 16px; }
	}

	/* ── Quiz panel ── */
	.header-actions { display: flex; align-items: center; gap: 8px; }
	.quiz-btn {}
	.quiz-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(2px);
		padding: 24px;
		animation: fadeIn 0.2s ease;
	}
	@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
	.quiz-card {
		width: min(620px, 100%);
		max-height: min(720px, 90vh);
		overflow-y: auto;
		background: var(--bg-card, var(--gray2));
		border: 1px solid var(--gray4);
		border-radius: var(--radius-lg);
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
		padding: 0 0 20px;
		animation: scaleIn 0.2s ease;
	}
	@keyframes scaleIn {
		from { transform: scale(0.96) translateY(8px); opacity: 0; }
		to { transform: scale(1) translateY(0); opacity: 1; }
	}
	.quiz-header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 14px 18px;
		border-bottom: 1px solid var(--border, #333);
		position: sticky; top: 0;
		background: var(--bg-card, #1a1a1a);
	}
	.quiz-title { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: .9rem; }
	.quiz-close { background: none; border: none; cursor: pointer; color: var(--text-muted, #888); line-height: 0; padding: 2px; }
	.quiz-close:hover { color: var(--text, #eee); }
	.quiz-loading { display: flex; align-items: center; gap: 10px; padding: 32px 24px; color: var(--text-muted, #aaa); font-size: .88rem; }
	.quiz-progress { padding: 14px 24px 0; font-size: .78rem; color: var(--text-muted, #888); }
	.quiz-context { margin: 10px 24px 0; font-style: italic; color: var(--text-muted, #aaa); border-left: 3px solid var(--accent, #6b8aff); padding-left: 12px; font-size: .85rem; }
	.quiz-question { padding: 12px 24px 0; font-weight: 500; font-size: .95rem; line-height: 1.5; }
	.quiz-options { display: flex; flex-direction: column; gap: 8px; padding: 12px 24px 0; }
	.quiz-option {
		background: var(--bg, #111);
		border: 1px solid var(--border, #333);
		border-radius: 8px;
		padding: 10px 14px;
		text-align: left;
		cursor: pointer;
		font-size: .87rem;
		color: var(--text, #eee);
		display: flex; align-items: center; gap: 7px;
		transition: border-color .12s, background .12s;
	}
	.quiz-option:hover:not(:disabled) { border-color: var(--accent, #6b8aff); }
	.quiz-option.correct { border-color: #3c9; background: rgba(51,204,153,.1); }
	.quiz-option.wrong { border-color: #e05; background: rgba(238,0,85,.1); }
	.quiz-feedback { padding: 10px 24px 0; font-size: .85rem; }
	.correct-msg { color: #3c9; font-weight: 600; }
	.wrong-msg { color: var(--text-muted, #aaa); }
	.quiz-next-btn {
		margin: 14px 24px 0;
		background: var(--accent, #6b8aff);
		border: none; border-radius: 8px;
		color: #fff; font-weight: 600; font-size: .87rem;
		padding: 10px 20px; cursor: pointer;
	}
	.quiz-next-btn:hover { opacity: .9; }
	.quiz-score { display: flex; align-items: baseline; gap: 10px; padding: 24px 24px 0; }
	.score-num { font-size: 2rem; font-weight: 700; color: var(--text, #eee); }
	.score-pct { font-size: 1.1rem; color: var(--accent, #6b8aff); font-weight: 600; }
	.quiz-summary { padding: 10px 24px 0; font-size: .88rem; color: var(--text-muted, #aaa); line-height: 1.6; }
	.quiz-recs { padding: 8px 24px 0 40px; font-size: .83rem; color: var(--text-muted, #aaa); line-height: 1.6; }
	.quiz-restart-btn {
		margin: 16px 24px 0;
		background: none; border: 1px solid var(--border, #444);
		border-radius: 8px; padding: 8px 16px;
		cursor: pointer; color: var(--text-muted, #aaa);
		font-size: .84rem; display: flex; align-items: center; gap: 6px;
	}
	.quiz-restart-btn:hover { color: var(--text, #eee); border-color: var(--text-muted, #888); }
	.quiz-error { padding: 16px 24px; color: #e05; font-size: .85rem; }
</style>
