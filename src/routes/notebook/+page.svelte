<script lang="ts">
	import {
		ArrowLeft,
		BookMarked,
		BookOpen,
		Clock,
		Download,
		Film,
		Search,
		Trash2,
		Volume2
	} from 'lucide-svelte';
	import { playPronunciation } from '$lib/utils/tts';

	let { data } = $props();

	type NotebookEntry = (typeof data.entries)[number];

	let entries = $state<NotebookEntry[]>([]);
	let ttsLoading = $state<number | null>(null);
	let search = $state('');
	let activeSource = $state<string | null>(null);
	let currentPage = $state(1);
	const PAGE_SIZE = 20;

	$effect(() => {
		entries = data.entries;
	});

	// Unique sources with word counts
	const sources = $derived.by(() => {
		const map = new Map<string, number>();
		for (const entry of entries) {
			const key = entry.episode_title || 'Unsorted';
			map.set(key, (map.get(key) || 0) + 1);
		}
		return Array.from(map.entries()).map(([title, count]) => ({ title, count }));
	});

	const filteredEntries = $derived.by(() => {
		let result = entries;
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

	const totalPages = $derived(Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE)));
	const pagedEntries = $derived(filteredEntries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));

	// Reset to page 1 when filters change
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
			// silently fail
		} finally {
			ttsLoading = null;
		}
	}

	function exportJSON() {
		const data = entries.map(({ word, definition, example, category, episode_title, source_time, created_at }) => ({
			word, definition, example, category, episode_title, source_time, created_at
		}));
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `notebook-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		URL.revokeObjectURL(url);
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
				Export JSON
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
					<option value="">All clips ({entries.length})</option>
					{#each sources as src}
						<option value={src.title}>{src.title} ({src.count})</option>
					{/each}
				</select>
			</div>
		{/if}

		<div class="entries">
			{#if filteredEntries.length === 0}
				<div class="empty-list">
					<p>No words match your search.</p>
				</div>
			{:else}
				{#each pagedEntries as entry}
					<div class="entry">
						<div class="entry-main">
							<div class="entry-word">
								<strong>{entry.word}</strong>
								{#if entry.phonetic}
									<span class="phonetic">{entry.phonetic}</span>
								{/if}
								{#if entry.category}
									<span class="pos">{entry.category}</span>
								{/if}
							</div>
							<p class="definition">{entry.definition}</p>
							{#if entry.episode_title || entry.source_time != null}
								<a class="source-line" href={sourceHref(entry)} aria-label={`Open source for ${entry.word}`}>
									<Film size={12} aria-hidden="true" />
									<span class="source-title">{entry.episode_title || 'Saved source'}</span>
									{#if entry.source_time != null}
										<span class="source-time">
											<Clock size={11} aria-hidden="true" />
											{formatTimestamp(entry.source_time)}
										</span>
									{/if}
								</a>
							{/if}
							{#if entry.source_text}
								<p class="source-quote">"{entry.source_text}"</p>
							{/if}
						</div>
						<div class="entry-actions">
							<button
								class="icon-btn"
								class:loading={ttsLoading === entry.id}
								onclick={() => playTTS(entry.word, entry.id)}
								aria-label={`Listen to ${entry.word}`}
								title="Listen"
							>
								<Volume2 size={14} aria-hidden="true" />
							</button>
							<button
								class="icon-btn delete"
								onclick={() => removeWord(entry.id)}
								aria-label={`Remove ${entry.word}`}
								title="Delete"
							>
								<Trash2 size={14} aria-hidden="true" />
							</button>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		{#if totalPages > 1}
			<div class="pagination">
				<button
					class="page-btn"
					disabled={currentPage <= 1}
					onclick={() => { currentPage--; window.scrollTo(0, 0); }}
				>Previous</button>
				<div class="page-numbers">
					{#each Array.from({ length: totalPages }, (_, i) => i + 1) as p}
						{#if p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)}
							<button
								class="page-num"
								class:active={p === currentPage}
								onclick={() => { currentPage = p; window.scrollTo(0, 0); }}
							>{p}</button>
						{:else if p === currentPage - 2 || p === currentPage + 2}
							<span class="page-dots">…</span>
						{/if}
					{/each}
				</div>
				<button
					class="page-btn"
					disabled={currentPage >= totalPages}
					onclick={() => { currentPage++; window.scrollTo(0, 0); }}
				>Next</button>
			</div>
		{/if}
	{/if}
</div>

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

	.word-count {
		font-size: 11px;
		color: var(--gray9);
		background: var(--gray3);
		border: 1px solid var(--gray4);
		border-radius: var(--radius-pill);
		padding: 3px 10px;
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

	.search-box {
		display: flex;
		align-items: center;
		gap: 8px;
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

	.source-filter-wrap {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 16px;
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
	.source-select:focus {
		outline: none;
		border-color: var(--accent);
	}

	.entries {
		display: grid;
		gap: 4px;
	}

	.entry {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 14px 16px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		transition: background var(--duration-fast) var(--ease);
	}
	.entry:hover { background: var(--gray2); }

	.entry-main {
		flex: 1;
		min-width: 0;
	}

	.entry-word {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}
	.entry-word strong {
		font-size: 15px;
		color: var(--gray12);
	}
	.phonetic {
		font-size: 13px;
		color: var(--gray9);
		font-style: italic;
	}
	.pos {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--gray9);
		background: var(--gray3);
		padding: 2px 7px;
		border-radius: var(--radius-xs);
	}

	.definition {
		font-size: 14px;
		color: var(--gray11);
		line-height: 1.5;
	}

	.source-line {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		margin-top: 8px;
		color: var(--gray8);
		font-size: 12px;
		line-height: 1.3;
		text-decoration: none;
		transition: color var(--duration-fast) var(--ease);
	}
	.source-line:hover { color: var(--accent); text-decoration: none; }
	.source-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.source-time {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		flex-shrink: 0;
		color: var(--gray9);
	}
	/* Pagination */
	.pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		margin-top: 24px;
		padding-top: 20px;
		border-top: 1px solid var(--gray3);
	}
	.page-numbers {
		display: flex;
		align-items: center;
		gap: 2px;
	}
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
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		border: none;
		background: transparent;
		font-size: 13px;
		font-weight: 500;
		color: var(--gray9);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease);
	}
	.page-num:hover { background: var(--gray3); color: var(--gray12); }
	.page-num.active {
		background: var(--gray12);
		color: var(--gray1);
		font-weight: 600;
	}
	.page-dots {
		width: 24px;
		text-align: center;
		color: var(--gray8);
		font-size: 13px;
	}

	.source-quote {
		font-size: 13px;
		color: var(--gray9);
		font-style: italic;
		margin-top: 6px;
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.entry-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px; height: 30px;
		border-radius: var(--radius-sm);
		color: var(--gray8);
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease), opacity var(--duration-fast) var(--ease);
		opacity: 0;
	}
	.entry:hover .icon-btn,
	.entry:focus-within .icon-btn { opacity: 1; }
	.icon-btn:hover { background: var(--gray3); color: var(--accent); }
	.icon-btn.loading { opacity: 0.5; cursor: default; }
	.icon-btn.delete:hover { background: var(--gray3); color: var(--red); }

	.empty-list {
		padding: 36px 20px;
		text-align: center;
		color: var(--gray9);
		border: 1px dashed var(--gray4);
		border-radius: var(--radius-sm);
	}

	.icon-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	@media (max-width: 560px) {
		.notebook-page { padding: 0 12px 60px; }
		header { flex-wrap: wrap; gap: 8px; padding: 16px 0 12px; }
		h1 { font-size: 18px; }
		.toolbar { flex-wrap: wrap; }
		.search-box { flex: 1 1 100%; }
		.export-btn { flex: 1 1 auto; justify-content: center; }
		.entry { flex-wrap: wrap; gap: 10px; padding: 12px; }
		.entry-word strong { font-size: 15px; }
		.definition { font-size: 13px; }
		.entry-actions {
			width: 100%;
			justify-content: flex-end;
			gap: 8px;
			border-top: 1px solid var(--gray3);
			padding-top: 8px;
			margin-top: 2px;
		}
		.icon-btn { opacity: 1; width: 40px; height: 40px; }
		.source-line { font-size: 11px; }
	}
</style>
