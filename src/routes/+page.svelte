<script lang="ts">
	import type { Episode } from '$lib/types';
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { formatTime } from '$lib/utils/time';
	import { loadResumePosition } from '$lib/utils/resume';
	import {
		MoonStar, SunMedium, Youtube, ArrowRight, PlayCircle,
		Clock, CheckCircle2, Loader2, AlertCircle, Trash2,
		BookMarked, Plus, Clapperboard, RotateCcw, Settings, LogOut,
		Headphones, MousePointerClick, BrainCircuit, FileText, BookOpen, Link
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
	let deleteConfirmId = $state<string | null>(null);
	let deleteConfirmTitle = $state('');

	// Article reader
	let articleUrl = $state('');
	let articleLoading = $state(false);
	let articleError = $state('');
	let articles = $state<any[]>([]);

	$effect(() => { articles = data.articles || []; });

	async function handleLogout() {
		try {
			await fetch('/api/logout', { method: 'POST' });
		} catch {}
		window.location.href = '/';
	}

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
			// Players save with video_id (YouTube ID), not episode.id (UUID)
			const key = episode.video_id || episode.id;
			const saved = loadResumePosition(key);
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

		// Clean up signup flag (no longer auto-opens Settings — we prompt when they click Study)
		localStorage.removeItem('clip-just-signed-up');

		// Restore a URL the user pasted before being asked to sign in.
		const pending = localStorage.getItem('clip-pending-url');
		if (pending && data.user) {
			localStorage.removeItem('clip-pending-url');
			url = pending;
			tick().then(() => handleSubmit());
		}

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
		// Briefly suppress all transitions so theme switch is instant (no flash)
		document.documentElement.style.setProperty('--theme-transition', 'none');
		document.documentElement.dataset.theme = theme;
		localStorage.setItem('tm-theme', theme);
		requestAnimationFrame(() => {
			document.documentElement.style.removeProperty('--theme-transition');
		});
	}

	function isYouTubeUrl(u: string): boolean {
		return /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)/.test(u);
	}

	async function handleSubmit() {
		if (!url.trim()) return;
		if (!isYouTubeUrl(url.trim())) {
			error = 'Please paste a valid YouTube URL (youtube.com or youtu.be)';
			return;
		}
		if (!data.user) {
			localStorage.setItem('clip-pending-url', url.trim());
			authModalOpen.set(true);
			return;
		}
		// Check if API key is configured before starting
		try {
			const settingsRes = await fetch('/api/settings');
			const settings = await settingsRes.json();
			if (!settings.api_key) {
				error = '';
				settingsOpen = true;
				return;
			}
		} catch {}

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

	function deleteEpisode(e: MouseEvent, id: string) {
		e.preventDefault();
		e.stopPropagation();
		const ep = episodes.find((ep) => ep.id === id);
		deleteConfirmId = id;
		deleteConfirmTitle = ep?.title || 'this clip';
	}

	async function handleArticleSubmit() {
		if (!articleUrl.trim()) return;
		if (!data.user) { authModalOpen.set(true); return; }
		articleLoading = true;
		articleError = '';
		try {
			const fetchRes = await fetch('/api/articles/fetch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: articleUrl.trim() })
			});
			const fetched = await fetchRes.json();
			if (!fetchRes.ok) { articleError = fetched.error || 'Could not fetch article.'; return; }

			const createRes = await fetch('/api/articles', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: fetched.title, url: articleUrl.trim(), source: fetched.source, content: fetched.content })
			});
			const created = await createRes.json();
			if (!createRes.ok) { articleError = created.error || 'Could not save article.'; return; }
			await goto(`/articles/${created.id}`);
		} catch {
			articleError = 'Network error. Please try again.';
		} finally {
			articleLoading = false;
		}
	}

	async function deleteArticle(id: string) {
		await fetch('/api/articles', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id })
		});
		articles = articles.filter((a) => a.id !== id);
	}

	async function confirmDelete() {
		const id = deleteConfirmId;
		if (!id) return;
		deleteConfirmId = null;
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
				<a href="/articles/new" class="nav-link">
					<FileText size={14} aria-hidden="true" />
					Articles
				</a>
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
				<button type="button" class="user-chip" title="Log out" onclick={handleLogout}>
					{data.user.username}
					<LogOut size={12} aria-hidden="true" />
				</button>
			{:else}
				<button type="button" class="signin-btn" onclick={() => authModalOpen.set(true)}>
					Sign in
				</button>
			{/if}
		</div>
	</nav>

	<!-- Hero -->
	<div class="hero">
		<h1>Keep watching.<br><em>We'll handle the words.</em></h1>
		<p class="lede">Turn any YouTube clip into an interactive English lesson — with transcript, word lookup, explanations, and quizzes.</p>

		<div class="features">
			<div class="feature">
				<span class="feature-icon"><Headphones size={18} /></span>
				<div><strong>Auto-transcribe</strong><span class="feature-desc">AI transcribes any YouTube video in seconds</span></div>
			</div>
			<div class="feature">
				<span class="feature-icon"><MousePointerClick size={18} /></span>
				<div><strong>Tap to learn</strong><span class="feature-desc">Tap any word in the transcript for its definition</span></div>
			</div>
			<div class="feature">
				<span class="feature-icon"><BrainCircuit size={18} /></span>
				<div><strong>Adaptive quiz</strong><span class="feature-desc">Test yourself with AI-generated questions</span></div>
			</div>
		</div>

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

		<!-- How it works -->
		<div class="how-it-works">
			<div class="step">
				<span class="step-num">1</span>
				<span class="step-text">Paste a YouTube link</span>
			</div>
			<span class="step-arrow">
				<ArrowRight size={14} />
			</span>
			<div class="step">
				<span class="step-num">2</span>
				<span class="step-text">AI transcribes & analyzes</span>
			</div>
			<span class="step-arrow">
				<ArrowRight size={14} />
			</span>
			<div class="step">
				<span class="step-num">3</span>
				<span class="step-text">Study, tap words, take quiz</span>
			</div>
		</div>
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

	<!-- Article Reader section -->
	{#if data.user}
	<section class="article-section">
		<div class="article-input-wrap">
			<form class="input-box" onsubmit={(e) => { e.preventDefault(); handleArticleSubmit(); }}>
				<div class="input-row">
					<FileText size={18} aria-hidden="true" class="yt-icon" />
					<input
						bind:value={articleUrl}
						type="url"
						placeholder="Paste an article URL (BBC, Guardian, …)"
						disabled={articleLoading}
					/>
					<button type="submit" class="submit-btn" disabled={articleLoading || !articleUrl.trim()}>
						{#if articleLoading}
							<Loader2 size={15} class="spin" aria-hidden="true" /> Fetching…
						{:else}
							<BookOpen size={15} aria-hidden="true" /> Read
						{/if}
					</button>
				</div>
			</form>
			{#if articleError}<p class="input-error" role="alert">{articleError}</p>{/if}
			<p class="article-hint">Or <a href="/articles/new" class="article-hint-link">paste text directly →</a></p>
		</div>

		{#if articles.length > 0}
			<div class="section-header">
				<h2>Recent articles</h2>
				<span class="section-count">{articles.length}</span>
			</div>
			<div class="clips">
				{#each articles as art}
					<article class="clip">
						<a class="clip-link" href="/articles/{art.id}" aria-label="Read: {art.title}"></a>
						<div class="clip-icon" aria-hidden="true">
							<FileText size={18} />
						</div>
						<div class="clip-body">
							<div class="clip-title">{art.title}</div>
							<div class="clip-meta">
								{#if art.source}<span class="source-chip">{art.source}</span><span class="meta-sep">·</span>{/if}
								<Clock size={11} aria-hidden="true" />
								<span>{relativeTime(art.created_at)}</span>
							</div>
						</div>
						<div class="clip-actions">
							<button
								type="button"
								class="delete-btn"
								onclick={(e) => { e.preventDefault(); e.stopPropagation(); deleteArticle(art.id); }}
								aria-label="Remove article"
							>
								<Trash2 size={13} aria-hidden="true" />
							</button>
						</div>
					</article>
				{/each}
			</div>
		{/if}
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

{#if deleteConfirmId}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="del-backdrop" onclick={() => deleteConfirmId = null} onkeydown={() => {}}></div>
	<div class="del-modal" role="dialog" aria-modal="true" aria-labelledby="del-title">
		<p id="del-title" class="del-title">Remove clip?</p>
		<p class="del-sub" title={deleteConfirmTitle}>{deleteConfirmTitle.length > 60 ? deleteConfirmTitle.slice(0, 57) + '…' : deleteConfirmTitle}</p>
		<div class="del-actions">
			<button class="del-cancel" onclick={() => deleteConfirmId = null}>Cancel</button>
			<button class="del-confirm" onclick={confirmDelete}>Remove</button>
		</div>
	</div>
{/if}


<style>
	.page {
		max-width: clamp(560px, 70vw, 1000px);
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
		padding: 16px 0 0;
		margin-bottom: 0;
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
		padding: 7px 14px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--border);
		font-size: 12px;
		color: var(--text-muted);
		background: transparent;
		transition: border-color 0.15s, color 0.15s;
		position: relative;
	}
	.nav-link:hover {
		color: var(--text);
		border-color: #333;
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
		border-radius: 50%;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-muted);
		transition: border-color 0.15s, color 0.15s;
	}
	.theme-toggle:hover {
		border-color: #333;
		color: var(--text);
	}
	.theme-toggle:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.user-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--border);
		background: transparent;
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.user-chip:hover {
		color: var(--red);
		border-color: rgba(199, 69, 69, 0.4);
	}

	.features {
		display: flex;
		gap: 16px;
		margin: 32px 0 40px;
		justify-content: center;
	}
	.feature {
		flex: 1;
		max-width: 220px;
		padding: 18px;
		border-radius: 14px;
		border: 1px solid var(--border);
		background: var(--bg-card);
		text-align: left;
	}
	.feature-icon {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-subtle);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--accent);
		margin-bottom: 12px;
	}
	.feature strong {
		display: block;
		font-weight: 600;
		font-size: 13px;
		margin-bottom: 4px;
	}
	.feature-desc {
		display: block;
		font-size: 12px;
		color: var(--text-light);
		line-height: 1.5;
	}

	.signin-btn {
		display: inline-flex;
		align-items: center;
		padding: 7px 16px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--accent);
		background: var(--accent);
		color: #000;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}
	.signin-btn:hover { background: var(--accent-hover); border-color: var(--accent-hover); }

	/* Hero */
	.hero {
		margin-top: clamp(60px, 12vh, 140px);
		margin-bottom: 48px;
		text-align: center;
	}

	.hero h1 {
		font-family: var(--font-display);
		font-size: 52px;
		line-height: 1.08;
		letter-spacing: -0.03em;
		font-weight: 700;
		margin-bottom: 18px;
		text-wrap: balance;
	}
	.hero h1 em {
		font-style: italic;
		background: linear-gradient(135deg, var(--accent), #e8a66a);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
	}

	.lede {
		font-size: 15px;
		color: var(--text-muted);
		max-width: 480px;
		margin: 0 auto 28px;
		line-height: 1.7;
	}

	/* How it works */
	.how-it-works {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		margin-top: 28px;
	}
	.step {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.step-num {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 1px solid var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		flex-shrink: 0;
	}
	.step-text {
		font-size: 12px;
		color: var(--text-muted);
	}
	.step-arrow {
		color: var(--text-light);
		display: flex;
		align-items: center;
	}

	/* Input box */
	.input-box {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: 14px;
		overflow: hidden;
		transition: border-color 0.3s, box-shadow 0.3s;
	}
	.input-box:focus-within {
		border-color: rgba(212, 133, 74, 0.4);
		box-shadow: 0 0 0 3px rgba(212, 133, 74, 0.08), 0 0 20px rgba(212, 133, 74, 0.06);
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
		padding: 10px 20px;
		border-radius: 10px;
		background: var(--accent);
		color: #fff;
		font-size: 13px;
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

	.article-section {
		margin-top: 40px;
	}

	.article-input-wrap {
		margin-bottom: 24px;
	}

	.article-hint {
		margin: 8px 0 0;
		font-size: 12.5px;
		color: var(--text-muted);
	}
	.article-hint-link {
		color: var(--accent);
		text-decoration: none;
	}
	.article-hint-link:hover { text-decoration: underline; }

	.source-chip {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--bg-dark);
		padding: 1px 6px;
		border-radius: var(--radius-pill);
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 14px;
	}
	.section-header::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border-light);
	}

	.section-header h2 {
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-light);
	}

	.section-count {
		font-size: 10px;
		color: var(--text-light);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 2px 8px;
		font-variant-numeric: tabular-nums;
	}

	/* Clips list */
	.clips {
		display: flex;
		flex-direction: column;
	}

	.clip {
		display: grid;
		grid-template-columns: 36px 1fr auto;
		gap: 14px;
		align-items: center;
		padding: 14px 18px;
		border: 1px solid var(--border-light);
		border-radius: 12px;
		background: var(--bg-card);
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s, color 0.15s;
		position: relative;
		margin-bottom: 8px;
	}
	.clip:last-child {
		margin-bottom: 0;
	}
	.clip:hover {
		border-color: var(--border);
		background: var(--bg-subtle);
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
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 1px solid var(--border);
		background: var(--bg-subtle);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-light);
		position: relative;
		z-index: 2;
		flex-shrink: 0;
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
		font-size: 14px;
		font-weight: 500;
		color: var(--text);
		letter-spacing: -0.005em;
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin-bottom: 3px;
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
		color: var(--accent);
		padding: 5px 12px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--border);
		background: transparent;
		white-space: nowrap;
		transition: all 0.15s;
	}
	.clip:hover .resume-btn {
		border-color: rgba(212, 133, 74, 0.4);
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
			margin-bottom: 0;
		}
		.nav-right { gap: 4px; }
		.nav-link { padding: 6px 10px; font-size: 11px; }
		.nav-badge { min-width: 16px; height: 16px; font-size: 9px; }
		.theme-toggle { width: 30px; height: 30px; }
		.user-chip { padding: 6px 10px; font-size: 11px; }
		.hero {
			margin-top: 48px;
		}
		.hero h1 {
			font-size: 32px;
		}
		.lede {
			font-size: 14px;
		}
		.features {
			display: none;
		}
		.how-it-works {
			display: none;
		}
		.clip {
			grid-template-columns: 28px 1fr;
			padding: 12px 14px;
		}
		.clip-actions {
			grid-column: 2;
		}
		.delete-btn,
		.resume-btn {
			opacity: 1;
		}
	}

	/* Delete confirmation modal */
	.del-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 900;
		backdrop-filter: blur(2px);
	}
	.del-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 901;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 24px 24px 20px;
		width: min(360px, 90vw);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
		animation: delIn 0.15s ease-out;
	}
	@keyframes delIn {
		from { opacity: 0; transform: translate(-50%, -48%); }
		to   { opacity: 1; transform: translate(-50%, -50%); }
	}
	.del-title {
		font-size: 15px;
		font-weight: 600;
		color: var(--text);
		margin: 0 0 6px;
	}
	.del-sub {
		font-size: 13px;
		color: var(--text-muted);
		margin: 0 0 20px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.del-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.del-cancel {
		padding: 7px 16px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--border);
		background: transparent;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-muted);
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s;
	}
	.del-cancel:hover {
		border-color: var(--border);
		color: var(--text);
	}
	.del-confirm {
		padding: 7px 16px;
		border-radius: var(--radius-pill);
		border: none;
		background: var(--red);
		font-size: 13px;
		font-weight: 500;
		color: #fff;
		cursor: pointer;
		transition: opacity 0.12s;
	}
	.del-confirm:hover { opacity: 0.85; }
</style>
