<script lang="ts">
	import { ArrowLeft, BookMarked, Trash2, BookOpen, Volume2 } from 'lucide-svelte';

	let { data } = $props();

	let entries = $state<typeof data.entries>([]);
	let ttsLoading = $state<number | null>(null);
	let ttsAudio: HTMLAudioElement | null = null;

	$effect(() => {
		entries = data.entries;
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
			<a href="/" class="btn">
				Find a clip to study
			</a>
		</div>
	{:else}
		<div class="entries">
			{#each entries as entry}
				<div class="entry">
					<div class="entry-header">
						<strong class="word">{entry.word}</strong>
						<span class="category">{entry.category}</span>
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
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.notebook-page {
		max-width: 680px;
		margin: 0 auto;
		padding: 0 24px 80px;
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

	.entries {
		padding: 8px 0;
	}

	.entry {
		padding: 16px 0;
		border-bottom: 1px solid var(--border-light);
	}
	.entry:last-child {
		border-bottom: none;
	}

	.entry-header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 6px;
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
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 2px;
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
		transition: background 0.12s, color 0.12s;
		opacity: 0;
	}
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
		transition: background 0.12s, color 0.12s;
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

	@media (max-width: 560px) {
		.notebook-page {
			padding: 0 16px 60px;
		}

		.remove {
			opacity: 1;
		}
	}
</style>
