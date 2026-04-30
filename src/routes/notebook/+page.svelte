<script lang="ts">
	import {
		ArrowLeft,
		BookMarked,
		BookOpen,
		Search,
		Trash2,
		Volume2
	} from 'lucide-svelte';

	let { data } = $props();

	type NotebookEntry = (typeof data.entries)[number];

	let entries = $state<NotebookEntry[]>([]);
	let ttsLoading = $state<number | null>(null);
	let ttsAudio: HTMLAudioElement | null = null;
	let search = $state('');

	$effect(() => {
		entries = data.entries;
	});

	const filteredEntries = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return entries;
		return entries.filter((entry) =>
			[entry.word, entry.definition, entry.category]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(q))
		);
	});

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
		</div>

		<div class="entries">
			{#if filteredEntries.length === 0}
				<div class="empty-list">
					<p>No words match your search.</p>
				</div>
			{:else}
				{#each filteredEntries as entry}
					<div class="entry">
						<div class="entry-main">
							<div class="entry-word">
								<strong>{entry.word}</strong>
								{#if entry.category}
									<span class="pos">{entry.category}</span>
								{/if}
							</div>
							<p class="definition">{entry.definition}</p>
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
	.empty :global(svg) { color: var(--text-light); margin-bottom: 8px; }
	.empty p { font-size: 15px; font-weight: 500; }
	.empty-sub { font-size: 13px !important; font-weight: 400 !important; color: var(--text-light) !important; }

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
	.btn:hover { background: var(--accent-hover); text-decoration: none; }

	.toolbar {
		margin: 18px 0 14px;
	}

	.search-box {
		display: flex;
		align-items: center;
		gap: 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-card);
		color: var(--text-light);
		padding: 0 12px;
	}
	.search-box input {
		width: 100%;
		min-height: 36px;
		border: none;
		background: transparent;
		color: var(--text);
		font-family: var(--font-ui);
		font-size: 13px;
		outline: none;
	}
	.search-box:focus-within {
		border-color: var(--accent);
	}

	.entries {
		display: grid;
		gap: 10px;
	}

	.entry {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 14px 16px;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		transition: background-color 0.12s;
	}
	.entry:hover { background: var(--bg-subtle); }

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
		font-size: 16px;
		color: var(--text);
	}
	.pos {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		background: var(--bg-dark);
		border: 1px solid var(--border);
		padding: 2px 7px;
		border-radius: var(--radius-xs);
	}

	.definition {
		font-size: 14px;
		color: var(--text-muted);
		line-height: 1.5;
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
		width: 30px;
		height: 30px;
		border-radius: var(--radius-sm);
		color: var(--text-light);
		cursor: pointer;
		transition: background-color 0.12s, color 0.12s, opacity 0.12s;
		opacity: 0;
	}
	.entry:hover .icon-btn { opacity: 1; }
	.icon-btn:hover { background: var(--accent-soft); color: var(--accent); }
	.icon-btn.loading { opacity: 0.5; cursor: default; }
	.icon-btn.delete:hover { background: var(--bg-dark); color: var(--red); }

	.empty-list {
		padding: 32px 20px;
		text-align: center;
		color: var(--text-muted);
		border: 1px dashed var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-card);
	}

	.icon-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	@media (max-width: 560px) {
		.notebook-page { padding: 0 16px 60px; }
		.icon-btn { opacity: 1; }
	}
</style>
