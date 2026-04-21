<script lang="ts">
	import type { Episode } from '$lib/types';
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { formatTime } from '$lib/utils/time';
	import { loadResumePosition } from '$lib/utils/resume';
	import {
		MoonStar, SunMedium, Youtube, ArrowRight, PlayCircle,
		Clock, CheckCircle2, Loader2, AlertCircle, Trash2,
		BookMarked, Plus, Clapperboard, RotateCcw, Settings
	} from 'lucide-svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import { authModalOpen } from '$lib/stores/auth';


	let { data } = $props();

	let url = $state('');
	let loading = $state(false);
	let error = $state('');
	let episodes = $state<Episode[]>([]);
	let clipsStudied = $state(0);
	let wordsSaved = $state(0);
	let resumePositions = $state<Record<string, number>>({});
	let theme = $state<'light' | 'dark'>('light');
	let settingsOpen = $state(false);

	$effect(() => {
		episodes = data.episodes;
		clipsStudied = data.clipsStudied;
		wordsSaved = data.wordsSaved;
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		episodes;
		refreshResumePositions();
	});

	function refreshResumePositions() {
		const nextPositions: Record<string, number> = {};
		for (const episode of episodes) {
			if (episode.status !== 'ready') continue;
			const saved = loadResumePosition(episode.id);
			if (saved && saved > 5) {
				nextPositions[episode.id] = saved;
			}
		}
		resumePositions = nextPositions;
	}

	// Auto-refresh the list whenever any episode is still being processed,
	// so the status chip doesn't stay stuck on "Fetching audio…" after the
	// server has already finished. Stops polling once everything settles.
	const PROCESSING_STATES = new Set([
		'pending',
		'fetching_audio',
		'downloading',
		'transcribing',
		'analyzing'
	]);
	const anyProcessing = $derived(episodes.some((ep) => PROCESSING_STATES.has(ep.status)));
	let listPollInterval: ReturnType<typeof setInterval> | null = null;

	$effect(() => {
		if (typeof window === 'undefined') return;
		if (anyProcessing && !listPollInterval) {
			listPollInterval = setInterval(() => {
				void invalidateAll();
			}, 4000);
		} else if (!anyProcessing && listPollInterval) {
			clearInterval(listPollInterval);
			listPollInterval = null;
		}
	});

	onMount(() => {
		theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
		refreshResumePositions();
		const handleFocus = () => refreshResumePositions();
		window.addEventListener('focus', handleFocus);
		document.addEventListener('visibilitychange', handleFocus);
		return () => {
			window.removeEventListener('focus', handleFocus);
			document.removeEventListener('visibilitychange', handleFocus);
			if (listPollInterval) clearInterval(listPollInterval);
		};
	});

	function toggleTheme() {
		theme = theme === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = theme;
		localStorage.setItem('tm-theme', theme);
	}

	async function handleSubmit() {
		if (!url.trim()) return;
		if (!data.user) {
			authModalOpen.set(true);
			return;
		}
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/process', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url })
			});
			const d = await res.json();
			if (res.status === 401) {
				authModalOpen.set(true);
			} else if (d.error) {
				error = d.error;
			}
			else { await goto(`/episode/${d.id}`); }
		} catch {
			error = 'Failed to process video. Please try again.';
		} finally {
			loading = false;
		}
	}

	async function deleteEpisode(e: MouseEvent, id: string) {
		e.preventDefault();
		e.stopPropagation();
		if (!confirm('Remove this clip?')) return;
		const episode = episodes.find((ep) => ep.id === id);
		await fetch('/api/process', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id })
		});
		episodes = episodes.filter((ep) => ep.id !== id);
		const { [id]: _removed, ...rest } = resumePositions;
		resumePositions = rest;
		if (episode?.status === 'ready') {
			clipsStudied = Math.max(0, clipsStudied - 1);
		}
		await invalidateAll();
	}

	function statusLabel(ep: Episode) {
		switch (ep.status) {
			case 'pending': return 'Queued';
			case 'fetching_audio': return 'Fetching audio…';
			case 'downloading': return 'Fetching audio…'; // legacy rows
			case 'transcribing': return 'Transcribing…';
			case 'analyzing': return 'Analyzing…';
			case 'ready': return 'Ready';
			case 'error': return 'Error';
			default: return ep.status;
		}
	}

	function resumeLabel(ep: Episode) {
		if (ep.status !== 'ready') return null;
		const resumeAt = resumePositions[ep.id];
		return resumeAt ? formatTime(resumeAt) : null;
	}

	function relativeTime(dateStr: string) {
		if (!dateStr) return '';
		const d = new Date(dateStr);
		const now = Date.now();
		const diff = now - d.getTime();
		const mins = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);
		if (mins < 60) return `${mins}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days === 1) return 'yesterday';
		if (days < 7) return `${days}d ago`;
		if (days < 14) return 'last week';
		return `${Math.floor(days / 7)}w ago`;
	}
</script>

<svelte:head>
	<title>Clip Learner</title>
</svelte:head>

<div class="page">

	<!-- Top nav -->
	<nav class="topnav">
		<span class="brand">
			<Clapperboard size={16} aria-hidden="true" />
			Clip Learner
		</span>
		<div class="nav-right">
			{#if data.user}
				<a href="/notebook" class="nav-link">
					<BookMarked size={14} aria-hidden="true" />
					Notebook
					{#if wordsSaved > 0}<span class="nav-badge">{wordsSaved}</span>{/if}
				</a>
				<button
					type="button"
					class="theme-toggle"
					onclick={() => settingsOpen = true}
					aria-label="Settings"
				>
					<Settings size={14} aria-hidden="true" />
				</button>
			{/if}
			<button
				type="button"
				class="theme-toggle"
				onclick={toggleTheme}
				aria-label={theme === 'dark' ? 'Switch to day mode' : 'Switch to dark mode'}
			>
				{#if theme === 'dark'}
					<SunMedium size={14} aria-hidden="true" />
				{:else}
					<MoonStar size={14} aria-hidden="true" />
				{/if}
			</button>
			{#if data.user}
				<form method="POST" action="/api/logout" style="display:contents">
					<button type="submit" class="user-chip" title="Log out {data.user.username}">
						{data.user.username}
					</button>
				</form>
			{/if}
		</div>
	</nav>

	<!-- Hero -->
	<div class="hero">
		<h1>Keep watching.<br><em>We'll handle the words.</em></h1>
		<p class="lede">Paste a YouTube link — tap any word to get an instant explanation, without pausing your brain.</p>

		<form class="input-box" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
			<label class="sr-only" for="youtube-url">YouTube URL</label>
			<div class="input-row">
				<Youtube size={18} aria-hidden="true" class="yt-icon" />
				<input
					id="youtube-url"
					bind:value={url}
					name="youtubeUrl"
					type="url"
					autocomplete="url"
					inputmode="url"
					placeholder="Paste a YouTube URL…"
					disabled={loading}
					aria-describedby={error ? 'youtube-url-error' : undefined}
				/>
				<button type="submit" class="submit-btn" disabled={loading || !url.trim()}>
					{#if loading}
						<Loader2 size={15} aria-hidden="true" class="spin" />
						Processing…
					{:else}
						<Plus size={15} aria-hidden="true" />
						Study
					{/if}
				</button>
			</div>
		</form>
		{#if error}<p class="input-error" id="youtube-url-error" role="alert">{error}</p>{/if}
	</div>

	<!-- Clips list -->
	{#if episodes.length > 0}
		<section class="clips-section" aria-label="Your clips">
			<div class="section-header">
				<h2>Recent clips</h2>
				<span class="section-count">{episodes.length}</span>
			</div>

			<div class="clips">
				{#each episodes as ep}
					<article class="clip" class:disabled={ep.status !== 'ready'}>
						{#if ep.status === 'ready'}
							<a
								class="clip-link"
								href={`/episode/${ep.id}`}
								aria-label={`Study: ${ep.title || ep.url}`}
							></a>
						{/if}

						<div class="clip-icon" aria-hidden="true">
							{#if ep.status === 'ready'}
								<PlayCircle size={18} />
							{:else if ep.status === 'error'}
								<AlertCircle size={18} />
							{:else}
								<Loader2 size={18} class="spin" />
							{/if}
						</div>

						<div class="clip-body">
							<div class="clip-title">{ep.title || ep.url}</div>
							<div class="clip-meta">
								<span
									class="status-chip"
									class:ready={ep.status === 'ready'}
									class:processing={ep.status !== 'ready' && ep.status !== 'error'}
									class:err={ep.status === 'error'}
								>
									{#if ep.status === 'ready'}
										<CheckCircle2 size={10} aria-hidden="true" />
									{:else if ep.status === 'error'}
										<AlertCircle size={10} aria-hidden="true" />
									{:else}
										<Loader2 size={10} class="spin" aria-hidden="true" />
									{/if}
									{statusLabel(ep)}
								</span>
								{#if ep.status === 'ready' && ep.created_at}
									<span class="meta-sep">·</span>
									<Clock size={11} aria-hidden="true" />
									<span>{relativeTime(ep.created_at)}</span>
								{/if}
							</div>
						</div>

						<div class="clip-actions">
							{#if resumeLabel(ep)}
								<a class="resume-btn" href={`/episode/${ep.id}`} tabindex="-1" aria-hidden="true">
									<RotateCcw size={11} aria-hidden="true" />
									{resumeLabel(ep)}
								</a>
							{/if}
							<button
								type="button"
								class="delete-btn"
								onclick={(e) => deleteEpisode(e, ep.id)}
								aria-label={`Remove ${ep.title || 'clip'}`}
							>
								<Trash2 size={13} aria-hidden="true" />
							</button>
						</div>
					</article>
				{/each}
			</div>
		</section>
	{/if}

	<footer>
		<span class="footer-brand">Clip Learner · {new Date().getFullYear()}</span>
		<div class="footer-stats">
			<span><b>{wordsSaved}</b> words saved</span>
			<span><b>{clipsStudied}</b> clips studied</span>
		</div>
	</footer>

</div>

<SettingsModal bind:open={settingsOpen} />


<style>
	.page {
		/* Same fluid clamp approach used on the episode page. Caps at 1100px
		 * on wide monitors so content doesn't stretch awkwardly, but grows
		 * from the old fixed 720px so the hero and input don't look lost on
		 * a big external display. */
		max-width: clamp(560px, 70vw, 1100px);
		margin: 0 auto;
		padding: 0 clamp(16px, 3vw, 40px) 80px;
	}

	@media (max-width: 560px) {
		.page {
			max-width: 100%;
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* Top nav */
	.topnav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20px 0 0;
		margin-bottom: 72px;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 15px;
		font-weight: 600;
		color: var(--text);
		letter-spacing: -0.01em;
	}

	.nav-right {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.nav-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		font-size: 13px;
		color: var(--text-muted);
		background: var(--bg-card);
		transition: border-color 0.15s, color 0.15s;
		position: relative;
	}
	.nav-link:hover {
		color: var(--text);
		border-color: var(--text-light);
		text-decoration: none;
	}

	.nav-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: var(--radius-pill);
		background: var(--accent);
		color: white;
		font-size: 10px;
		font-weight: 700;
		line-height: 1;
	}

	.theme-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-card);
		color: var(--text-muted);
		transition: border-color 0.15s, color 0.15s;
	}
	.theme-toggle:hover {
		border-color: var(--text-light);
		color: var(--text);
	}
	.theme-toggle:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.user-chip {
		display: inline-flex;
		align-items: center;
		padding: 5px 11px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-card);
		font-size: 12.5px;
		font-weight: 500;
		color: var(--text-muted);
		cursor: pointer;
		transition: color 0.12s, border-color 0.12s;
	}
	.user-chip:hover {
		color: var(--red);
		border-color: color-mix(in srgb, var(--red) 40%, var(--border));
	}

	/* Hero */
	.hero {
		margin-bottom: 48px;
	}

	.hero h1 {
		font-family: var(--font-display);
		font-size: 48px;
		line-height: 1.08;
		letter-spacing: -0.025em;
		font-weight: 400;
		margin-bottom: 16px;
		text-wrap: balance;
	}
	.hero h1 em {
		color: var(--accent);
		font-style: italic;
	}

	.lede {
		font-size: 16px;
		color: var(--text-muted);
		max-width: 560px;
		line-height: 1.7;
		margin-bottom: 28px;
	}

	/* Input box */
	.input-box {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		transition: border-color 0.15s;
	}
	.input-box:focus-within {
		border-color: var(--text-light);
	}

	.input-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 6px 6px 16px;
	}

	:global(.yt-icon) {
		color: #ff0033;
		flex-shrink: 0;
	}

	.input-row input {
		flex: 1;
		border: none;
		outline: none;
		background: transparent;
		font: inherit;
		font-size: 15px;
		padding: 12px 0;
		color: var(--text);
		min-width: 0;
	}
	.input-row input::placeholder {
		color: var(--text-light);
	}

	.submit-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 10px 18px;
		border-radius: var(--radius-md);
		background: var(--accent);
		color: white;
		font-size: 14px;
		font-weight: 600;
		border: none;
		transition: background 0.15s, opacity 0.15s;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.submit-btn:hover:not(:disabled) {
		background: var(--accent-hover);
	}
	.submit-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.input-error {
		margin-top: 8px;
		font-size: 13px;
		color: var(--red);
		display: flex;
		align-items: center;
		gap: 5px;
	}

	/* Clips section */
	.clips-section {
		margin-top: 48px;
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--border);
		margin-bottom: 4px;
	}

	.section-header h2 {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-light);
	}

	.section-count {
		font-size: 11px;
		color: var(--text-light);
		background: var(--bg-dark);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 1px 7px;
		font-variant-numeric: tabular-nums;
	}

	/* Clips list */
	.clips {
		display: flex;
		flex-direction: column;
	}

	.clip {
		display: grid;
		grid-template-columns: 32px 1fr auto;
		gap: 12px;
		align-items: center;
		padding: 14px 10px;
		border-bottom: 1px solid var(--border-light);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background 0.12s;
		position: relative;
		margin: 0 -10px;
	}
	.clip:last-child {
		border-bottom: none;
	}
	.clip:hover {
		background: var(--bg-dark);
	}
	.clip.disabled {
		cursor: default;
	}
	.clip.disabled:hover {
		background: transparent;
	}

	.clip-link {
		position: absolute;
		inset: 0;
		z-index: 1;
		border-radius: var(--radius-sm);
	}
	.clip-link:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	.clip-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-light);
		position: relative;
		z-index: 2;
		flex-shrink: 0;
		/* Let clicks fall through to the absolutely-positioned <a class="clip-link">
		 * overlay behind us — otherwise the user has to aim for the padding gaps
		 * to navigate, which feels broken. */
		pointer-events: none;
	}
	.clip.disabled .clip-icon {
		opacity: 0.5;
	}

	.clip-body {
		min-width: 0;
		position: relative;
		z-index: 2;
		pointer-events: none;
	}

	.clip-title {
		font-size: 15px;
		font-weight: 500;
		color: var(--text);
		letter-spacing: -0.005em;
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin-bottom: 4px;
	}

	.clip-meta {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--text-light);
	}

	.meta-sep {
		opacity: 0.4;
	}

	.status-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		font-weight: 500;
	}
	.status-chip.ready {
		color: var(--green);
	}
	.status-chip.processing {
		color: var(--text-light);
	}
	.status-chip.err {
		color: var(--red);
	}

	.clip-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		position: relative;
		z-index: 2;
	}

	.resume-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		font-weight: 500;
		color: var(--text-muted);
		padding: 5px 10px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-dark);
		white-space: nowrap;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
		opacity: 0;
	}
	.clip:hover .resume-btn {
		opacity: 1;
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}
	.resume-btn:hover {
		text-decoration: none;
	}

	.delete-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: var(--radius-sm);
		color: var(--text-light);
		background: none;
		border: none;
		transition: background 0.12s, color 0.12s;
		opacity: 0;
	}
	.clip:hover .delete-btn {
		opacity: 1;
	}
	.delete-btn:hover {
		background: var(--bg-dark);
		color: var(--red);
	}

	/* Footer */
	footer {
		margin-top: 64px;
		padding-top: 20px;
		border-top: 1px solid var(--border-light);
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}

	.footer-brand {
		font-size: 12px;
		color: var(--text-light);
	}

	.footer-stats {
		display: flex;
		gap: 16px;
		font-size: 12px;
		color: var(--text-light);
	}
	.footer-stats b {
		color: var(--text);
		font-weight: 600;
	}

	:global(.spin) {
		animation: spin 1.2s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@media (max-width: 560px) {
		.page {
			padding: 0 16px 60px;
		}
		.topnav {
			margin-bottom: 48px;
		}
		.hero h1 {
			font-size: 34px;
		}
		.lede {
			font-size: 15px;
		}
		.clip {
			grid-template-columns: 28px 1fr;
		}
		.clip-actions {
			grid-column: 2;
		}
		.delete-btn,
		.resume-btn {
			opacity: 1;
		}
	}
</style>
