<script lang="ts">
	import {
		ArrowLeft,
		BookMarked,
		BookOpen,
		Clock,
		Download,
		Film,
		Layers,
		Play,
		Search,
		Trash2,
		Volume2
	} from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { playPronunciation } from '$lib/utils/tts';
	import { getGuestVocab, deleteGuestWord } from '$lib/utils/guestVocab';
	import { isDue } from '$lib/utils/srs';
	import ReviewSession from '$lib/components/ReviewSession.svelte';

	let { data } = $props();

	type NotebookEntry = (typeof data.entries)[number];

	let entries = $state<NotebookEntry[]>([]);
	let ttsLoading = $state<number | null>(null);
	let search = $state('');
	let activeSource = $state<string | null>(null);
	let currentPage = $state(1);
	let reviewOpen = $state(false);
	const PAGE_SIZE = 20;

	$effect(() => {
		if (data.user?.isGuest) {
			if (typeof window !== 'undefined') {
				entries = getGuestVocab() as NotebookEntry[];
			}
		} else {
			entries = data.entries;
		}
	});

	// Sentences are no longer saved from the player; show vocabulary only
	// (legacy sentence entries stay hidden but are kept in the DB).
	const wordEntries = $derived(entries.filter((e: any) => e.category !== 'sentence'));

	const sources = $derived.by(() => {
		const map = new Map<string, number>();
		for (const entry of wordEntries) {
			const key = entry.episode_title || 'Unsorted';
			map.set(key, (map.get(key) || 0) + 1);
		}
		return Array.from(map.entries()).map(([title, count]) => ({ title, count }));
	});

	const filteredEntries = $derived.by(() => {
		let result = wordEntries;
		if (activeSource) {
			result = result.filter((e) =>
				activeSource === 'Unsorted' ? !e.episode_title : e.episode_title === activeSource
			);
		}
		const q = search.trim().toLowerCase();
		if (q) {
			result = result.filter((entry) =>
				[entry.word, entry.definition, entry.category, entry.episode_title]
					.filter(Boolean)
					.some((value) => String(value).toLowerCase().includes(q))
			);
		}
		return result;
	});

	const dueCount = $derived(filteredEntries.filter((e) => isDue(e as any)).length);

	const totalPages = $derived(Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE)));
	const pagedEntries = $derived(filteredEntries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));

	$effect(() => {
		search; activeSource;
		currentPage = 1;
	});

	function formatTimestamp(seconds: number | null | undefined) {
		if (seconds == null || !Number.isFinite(Number(seconds))) return '';
		const total = Math.max(0, Math.floor(Number(seconds)));
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const s = total % 60;
		if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	function sourceHref(entry: NotebookEntry) {
		if (!entry.episode_id) return '';
		const timestamp = Number(entry.source_time);
		const suffix = Number.isFinite(timestamp) && timestamp >= 0 ? `?t=${Math.floor(timestamp)}` : '';
		return `/episode/${entry.episode_id}${suffix}`;
	}

	async function playTTS(word: string, id: number) {
		if (ttsLoading !== null) return;
		ttsLoading = id;
		try {
			await playPronunciation(word);
		} catch {
			/* silently fail */
		} finally {
			ttsLoading = null;
		}
	}

	function exportJSON() {
		const out = entries.map(({ word, definition, example, category, episode_title, source_time, created_at }) => ({
			word, definition, example, category, episode_title, source_time, created_at
		}));
		const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `notebook-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function removeWord(id: number) {
		try {
			if (data.user?.isGuest) {
				deleteGuestWord(id);
			} else {
				await fetch('/api/notebook', {
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id })
				});
			}
			entries = entries.filter((e: any) => e.id !== id);
		} catch {
			console.error('Failed to remove word');
		}
	}

	function startReview() {
		if (filteredEntries.length === 0) return;
		reviewOpen = true;
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
		<span class="count">{wordEntries.length} words</span>
	</header>

	<hr class="dotted-sep" />

	{#if wordEntries.length === 0}
		<div class="empty">
			<BookOpen size={32} aria-hidden="true" />
			<p>Your notebook is empty.</p>
			<p class="empty-sub">Save words while studying clips to build your vocabulary.</p>
			<a href="/" class="btn">Find a clip to study</a>
		</div>
	{:else}
		<div class="toolbar">
			<label class="search-box">
				<Search size={14} aria-hidden="true" />
				<input bind:value={search} placeholder="Search saved words" />
			</label>
			<button class="export-btn" onclick={exportJSON} title="Export as JSON">
				<Download size={14} aria-hidden="true" />
				Export
			</button>
			<button class="review-btn" onclick={startReview} disabled={filteredEntries.length === 0}>
				<Layers size={15} aria-hidden="true" />
				Review
				{#if dueCount > 0}<span class="review-badge">{dueCount}</span>{/if}
			</button>
		</div>

		{#if sources.length > 1}
			<div class="source-filter-wrap">
				<Film size={13} aria-hidden="true" />
				<select
					class="source-select"
					value={activeSource || ''}
					onchange={(e) => { const v = (e.target as HTMLSelectElement).value; activeSource = v || null; }}
				>
					<option value="">All clips ({wordEntries.length})</option>
					{#each sources as src}
						<option value={src.title}>{src.title} ({src.count})</option>
					{/each}
				</select>
			</div>
		{/if}

		<div class="feed">
			{#if filteredEntries.length === 0}
				<div class="empty-list">
					<p>No words match your search.</p>
				</div>
			{:else}
				{#each pagedEntries as entry (entry.id)}
					<article class="card">
						<div class="chead">
							<span class="word">{entry.word}</span>
							{#if entry.category}<span class="tag">{entry.category}</span>{/if}
						</div>
						{#if entry.phonetic}
							<div class="phonline">
								<span class="phonetic">{entry.phonetic}</span>
								<button
									class="say"
									class:loading={ttsLoading === entry.id}
									onclick={() => playTTS(entry.word, entry.id)}
									aria-label={`Listen to ${entry.word}`}
									title="Pronounce"
								>
									<Volume2 size={14} aria-hidden="true" />
								</button>
							</div>
						{/if}
						<p class="definition">{entry.definition}</p>
						{#if entry.example}
							<p class="example">e.g. {entry.example}</p>
						{/if}
						{#if entry.episode_title || entry.source_time != null}
							<div class="src">
								<a class="src-link" href={sourceHref(entry)} aria-label={`Open source for ${entry.word}`}>
									<Film size={13} aria-hidden="true" />
									<span class="src-title">{entry.episode_title || 'Saved source'}</span>
									{#if entry.source_time != null}
										<span class="src-time">
											<Clock size={11} aria-hidden="true" />
											{formatTimestamp(entry.source_time)}
										</span>
									{/if}
								</a>
								{#if entry.episode_id}
									<a class="src-play" href={sourceHref(entry)} title="Play clip" aria-label="Play clip">
										<Play size={11} aria-hidden="true" />
									</a>
								{/if}
							</div>
						{/if}
						{#if entry.source_text}
							<p class="quote">"{entry.source_text}"</p>
						{/if}
						<button
							class="card-delete"
							onclick={() => removeWord(entry.id)}
							aria-label={`Remove ${entry.word}`}
							title="Delete"
						>
							<Trash2 size={14} aria-hidden="true" />
						</button>
					</article>
				{/each}
			{/if}
		</div>

		{#if totalPages > 1}
			<div class="pagination">
				<button class="page-btn" disabled={currentPage <= 1} onclick={() => { currentPage--; window.scrollTo(0, 0); }}>Previous</button>
				<div class="page-numbers">
					{#each Array.from({ length: totalPages }, (_, i) => i + 1) as p}
						{#if p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)}
							<button class="page-num" class:active={p === currentPage} onclick={() => { currentPage = p; window.scrollTo(0, 0); }}>{p}</button>
						{:else if p === currentPage - 2 || p === currentPage + 2}
							<span class="page-dots">…</span>
						{/if}
					{/each}
				</div>
				<button class="page-btn" disabled={currentPage >= totalPages} onclick={() => { currentPage++; window.scrollTo(0, 0); }}>Next</button>
			</div>
		{/if}
	{/if}
</div>

<ReviewSession
	bind:open={reviewOpen}
	entries={filteredEntries as any}
	variant="modal"
	isGuest={!!data.user?.isGuest}
	onSeek={(entry) => goto(sourceHref(entry as NotebookEntry))}
/>

<style>
	.notebook-page {
		max-width: 680px;
		margin: 0 auto;
		padding: 0 24px 88px;
	}

	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 24px 0 16px;
		margin-bottom: 4px;
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 13px;
		color: var(--gray9);
		transition: color var(--duration-fast) var(--ease);
		white-space: nowrap;
	}
	.back:hover { color: var(--gray12); text-decoration: none; }

	.header-title {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		color: var(--gray12);
	}

	h1 {
		font-family: var(--font-display);
		font-size: 22px;
		font-weight: 400;
		letter-spacing: -0.01em;
	}

	.count {
		font-size: 13px;
		font-weight: 550;
		color: var(--gray9);
		font-variant-numeric: tabular-nums;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 80px 20px 40px;
		color: var(--gray11);
		gap: 8px;
	}
	.empty :global(svg) { color: var(--gray8); margin-bottom: 8px; }
	.empty p { font-size: 15px; font-weight: 500; }
	.empty-sub { font-size: 13px !important; font-weight: 400 !important; color: var(--gray9) !important; }

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
		transition: background var(--duration-fast) var(--ease);
	}
	.btn:hover { background: var(--accent-hover); text-decoration: none; }

	.toolbar {
		margin: 20px 0 16px;
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.search-box {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		border: 1px solid var(--gray4);
		border-radius: var(--radius-sm);
		background: var(--gray2);
		color: var(--gray8);
		padding: 0 12px;
		transition: border-color var(--duration-fast) var(--ease);
	}
	.search-box input {
		width: 100%;
		min-height: 38px;
		border: none;
		background: transparent;
		color: var(--gray12);
		font-family: var(--font-ui);
		font-size: 13px;
		outline: none;
	}
	.search-box:focus-within {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.export-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 14px;
		height: 38px;
		border: 1px solid var(--gray4);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--gray9);
		font-size: 13px;
		cursor: pointer;
		white-space: nowrap;
		transition: color var(--duration-fast) var(--ease), border-color var(--duration-fast) var(--ease);
	}
	.export-btn:hover { color: var(--gray12); border-color: var(--gray6); }
	.review-btn {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 38px;
		padding: 0 16px;
		border: none;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: #fff;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: background var(--duration-fast) var(--ease), transform var(--duration-fast);
	}
	.review-btn:hover { background: var(--accent-hover); }
	.review-btn:active { transform: scale(0.97); }
	.review-btn:disabled { opacity: 0.45; cursor: not-allowed; }
	.review-badge {
		background: rgba(255, 255, 255, 0.22);
		border-radius: var(--radius-pill);
		font-size: 11.5px;
		font-weight: 650;
		padding: 1px 8px;
		font-variant-numeric: tabular-nums;
	}

	.source-filter-wrap {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 18px;
		color: var(--gray9);
	}
	.source-select {
		flex: 1;
		padding: 8px 12px;
		border: 1px solid var(--gray4);
		border-radius: var(--radius-sm);
		background: var(--bg-card);
		color: var(--gray12);
		font-family: var(--font-ui);
		font-size: 13px;
		cursor: pointer;
		transition: border-color var(--duration-fast) var(--ease);
	}
	.source-select:focus { outline: none; border-color: var(--accent); }

	/* ── card feed ── */
	.feed { display: flex; flex-direction: column; gap: 14px; }

	.card {
		position: relative;
		background: var(--bg-card);
		border: 1px solid var(--gray4);
		border-radius: var(--radius-lg);
		padding: 18px 18px 15px;
		transition: border-color var(--duration-fast) var(--ease), box-shadow var(--duration-fast) var(--ease), transform var(--duration-fast) var(--ease);
	}
	.card:hover {
		border-color: var(--gray6);
		box-shadow: var(--shadow-md);
		transform: translateY(-2px);
	}
	.chead {
		display: flex;
		align-items: baseline;
		gap: 8px;
		justify-content: space-between;
		padding-right: 28px;
	}
	.word {
		font-size: 17.5px;
		font-weight: 670;
		letter-spacing: -0.01em;
		color: var(--gray12);
		line-height: 1.25;
	}
	.tag {
		flex: 0 0 auto;
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 0.06em;
		color: var(--gray9);
		background: var(--gray3);
		padding: 3px 8px;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
	}
	.phonline { display: flex; align-items: center; gap: 8px; margin: 5px 0 0; }
	.phonetic { font-size: 13px; color: var(--gray9); font-style: italic; }
	.say {
		width: 24px; height: 24px;
		border: none; background: transparent;
		color: var(--gray9); border-radius: 7px; cursor: pointer;
		display: grid; place-items: center;
		transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease);
	}
	.say:hover { background: var(--gray3); color: var(--gray12); }
	.say.loading { opacity: 0.5; cursor: default; }

	.definition { font-size: 14.5px; line-height: 1.5; color: var(--gray12); margin: 11px 0 8px; }
	.example { font-size: 13.5px; line-height: 1.5; color: var(--gray9); font-style: italic; margin: 0; }

	.src {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11.5px;
		color: var(--gray9);
		margin-top: 13px;
		padding-top: 12px;
		border-top: 1px solid var(--gray3);
	}
	.src-link {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		flex: 1;
		min-width: 0;
		color: var(--gray9);
		text-decoration: none;
		transition: color var(--duration-fast) var(--ease);
	}
	.src-link:hover { color: var(--accent); text-decoration: none; }
	.src-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.src-time { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
	.src-play {
		flex: 0 0 auto;
		width: 22px; height: 22px;
		background: var(--gray3); color: var(--gray11);
		border-radius: 6px; display: grid; place-items: center;
		opacity: 0;
		transition: opacity var(--duration-fast) var(--ease), background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease);
	}
	.card:hover .src-play { opacity: 1; }
	.src-play:hover { background: var(--accent-soft); color: var(--accent); text-decoration: none; }

	.quote {
		margin: 11px 0 0;
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--gray9);
		font-style: italic;
		background: var(--gray2);
		border-radius: var(--radius-md);
		padding: 10px 12px;
	}

	.card-delete {
		position: absolute;
		top: 12px;
		right: 12px;
		width: 28px; height: 28px;
		border: none; background: transparent;
		color: var(--gray8); border-radius: 7px; cursor: pointer;
		display: grid; place-items: center;
		opacity: 0;
		transition: opacity var(--duration-fast) var(--ease), background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease);
	}
	.card:hover .card-delete, .card:focus-within .card-delete { opacity: 1; }
	.card-delete:hover { background: var(--gray3); color: var(--red); }

	/* ── pagination ── */
	.pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		margin-top: 24px;
		padding-top: 20px;
		border-top: 1px solid var(--gray3);
	}
	.page-numbers { display: flex; align-items: center; gap: 2px; }
	.page-btn {
		padding: 7px 16px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--gray4);
		background: transparent;
		font-size: 13px;
		font-weight: 500;
		color: var(--gray11);
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease);
	}
	.page-btn:hover:not(:disabled) { background: var(--gray3); color: var(--gray12); }
	.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.page-num {
		width: 32px; height: 32px;
		border-radius: var(--radius-sm);
		border: none; background: transparent;
		font-size: 13px; font-weight: 500;
		color: var(--gray9); cursor: pointer;
		display: flex; align-items: center; justify-content: center;
		transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease);
	}
	.page-num:hover { background: var(--gray3); color: var(--gray12); }
	.page-num.active { background: var(--gray12); color: var(--gray1); font-weight: 600; }
	.page-dots { width: 24px; text-align: center; color: var(--gray8); font-size: 13px; }

	.empty-list {
		padding: 36px 20px;
		text-align: center;
		color: var(--gray9);
		border: 1px dashed var(--gray4);
		border-radius: var(--radius-sm);
	}

	@media (max-width: 560px) {
		.notebook-page { padding: 0 12px 60px; }
		header { flex-wrap: wrap; gap: 8px; padding: 16px 0 12px; }
		h1 { font-size: 18px; }
		.toolbar { flex-wrap: wrap; }
		.search-box { flex: 1 1 100%; }
		.export-btn, .review-btn { flex: 1 1 auto; justify-content: center; }
		.src-play { opacity: 1; }
		.card-delete { opacity: 1; }
	}
</style>
