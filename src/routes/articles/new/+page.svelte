<script lang="ts">
	import { goto } from '$app/navigation';
	import { Link, FileText, Loader2 } from 'lucide-svelte';

	let mode = $state<'url' | 'paste'>('url');
	let urlInput = $state('');
	let pasteTitle = $state('');
	let pasteContent = $state('');
	let loading = $state(false);
	let error = $state('');

	async function submitUrl() {
		if (!urlInput.trim()) return;
		loading = true;
		error = '';
		try {
			// Fetch article content server-side
			const fetchRes = await fetch('/api/articles/fetch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: urlInput.trim() })
			});
			const fetched = await fetchRes.json();
			if (!fetchRes.ok) {
				error = fetched.error || 'Could not fetch article.';
				return;
			}

			const createRes = await fetch('/api/articles', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: fetched.title,
					url: urlInput.trim(),
					source: fetched.source,
					content: fetched.content
				})
			});
			const created = await createRes.json();
			if (!createRes.ok) {
				error = created.error || 'Could not create article.';
				return;
			}
			goto(`/articles/${created.id}`);
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			loading = false;
		}
	}

	async function submitPaste() {
		if (!pasteTitle.trim() || !pasteContent.trim()) return;
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/articles', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: pasteTitle.trim(),
					content: pasteContent.trim()
				})
			});
			const data = await res.json();
			if (!res.ok) {
				error = data.error || 'Could not create article.';
				return;
			}
			goto(`/articles/${data.id}`);
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			loading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && mode === 'url' && !loading) submitUrl();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="page">
	<div class="card">
		<h1 class="heading">Read an Article</h1>
		<p class="sub">Paste a URL or text to study vocabulary, phrasal verbs & collocations.</p>

		<div class="tabs">
			<button class="tab" class:active={mode === 'url'} onclick={() => { mode = 'url'; error = ''; }}>
				<Link size={15} /> URL
			</button>
			<button class="tab" class:active={mode === 'paste'} onclick={() => { mode = 'paste'; error = ''; }}>
				<FileText size={15} /> Paste text
			</button>
		</div>

		{#if mode === 'url'}
			<div class="field">
				<input
					class="input"
					type="url"
					placeholder="https://www.bbc.com/news/..."
					bind:value={urlInput}
					disabled={loading}
				/>
				<button class="btn-primary" onclick={submitUrl} disabled={loading || !urlInput.trim()}>
					{#if loading}
						<Loader2 size={16} class="spin" /> Fetching…
					{:else}
						Import
					{/if}
				</button>
			</div>
		{:else}
			<div class="paste-form">
				<input
					class="input"
					type="text"
					placeholder="Article title"
					bind:value={pasteTitle}
					disabled={loading}
				/>
				<textarea
					class="textarea"
					placeholder="Paste the article text here…"
					bind:value={pasteContent}
					rows={10}
					disabled={loading}
				></textarea>
				<button class="btn-primary" onclick={submitPaste} disabled={loading || !pasteTitle.trim() || !pasteContent.trim()}>
					{#if loading}
						<Loader2 size={16} class="spin" /> Saving…
					{:else}
						Start reading
					{/if}
				</button>
			</div>
		{/if}

		{#if error}
			<p class="error">{error}</p>
		{/if}
	</div>
</div>

<style>
	.page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: var(--gray1);
	}

	.card {
		width: 100%;
		max-width: 520px;
		background: var(--gray2);
		border: 1px solid var(--gray4);
		border-radius: var(--radius-lg);
		padding: 36px 32px;
		box-shadow: var(--shadow-lg);
	}

	.heading {
		font-family: var(--font-display);
		font-size: 24px;
		font-weight: 400;
		color: var(--gray12);
		margin: 0 0 6px;
	}

	.sub {
		font-size: 14px;
		color: var(--gray11);
		margin: 0 0 24px;
	}

	.tabs {
		display: flex;
		gap: 4px;
		background: var(--gray3);
		padding: 4px;
		border-radius: var(--radius-sm);
		margin-bottom: 20px;
	}

	.tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 12px;
		border: none;
		background: none;
		border-radius: calc(var(--radius-sm) - 2px);
		font-size: 13px;
		font-weight: 500;
		color: var(--gray9);
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease);
		min-height: auto;
	}

	.tab.active {
		background: var(--gray5);
		color: var(--gray12);
	}

	.field {
		display: flex;
		gap: 10px;
	}

	.input {
		flex: 1;
		background: var(--gray1);
		border: 1px solid var(--gray4);
		border-radius: var(--radius-sm);
		padding: 10px 14px;
		font-size: 14px;
		color: var(--gray12);
		font-family: var(--font-ui);
		transition: border-color var(--duration-fast) var(--ease);
		min-width: 0;
	}

	.input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}

	.paste-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.textarea {
		background: var(--gray1);
		border: 1px solid var(--gray4);
		border-radius: var(--radius-sm);
		padding: 10px 14px;
		font-size: 14px;
		color: var(--gray12);
		font-family: var(--font-ui);
		resize: vertical;
		transition: border-color var(--duration-fast) var(--ease);
		line-height: 1.6;
	}

	.textarea:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		padding: 10px 20px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: background var(--duration-fast) var(--ease), opacity var(--duration-fast) var(--ease);
	}

	.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
	.btn-primary:disabled { opacity: 0.4; cursor: default; }

	.error {
		margin: 14px 0 0;
		font-size: 13px;
		color: var(--red);
	}

	:global(.spin) {
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
