<script lang="ts">
	import {
		ArrowLeft,
		BookMarked,
		BookOpen,
		CheckCircle,
		Eye,
		RotateCcw,
		Search,
		Target,
		Trash2,
		Volume2
	} from 'lucide-svelte';

	let { data } = $props();

	type NotebookEntry = (typeof data.entries)[number];
	type FilterMode = 'review' | 'learning' | 'mastered' | 'all';

	let entries = $state<NotebookEntry[]>([]);
	let ttsLoading = $state<number | null>(null);
	let ttsAudio: HTMLAudioElement | null = null;
	let filterMode = $state<FilterMode>('review');
	let search = $state('');
	let reviewIndex = $state(0);
	let reviewRevealed = $state(false);

	$effect(() => {
		entries = data.entries;
	});

	const reviewQueue = $derived.by(() =>
		entries
			.filter((entry) => isDueForReview(entry))
			.sort((a, b) => reviewSortValue(a) - reviewSortValue(b))
	);
	const reviewEntry = $derived(reviewQueue[reviewIndex] ?? reviewQueue[0] ?? null);
	const learningEntries = $derived(entries.filter((entry) => (entry.confidence ?? 0) < 5));
	const masteredEntries = $derived(entries.filter((entry) => (entry.confidence ?? 0) >= 5));
	const reviewedEntries = $derived(entries.filter((entry) => !!entry.reviewed_at));
	const filteredEntries = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return entries.filter((entry) => {
			if (filterMode === 'review' && !isDueForReview(entry)) return false;
			if (filterMode === 'learning' && (entry.confidence ?? 0) >= 5) return false;
			if (filterMode === 'mastered' && (entry.confidence ?? 0) < 5) return false;
			if (!q) return true;
			return [entry.word, entry.definition, entry.example, entry.category, entry.episode_title]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(q));
		});
	});

	const filterOptions: { id: FilterMode; label: string }[] = [
		{ id: 'review', label: 'Review queue' },
		{ id: 'learning', label: 'Learning' },
		{ id: 'mastered', label: 'Mastered' },
		{ id: 'all', label: 'All words' }
	];

	async function playTTS(word: string, id: number) {
		if (ttsLoading !== null) return;
		ttsLoading = id;
		try {
			const res = await fetch('/api/tts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: word })
			});
			if (!res.ok) return;
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			if (ttsAudio) { ttsAudio.pause(); URL.revokeObjectURL(ttsAudio.src); }
			ttsAudio = new Audio(url);
			ttsAudio.play();
			ttsAudio.onended = () => URL.revokeObjectURL(url);
		} catch {
			// silently fail
		} finally {
			ttsLoading = null;
		}
	}

	async function removeWord(id: number) {
		try {
			await fetch('/api/notebook', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			entries = entries.filter((e: any) => e.id !== id);
		} catch {
			console.error('Failed to remove word');
		}
	}

	async function reviewWord(entry: NotebookEntry, confidence: number) {
		const nextConfidence = Math.max(0, Math.min(5, confidence));
		const queueLength = reviewQueue.length;
		try {
			const res = await fetch('/api/notebook', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: entry.id, confidence: nextConfidence })
			});
			if (!res.ok) return;
			const reviewedAt = new Date().toISOString();
			entries = entries.map((item) =>
				item.id === entry.id
					? { ...item, confidence: nextConfidence, reviewed_at: reviewedAt }
					: item
			);
			reviewRevealed = false;
			if (queueLength <= 1) {
				reviewIndex = 0;
			} else if (reviewIndex >= queueLength - 1) {
				reviewIndex = 0;
			}
		} catch {
			console.error('Failed to update review');
		}
	}

	function isDueForReview(entry: NotebookEntry): boolean {
		const confidence = entry.confidence ?? 0;
		if (confidence >= 5) return false;
		if (!entry.reviewed_at) return true;

		const intervals = [
			0,
			12 * 60 * 60 * 1000,
			24 * 60 * 60 * 1000,
			3 * 24 * 60 * 60 * 1000,
			7 * 24 * 60 * 60 * 1000
		];
		const interval =
			intervals[Math.min(confidence, intervals.length - 1)] ?? intervals[intervals.length - 1];
		return Date.now() - dateValue(entry.reviewed_at) >= interval;
	}

	function reviewSortValue(entry: NotebookEntry): number {
		if (!entry.reviewed_at) return 0;
		return dateValue(entry.reviewed_at);
	}

	function dateValue(value: string): number {
		const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
		const time = new Date(normalized).getTime();
		return Number.isFinite(time) ? time : 0;
	}

	function confidenceLabel(confidence: number | null | undefined): string {
		const value = confidence ?? 0;
		if (value >= 5) return 'Mastered';
		if (value >= 3) return 'Familiar';
		if (value >= 1) return 'Learning';
		return 'New';
	}

	function reviewedLabel(value: string | null | undefined): string {
		if (!value) return 'Never reviewed';
		const elapsed = Date.now() - dateValue(value);
		const days = Math.floor(elapsed / (24 * 60 * 60 * 1000));
		if (days <= 0) return 'Reviewed today';
		if (days === 1) return 'Reviewed yesterday';
		return `Reviewed ${days} days ago`;
	}

	function nextConfidence(entry: NotebookEntry) {
		return Math.min(5, Math.max(2, (entry.confidence ?? 0) + 1));
	}
</script>

<svelte:head>
	<title>Vocabulary Notebook — Clip Learner</title>
</svelte:head>

<div class="notebook-page">
	<header>
		<a href="/" class="back">
			<ArrowLeft size={13} aria-hidden="true" />
			Back
		</a>
		<div class="header-title">
			<BookMarked size={16} aria-hidden="true" />
			<h1>Notebook</h1>
		</div>
		<span class="word-count">{entries.length} {entries.length === 1 ? 'word' : 'words'}</span>
	</header>

	<hr class="dotted-sep" />

	{#if entries.length === 0}
		<div class="empty">
			<BookOpen size={32} aria-hidden="true" />
			<p>Your notebook is empty.</p>
			<p class="empty-sub">Save words while studying clips to build your vocabulary.</p>
			<a href="/" class="btn">
				Find a clip to study
			</a>
		</div>
	{:else}
			<section class="review-surface" aria-label="Vocabulary review">
				<div class="review-card">
					<div class="review-kicker">
						<Target size={14} aria-hidden="true" />
						Review queue
					</div>
					{#if reviewEntry}
						<div class="review-word-row">
							<div>
								<p class="review-word">{reviewEntry.word}</p>
								<p class="review-meta">
									{confidenceLabel(reviewEntry.confidence)}
									{#if reviewEntry.episode_title} · {reviewEntry.episode_title}{/if}
								</p>
							</div>
							<button
								class="sound-btn visible"
								class:loading={ttsLoading === reviewEntry.id}
								onclick={() => playTTS(reviewEntry.word, reviewEntry.id)}
								aria-label={`Listen to ${reviewEntry.word}`}
								title="Listen"
							>
								<Volume2 size={14} aria-hidden="true" />
							</button>
						</div>

						{#if reviewRevealed}
							<div class="review-answer">
								<p>{reviewEntry.definition}</p>
								{#if reviewEntry.example}<blockquote>{reviewEntry.example}</blockquote>{/if}
							</div>
							<div class="review-actions">
								<button class="review-btn ghost" onclick={() => reviewWord(reviewEntry, 0)}>
									<RotateCcw size={14} aria-hidden="true" />
									Again
								</button>
								<button class="review-btn" onclick={() => reviewWord(reviewEntry, nextConfidence(reviewEntry))}>
									<CheckCircle size={14} aria-hidden="true" />
									Got it
								</button>
								<button class="review-btn strong" onclick={() => reviewWord(reviewEntry, 5)}>
									Mastered
								</button>
							</div>
						{:else}
							<button class="reveal-btn" onclick={() => reviewRevealed = true}>
								<Eye size={15} aria-hidden="true" />
								Show meaning
							</button>
						{/if}
					{:else}
						<div class="review-done">
							<CheckCircle size={28} aria-hidden="true" />
							<p>No words are due right now.</p>
							<span>{masteredEntries.length} mastered · {learningEntries.length} still learning</span>
						</div>
					{/if}
				</div>

				<div class="review-stats" aria-label="Notebook status">
					<div class="stat">
						<strong>{reviewQueue.length}</strong>
						<span>Due</span>
					</div>
					<div class="stat">
						<strong>{learningEntries.length}</strong>
						<span>Learning</span>
					</div>
					<div class="stat">
						<strong>{masteredEntries.length}</strong>
						<span>Mastered</span>
					</div>
					<div class="stat">
						<strong>{reviewedEntries.length}</strong>
						<span>Reviewed</span>
					</div>
				</div>
			</section>

			<section class="library-tools" aria-label="Notebook filters">
				<div class="filters" role="group" aria-label="Filter words">
					{#each filterOptions as option}
						<button
							class="filter-btn"
							class:active={filterMode === option.id}
							aria-pressed={filterMode === option.id}
							onclick={() => filterMode = option.id}
						>
							{option.label}
						</button>
					{/each}
				</div>
				<label class="search-box">
					<Search size={14} aria-hidden="true" />
					<input bind:value={search} placeholder="Search saved words" />
				</label>
			</section>

			<div class="entries">
				{#if filteredEntries.length === 0}
					<div class="empty-list">
						<p>No words match this view.</p>
					</div>
				{:else}
					{#each filteredEntries as entry}
						<div class="entry" class:due={isDueForReview(entry)} class:mastered={(entry.confidence ?? 0) >= 5}>
							<div class="entry-header">
								<div class="entry-title">
									<strong class="word">{entry.word}</strong>
									<span class="category">{entry.category || 'general'}</span>
								</div>
								<div class="entry-actions">
									<button
										class="sound-btn"
										class:loading={ttsLoading === entry.id}
										onclick={() => playTTS(entry.word, entry.id)}
										aria-label={`Listen to ${entry.word}`}
										title="Listen"
									>
										<Volume2 size={13} aria-hidden="true" />
									</button>
									<button
										class="remove"
										onclick={() => removeWord(entry.id)}
										aria-label={`Remove ${entry.word}`}
									>
										<Trash2 size={13} aria-hidden="true" />
									</button>
								</div>
							</div>
							<p class="definition">{entry.definition}</p>
							{#if entry.example}
								<p class="example">"{entry.example}"</p>
							{/if}
							<div class="entry-review-row">
								<div class="confidence">
									<span>{confidenceLabel(entry.confidence)}</span>
									<div class="confidence-track" aria-hidden="true">
										<div class="confidence-fill" style="width: {Math.min(100, ((entry.confidence ?? 0) / 5) * 100)}%"></div>
									</div>
								</div>
								<span class="reviewed-at">{reviewedLabel(entry.reviewed_at)}</span>
								<button
									class="quick-review"
									onclick={() => reviewWord(entry, nextConfidence(entry))}
								>
									Review
								</button>
							</div>
							{#if entry.episode_title}
								<p class="source">From {entry.episode_title}</p>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	</div>

<style>
	.notebook-page {
		max-width: 980px;
		margin: 0 auto;
		padding: 0 24px 88px;
	}

	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 20px 0 16px;
		margin-bottom: 4px;
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 13px;
		color: var(--text-muted);
		transition: color 0.12s;
		white-space: nowrap;
	}
	.back:hover {
		color: var(--text);
		text-decoration: none;
	}

	.header-title {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		color: var(--text);
	}

	h1 {
		font-family: var(--font-display);
		font-size: 22px;
		font-weight: 400;
		letter-spacing: -0.01em;
	}

	.word-count {
		font-size: 12px;
		color: var(--text-light);
		background: var(--bg-dark);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 3px 10px;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 72px 20px 40px;
		color: var(--text-muted);
		gap: 8px;
	}

	.empty :global(svg) {
		color: var(--text-light);
		margin-bottom: 8px;
	}

	.empty p {
		font-size: 15px;
		font-weight: 500;
		color: var(--text-muted);
	}

	.empty-sub {
		font-size: 13px !important;
		font-weight: 400 !important;
		color: var(--text-light) !important;
		margin-top: -2px;
	}

		.btn {
			display: inline-flex;
			align-items: center;
		gap: 6px;
		margin-top: 16px;
		padding: 10px 20px;
		background: var(--accent);
		color: white;
		border-radius: var(--radius-sm);
		font-size: 14px;
		font-weight: 600;
		text-decoration: none;
		transition: background 0.15s;
	}
		.btn:hover {
			background: var(--accent-hover);
			text-decoration: none;
		}

		.review-surface {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 220px;
			gap: 14px;
			margin: 22px 0 18px;
		}

		.review-card,
		.review-stats,
		.entry,
		.library-tools {
			background: var(--bg-card);
			border: 1px solid var(--border);
			border-radius: var(--radius-sm);
		}

		.review-card {
			min-height: 250px;
			padding: 20px;
			display: flex;
			flex-direction: column;
			gap: 16px;
		}

		.review-kicker {
			display: flex;
			align-items: center;
			gap: 7px;
			color: var(--accent);
			font-size: 11px;
			font-weight: 700;
			letter-spacing: 0.08em;
			text-transform: uppercase;
		}

		.review-word-row {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			gap: 16px;
		}

		.review-word {
			margin: 0;
			font-size: 42px;
			font-weight: 700;
			line-height: 1.05;
			letter-spacing: 0;
			color: var(--text);
		}

		.review-meta {
			margin: 8px 0 0;
			color: var(--text-light);
			font-size: 13px;
			line-height: 1.45;
		}

		.review-answer {
			padding: 14px 16px;
			border-left: 3px solid var(--accent);
			background: var(--bg-dark);
			border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		}

		.review-answer p {
			margin: 0;
			color: var(--text);
			font-size: 15px;
			line-height: 1.6;
		}

		.review-answer blockquote {
			margin: 10px 0 0;
			color: var(--text-muted);
			font-size: 13.5px;
			font-style: italic;
			line-height: 1.5;
		}

		.reveal-btn,
		.review-btn,
		.filter-btn,
		.quick-review {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 7px;
			border-radius: var(--radius-sm);
			font-size: 13px;
			font-weight: 600;
			transition: background-color 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
		}

		.reveal-btn {
			align-self: flex-start;
			margin-top: auto;
			padding: 9px 14px;
			background: var(--accent);
			color: white;
		}

		.reveal-btn:hover {
			background: var(--accent-hover);
		}

		.review-actions {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-top: auto;
		}

		.review-btn {
			padding: 8px 12px;
			background: var(--bg-dark);
			color: var(--text-muted);
			border: 1px solid var(--border);
		}

		.review-btn:hover {
			border-color: var(--text-light);
			color: var(--text);
		}

		.review-btn.strong,
		.review-btn:not(.ghost) {
			background: var(--accent);
			border-color: var(--accent);
			color: white;
		}

		.review-btn.strong:hover,
		.review-btn:not(.ghost):hover {
			background: var(--accent-hover);
			border-color: var(--accent-hover);
			color: white;
		}

		.review-done {
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			justify-content: center;
			gap: 6px;
			color: var(--green);
		}

		.review-done p {
			margin: 8px 0 0;
			color: var(--text);
			font-size: 18px;
			font-weight: 600;
		}

		.review-done span {
			color: var(--text-muted);
			font-size: 13px;
		}

		.review-stats {
			display: grid;
			grid-template-columns: 1fr;
			overflow: hidden;
		}

		.stat {
			padding: 14px 16px;
			border-bottom: 1px solid var(--border-light);
		}

		.stat:last-child {
			border-bottom: none;
		}

		.stat strong {
			display: block;
			color: var(--text);
			font-size: 24px;
			line-height: 1.1;
			font-variant-numeric: tabular-nums;
		}

		.stat span {
			color: var(--text-light);
			font-size: 11px;
			font-weight: 700;
			letter-spacing: 0.08em;
			text-transform: uppercase;
		}

		.library-tools {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 14px;
			margin-bottom: 12px;
			padding: 10px;
		}

		.filters {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 3px;
			border: 1px solid var(--border);
			border-radius: var(--radius-sm);
			background: var(--bg-dark);
		}

		.filter-btn {
			min-height: 30px;
			padding: 5px 10px;
			color: var(--text-muted);
			background: transparent;
		}

		.filter-btn:hover,
		.filter-btn.active {
			background: var(--bg-card);
			color: var(--accent);
		}

		.search-box {
			display: flex;
			align-items: center;
			gap: 8px;
			min-width: 240px;
			border: 1px solid var(--border);
			border-radius: var(--radius-sm);
			background: var(--bg-dark);
			color: var(--text-light);
			padding: 0 10px;
		}

		.search-box input {
			width: 100%;
			min-height: 34px;
			border: none;
			background: transparent;
			color: var(--text);
			font-family: var(--font-ui);
			font-size: 13px;
				outline: 2px solid transparent;
		}

		.search-box:focus-within {
			border-color: var(--accent);
			background: var(--bg-card);
		}

		.entries {
			display: grid;
			gap: 10px;
			padding: 4px 0;
		}

		.entry {
			padding: 15px 16px;
			border-left: 3px solid transparent;
			transition: border-color 0.15s, background-color 0.15s;
		}

		.entry.due {
			border-left-color: var(--accent);
		}

		.entry.mastered {
			border-left-color: var(--green);
		}

		.entry-header {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			gap: 10px;
			margin-bottom: 8px;
		}

		.entry-title {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: 8px;
			min-width: 0;
		}

		.word {
		font-size: 17px;
		font-weight: 600;
		color: var(--text);
		letter-spacing: -0.01em;
	}

	.category {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		background: var(--bg-dark);
		border: 1px solid var(--border);
		padding: 2px 8px;
		border-radius: var(--radius-xs);
	}

		.entry-actions {
			display: flex;
			align-items: center;
			gap: 2px;
			flex-shrink: 0;
		}

		.sound-btn {
			display: flex;
			align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm);
		color: var(--text-light);
		background: none;
		border: none;
			cursor: pointer;
			transition: background-color 0.12s, color 0.12s, opacity 0.12s;
			opacity: 0;
		}

		.sound-btn.visible,
		.entry:hover .sound-btn { opacity: 1; }
		.sound-btn:hover { background: var(--accent-soft); color: var(--accent); }
		.sound-btn.loading { opacity: 0.5; cursor: default; }

		.remove {
			display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm);
		color: var(--text-light);
			background: none;
			border: none;
			cursor: pointer;
			transition: background-color 0.12s, color 0.12s, opacity 0.12s;
			opacity: 0;
		}
	.entry:hover .remove {
		opacity: 1;
	}
	.remove:hover {
		background: var(--bg-dark);
		color: var(--red);
	}

	.definition {
		font-size: 14.5px;
		color: var(--text-muted);
		line-height: 1.6;
	}

		.example {
			margin-top: 5px;
		font-size: 13.5px;
		color: var(--text-light);
		font-style: italic;
			line-height: 1.5;
		}

		.entry-review-row {
			display: flex;
			align-items: center;
			gap: 12px;
			margin-top: 12px;
		}

		.confidence {
			display: flex;
			align-items: center;
			gap: 8px;
			min-width: 180px;
		}

		.confidence span,
		.reviewed-at,
		.source {
			color: var(--text-light);
			font-size: 12px;
		}

		.confidence-track {
			width: 80px;
			height: 6px;
			border-radius: var(--radius-pill);
			background: var(--bg-dark);
			border: 1px solid var(--border);
			overflow: hidden;
		}

		.confidence-fill {
			height: 100%;
			background: var(--accent);
			transition: width 0.2s ease;
		}

		.reviewed-at {
			flex: 1;
		}

		.quick-review {
			padding: 5px 10px;
			border: 1px solid var(--border);
			background: var(--bg-card);
			color: var(--text-muted);
		}

		.quick-review:hover {
			border-color: var(--accent);
			color: var(--accent);
		}

		.source {
			margin-top: 8px;
		}

		.empty-list {
			padding: 32px 20px;
			text-align: center;
			color: var(--text-muted);
			border: 1px dashed var(--border);
			border-radius: var(--radius-sm);
			background: var(--bg-card);
		}

		.reveal-btn:focus-visible,
		.review-btn:focus-visible,
		.filter-btn:focus-visible,
		.quick-review:focus-visible,
		.sound-btn:focus-visible,
		.remove:focus-visible {
			outline: 2px solid var(--accent);
			outline-offset: 2px;
		}

		@media (max-width: 560px) {
			.notebook-page {
				padding: 0 16px 60px;
		}

		.remove,
		.sound-btn {
			opacity: 1;
		}
	}
</style>
