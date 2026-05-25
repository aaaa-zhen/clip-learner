<script lang="ts">
	import type { Episode } from '$lib/types';
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { formatTime } from '$lib/utils/time';
	import { loadResumePosition } from '$lib/utils/resume';
	import {
		Youtube, ArrowRight, PlayCircle,
		Clock, CheckCircle2, Loader2, AlertCircle, Trash2,
		BookMarked, Plus, Clapperboard, RotateCcw, Settings, LogOut,
		Headphones, MousePointerClick, BrainCircuit, FileText, BookOpen, Link,
		Sun, Moon, Monitor, Pin, PinOff
	} from 'lucide-svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import { authModalOpen } from '$lib/stores/auth';
	import { themeMode } from '$lib/stores/theme';
	import type { ThemeMode } from '$lib/stores/theme';

	let themeMenuOpen = $state(false);
	let themeToggleEl: HTMLButtonElement | undefined = $state();

	function setTheme(mode: ThemeMode) {
		themeMode.set(mode);
		themeMenuOpen = false;
		themeToggleEl?.focus();
	}

	function handleThemeMenuKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			themeMenuOpen = false;
			themeToggleEl?.focus();
			e.stopPropagation();
		}
		if (!themeMenuOpen) return;
		const items = (e.currentTarget as HTMLElement)?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
		if (!items?.length) return;
		const focused = document.activeElement as HTMLElement;
		const idx = Array.from(items).indexOf(focused);
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			items[(idx + 1) % items.length].focus();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			items[(idx - 1 + items.length) % items.length].focus();
		}
	}


	let { data } = $props();

	let url = $state('');
	let loading = $state(false);
	let error = $state('');
	let episodes = $state<Episode[]>([]);
	let clipsStudied = $state(0);
	let wordsSaved = $state(0);
	let resumePositions = $state<Record<string, number>>({});
	let settingsOpen = $state(false);
	let deleteConfirmId = $state<string | null>(null);
	let deleteConfirmTitle = $state('');

	// Article reader
	let articleMode = $state<'url' | 'paste'>('url');
	let articleUrl = $state('');
	let articleLoading = $state(false);
	let articleError = $state('');
	let pasteTitle = $state('');
	let pasteContent = $state('');
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

function isSupportedUrl(u: string): boolean {
		return /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/|twitter\.com\/\w+\/status\/|x\.com\/\w+\/status\/)/.test(u);
	}

	async function handleSubmit() {
		if (!url.trim()) return;
		if (!isSupportedUrl(url.trim())) {
			error = 'Please paste a valid YouTube or X/Twitter video URL';
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

	async function togglePin(e: MouseEvent, id: string) {
		e.preventDefault();
		e.stopPropagation();
		const ep = episodes.find((ep) => ep.id === id);
		if (!ep) return;
		const action = ep.pinned_at ? 'unpin' : 'pin';
		await fetch('/api/process', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id, action })
		});
		ep.pinned_at = action === 'pin' ? new Date().toISOString() : null;
		// Re-sort: pinned first, then by created_at
		episodes = [...episodes].sort((a, b) => {
			if (a.pinned_at && !b.pinned_at) return -1;
			if (!a.pinned_at && b.pinned_at) return 1;
			return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
		});
	}

	function deleteEpisode(e: MouseEvent, id: string) {
		e.preventDefault();
		e.stopPropagation();
		const ep = episodes.find((ep) => ep.id === id);
		deleteConfirmId = id;
		deleteConfirmTitle = ep?.title || 'this clip';
	}

	async function handleArticleSubmit() {
		articleLoading = true;
		articleError = '';
		try {
			if (articleMode === 'paste') {
				if (!pasteTitle.trim() || !pasteContent.trim()) return;
				const res = await fetch('/api/articles', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ title: pasteTitle.trim(), content: pasteContent.trim() })
				});
				const created = await res.json();
				if (!res.ok) { articleError = created.error || 'Could not create article.'; return; }
				await goto(`/articles/${created.id}`);
			} else {
				if (!articleUrl.trim()) return;
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
			}
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
			<a href="/articles/new" class="nav-link">
				<FileText size={14} aria-hidden="true" />
				Articles
			</a>
			<a href="/notebook" class="nav-link">
				<BookMarked size={14} aria-hidden="true" />
				Notebook
				{#if wordsSaved > 0}<span class="nav-badge">{wordsSaved}</span>{/if}
			</a>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="theme-wrap" onkeydown={handleThemeMenuKeydown}>
				<button
					bind:this={themeToggleEl}
					type="button"
					class="theme-toggle"
					onclick={() => themeMenuOpen = !themeMenuOpen}
					aria-expanded={themeMenuOpen}
					aria-haspopup="true"
					aria-label="Theme: {$themeMode}"
				>
					{#if $themeMode === 'light'}
						<Sun size={14} aria-hidden="true" />
					{:else if $themeMode === 'dark'}
						<Moon size={14} aria-hidden="true" />
					{:else}
						<Monitor size={14} aria-hidden="true" />
					{/if}
				</button>
				{#if themeMenuOpen}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="theme-backdrop" onclick={() => themeMenuOpen = false} onkeydown={() => {}}></div>
					<div class="theme-menu" role="menu" aria-label="Theme preference">
						<button class="theme-option" class:active={$themeMode === 'system'} onclick={() => setTheme('system')} role="menuitemradio" aria-checked={$themeMode === 'system'}>
							<Monitor size={14} aria-hidden="true" />
							System
						</button>
						<button class="theme-option" class:active={$themeMode === 'light'} onclick={() => setTheme('light')} role="menuitemradio" aria-checked={$themeMode === 'light'}>
							<Sun size={14} aria-hidden="true" />
							Light
						</button>
						<button class="theme-option" class:active={$themeMode === 'dark'} onclick={() => setTheme('dark')} role="menuitemradio" aria-checked={$themeMode === 'dark'}>
							<Moon size={14} aria-hidden="true" />
							Dark
						</button>
					</div>
				{/if}
			</div>
			{#if !data.user?.isGuest}
				<button
					type="button"
					class="theme-toggle"
					onclick={() => settingsOpen = true}
					aria-label="Settings"
				>
					<Settings size={14} aria-hidden="true" />
				</button>
			{/if}
			{#if data.user?.isGuest}
				<button type="button" class="signin-btn" onclick={() => authModalOpen.set(true)}>
					Sign in
				</button>
			{:else if data.user}
				<button type="button" class="user-chip" title="Log out" onclick={handleLogout}>
					{data.user.username}
					<LogOut size={12} aria-hidden="true" />
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
			<label class="sr-only" for="youtube-url">Video URL</label>
			<div class="input-row">
				<Youtube size={18} aria-hidden="true" class="yt-icon" />
				<input
					id="youtube-url"
					bind:value={url}
					name="youtubeUrl"
					type="url"
					autocomplete="url"
					inputmode="url"
					placeholder="Paste a YouTube or X/Twitter URL…"
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
		{#if error}<p class=input-error id=youtube-url-error role=alert>{error}</p>{/if}


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
								class="pin-btn"
								class:pinned={!!ep.pinned_at}
								onclick={(e) => togglePin(e, ep.id)}
								aria-label={ep.pinned_at ? 'Unpin' : 'Pin to top'}
								title={ep.pinned_at ? 'Unpin' : 'Pin to top'}
							>
								{#if ep.pinned_at}
									<PinOff size={13} aria-hidden="true" />
								{:else}
									<Pin size={13} aria-hidden="true" />
								{/if}
							</button>
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
			<div class="article-tabs">
				<button class="article-tab" class:active={articleMode === 'url'} onclick={() => { articleMode = 'url'; articleError = ''; }}>
					<Link size={14} /> URL
				</button>
				<button class="article-tab" class:active={articleMode === 'paste'} onclick={() => { articleMode = 'paste'; articleError = ''; }}>
					<FileText size={14} /> Paste text
				</button>
			</div>

			{#if articleMode === 'url'}
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
			{:else}
				<form class="paste-form" onsubmit={(e) => { e.preventDefault(); handleArticleSubmit(); }}>
					<input
						class="paste-input"
						type="text"
						placeholder="Article title"
						bind:value={pasteTitle}
						disabled={articleLoading}
					/>
					<textarea
						class="paste-textarea"
						placeholder="Paste the article text here…"
						bind:value={pasteContent}
						rows={6}
						disabled={articleLoading}
					></textarea>
					<button type="submit" class="submit-btn paste-submit" disabled={articleLoading || !pasteTitle.trim() || !pasteContent.trim()}>
						{#if articleLoading}
							<Loader2 size={15} class="spin" aria-hidden="true" /> Saving…
						{:else}
							<BookOpen size={15} aria-hidden="true" /> Start reading
						{/if}
					</button>
				</form>
			{/if}

			{#if articleError}<p class="input-error" role="alert">{articleError}</p>{/if}
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

<SettingsModal bind:open={settingsOpen} isGuest={data.user?.isGuest ?? false} />

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
		max-width: clamp(560px, 70vw, 940px);
		margin: 0 auto;
		padding: 0 clamp(16px, 3vw, 40px) 80px;
	}

	@media (max-width: 560px) {
		.page { max-width: 100%; }
	}

	.sr-only {
		position: absolute;
		width: 1px; height: 1px; padding: 0; margin: -1px;
		overflow: hidden; clip: rect(0, 0, 0, 0);
		white-space: nowrap; border: 0;
	}

	/* ── Top nav ── */
	.topnav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20px 0 0;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 15px;
		font-weight: 600;
		color: var(--gray12);
		letter-spacing: -0.01em;
		white-space: nowrap;
		flex-shrink: 0;
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
		border: none;
		font-size: 13px;
		color: var(--gray11);
		background: transparent;
		text-decoration: none;
		transition: color var(--duration-fast) var(--ease), background var(--duration-fast) var(--ease);
		position: relative;
	}
	.nav-link:hover {
		color: var(--gray12);
		background: var(--gray3);
		text-decoration: none;
	}

	.nav-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px; height: 18px;
		padding: 0 5px;
		border-radius: var(--radius-pill);
		background: var(--accent);
		color: white;
		font-size: 10px;
		font-weight: 700;
		line-height: 1;
	}

	.theme-wrap {
		position: relative;
	}
	.theme-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px; height: 34px;
		border-radius: 50%;
		border: none;
		background: transparent;
		color: var(--gray9);
		transition: color var(--duration-fast) var(--ease), background var(--duration-fast) var(--ease);
	}
	.theme-toggle:hover { background: var(--gray3); color: var(--gray12); }
	.theme-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

	.theme-backdrop {
		position: fixed;
		inset: 0;
		z-index: 99;
	}
	.theme-menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 100;
		background: var(--bg-card);
		border: 1px solid var(--grayA2);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		padding: 4px;
		min-width: 140px;
		animation: menuIn var(--duration-fast) var(--ease);
	}
	@keyframes menuIn {
		from { opacity: 0; transform: translateY(-4px) scale(0.97); }
		to   { opacity: 1; transform: translateY(0) scale(1); }
	}
	.theme-option {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 12px;
		border-radius: var(--radius-sm);
		font-size: 13px;
		font-weight: 500;
		color: var(--gray11);
		background: none;
		border: none;
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease);
	}
	.theme-option:hover { background: var(--gray3); color: var(--gray12); }
	.theme-option.active { color: var(--gray12); font-weight: 600; }
	.theme-option.active::after {
		content: '';
		width: 5px; height: 5px;
		border-radius: 50%;
		background: var(--accent);
		margin-left: auto;
	}

	.user-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		border-radius: var(--radius-pill);
		border: none;
		background: var(--gray3);
		font-size: 12px;
		font-weight: 500;
		color: var(--gray11);
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease), background var(--duration-fast) var(--ease);
	}
	.user-chip:hover { color: var(--red); background: var(--gray4); }

	.signin-btn {
		display: inline-flex;
		align-items: center;
		padding: 7px 18px;
		border-radius: var(--radius-pill);
		border: none;
		background: hsl(222 80% 55%);
		color: #fff;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		box-shadow: 0 1px 3px hsla(222 80% 40% / 0.25);
		transition: background var(--duration-fast) var(--ease);
	}
	.signin-btn:hover { background: hsl(222 80% 50%); }

	/* ── Features ── */
	.features {
		display: flex;
		gap: 12px;
		margin: 36px 0 44px;
		justify-content: center;
	}
	.feature {
		flex: 1;
		max-width: 220px;
		padding: 20px;
		border-radius: var(--radius-md);
		border: 1px solid var(--grayA2);
		background: var(--bg-card);
		text-align: left;
		box-shadow: var(--shadow-sm);
	}
	.feature-icon {
		width: 34px; height: 34px;
		border-radius: var(--radius-sm);
		background: var(--gray3);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--accent);
		margin-bottom: 14px;
	}
	.feature strong {
		display: block;
		font-weight: 600;
		font-size: 13px;
		color: var(--gray12);
		margin-bottom: 4px;
	}
	.feature-desc {
		display: block;
		font-size: 12px;
		color: var(--gray9);
		line-height: 1.5;
	}

	/* ── Hero ── */
	.hero {
		margin-top: clamp(64px, 14vh, 160px);
		margin-bottom: 56px;
		text-align: center;
	}

	.hero h1 {
		font-family: var(--font-display);
		font-size: clamp(36px, 5vw, 56px);
		line-height: 1.1;
		letter-spacing: -0.3px;
		font-weight: 500;
		margin-bottom: 20px;
		text-wrap: balance;
		color: var(--gray12);
	}
	.hero h1 em {
		font-style: italic;
	}

	.lede {
		font-size: 15px;
		color: var(--gray11);
		max-width: 460px;
		margin: 0 auto 32px;
		line-height: 28px;
	}

	/* ── How it works ── */
	.how-it-works {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		margin-top: 32px;
	}
	.step {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.step-num {
		width: 22px; height: 22px;
		border-radius: 50%;
		border: 1px solid var(--gray5);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		font-weight: 600;
		color: var(--gray9);
		flex-shrink: 0;
	}
	.step-text {
		font-size: 12px;
		color: var(--gray9);
	}
	.step-arrow {
		color: var(--gray7);
		display: flex;
		align-items: center;
	}

	/* ── Input box ── */
	.input-box {
		background: var(--gray2);
		border: 1px solid var(--gray4);
		border-radius: var(--radius-md);
		overflow: hidden;
		transition: border-color var(--duration-normal) var(--ease), box-shadow var(--duration-normal) var(--ease);
	}
	.input-box:focus-within {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
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
		color: var(--gray12);
		min-width: 0;
	}
	.input-row input::placeholder { color: var(--gray8); }

	.submit-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 12px 26px;
		border-radius: var(--radius-pill);
		background: hsl(222 80% 55%);
		color: #fff;
		font-size: 13px;
		font-weight: 600;
		border: none;
		box-shadow: 0 1px 3px hsla(222 80% 40% / 0.3), inset 0 1px 0 hsla(0 0% 100% / 0.15);
		transition: background var(--duration-fast) var(--ease), box-shadow var(--duration-fast) var(--ease), transform var(--duration-fast) var(--ease);
		white-space: nowrap;
		flex-shrink: 0;
	}
	.submit-btn:hover:not(:disabled) {
		background: hsl(222 80% 50%);
		box-shadow: 0 2px 8px hsla(222 80% 40% / 0.35), inset 0 1px 0 hsla(0 0% 100% / 0.15);
		transform: translateY(-0.5px);
	}
	.submit-btn:active:not(:disabled) { transform: translateY(0); box-shadow: 0 1px 2px hsla(222 80% 40% / 0.3); }
	.submit-btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }

	.input-error {
		margin-top: 10px;
		font-size: 13px;
		color: var(--red);
		display: flex;
		align-items: center;
		gap: 5px;
		white-space: pre-line;
	}



	/* ── Sections ── */
	.clips-section { margin-top: 56px; }
	.article-section { margin-top: 48px; }
	.article-input-wrap { margin-bottom: 28px; }

	.article-tabs {
		display: flex;
		gap: 4px;
		background: var(--gray3);
		padding: 4px;
		border-radius: var(--radius-sm);
		margin-bottom: 12px;
		max-width: 240px;
	}
	.article-tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 7px 12px;
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
	.article-tab.active {
		background: var(--bg-card);
		color: var(--gray12);
		box-shadow: var(--shadow-sm);
	}

	.paste-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.paste-input {
		border: 1px solid var(--gray4);
		border-radius: var(--radius-sm);
		padding: 10px 14px;
		font-size: 14px;
		color: var(--gray12);
		background: var(--gray2);
		font-family: var(--font-ui);
		transition: border-color var(--duration-fast) var(--ease);
	}
	.paste-input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.paste-input::placeholder { color: var(--gray8); }
	.paste-textarea {
		border: 1px solid var(--gray4);
		border-radius: var(--radius-sm);
		padding: 10px 14px;
		font-size: 14px;
		color: var(--gray12);
		background: var(--gray2);
		font-family: var(--font-ui);
		resize: vertical;
		line-height: 1.6;
		transition: border-color var(--duration-fast) var(--ease);
	}
	.paste-textarea:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.paste-textarea::placeholder { color: var(--gray8); }
	.paste-submit {
		align-self: flex-start;
	}

	.source-chip {
		font-size: 11px;
		font-weight: 600;
		color: var(--gray11);
		background: var(--gray3);
		padding: 1px 7px;
		border-radius: var(--radius-pill);
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 16px;
	}
	.section-header::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--gray3);
	}
	.section-header h2 {
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--gray9);
	}
	.section-count {
		font-size: 11px;
		color: var(--gray9);
		border: 1px solid var(--gray4);
		border-radius: var(--radius-pill);
		padding: 2px 8px;
		font-variant-numeric: tabular-nums;
	}

	/* ── Clips list ── */
	.clips {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.clip {
		display: grid;
		grid-template-columns: 36px 1fr auto;
		gap: 14px;
		align-items: center;
		padding: 14px 18px;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease);
		position: relative;
	}
	.clip:hover { background: var(--gray2); }
	.clip.disabled { cursor: default; }
	.clip.disabled:hover { background: transparent; }

	.clip-link {
		position: absolute;
		inset: 0;
		z-index: 1;
		border-radius: var(--radius-md);
	}
	.clip-link:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

	.clip-icon {
		width: 36px; height: 36px;
		border-radius: 50%;
		background: var(--gray3);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--gray9);
		position: relative;
		z-index: 2;
		flex-shrink: 0;
		pointer-events: none;
	}
	.clip.disabled .clip-icon { opacity: 0.5; }

	.clip-body {
		min-width: 0;
		position: relative;
		z-index: 2;
		pointer-events: none;
	}

	.clip-title {
		font-size: 14px;
		font-weight: 500;
		color: var(--gray12);
		letter-spacing: -0.005em;
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin-bottom: 2px;
	}

	.clip-meta {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--gray9);
	}

	.meta-sep { opacity: 0.4; }

	.status-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		font-weight: 500;
	}
	.status-chip.ready { color: var(--green); }
	.status-chip.processing { color: var(--gray9); }
	.status-chip.err { color: var(--red); }

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
		border: 1px solid var(--gray4);
		background: transparent;
		white-space: nowrap;
		transition: border-color var(--duration-fast) var(--ease);
	}
	.clip:hover .resume-btn { border-color: var(--gray6); }
	.resume-btn:hover { text-decoration: none; }

	.pin-btn, .delete-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px; height: 30px;
		border-radius: var(--radius-sm);
		color: var(--gray8);
		background: none;
		border: none;
		transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease);
		opacity: 0;
	}
	.clip:hover .pin-btn,
	.clip:focus-within .pin-btn,
	.clip:hover .delete-btn,
	.clip:focus-within .delete-btn { opacity: 1; }
	.pin-btn.pinned { opacity: 1; color: var(--accent); }
	.pin-btn:hover { background: var(--gray3); color: var(--accent); }
	.delete-btn:hover { background: var(--gray3); color: var(--red); }

	/* ── Footer ── */
	footer {
		margin-top: 72px;
		padding-top: 24px;
		border-top: 1px solid var(--gray3);
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}
	.footer-brand {
		font-size: 12px;
		color: var(--gray8);
	}
	.footer-stats {
		display: flex;
		gap: 20px;
		font-size: 12px;
		color: var(--gray8);
	}
	.footer-stats b { color: var(--gray12); font-weight: 600; }

	:global(.spin) { animation: spin 1.2s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	/* ── Mobile ── */
	@media (max-width: 560px) {
		.page { padding: 0 16px 60px; }
		.topnav { gap: 8px; }
		.brand { font-size: 14px; gap: 6px; }
		.nav-right { gap: 2px; }
		.nav-link { padding: 6px 8px; font-size: 0; }
		.nav-link :global(svg) { width: 16px; height: 16px; }
		.nav-badge { min-width: 16px; height: 16px; font-size: 9px; }
		.theme-toggle { width: 32px; height: 32px; }
		.user-chip { padding: 6px 8px; font-size: 0; }
		.user-chip :global(svg) { width: 14px; height: 14px; }
		.signin-btn { padding: 7px 14px; font-size: 12px; }
		.hero { margin-top: 48px; }
		.lede { font-size: 14px; }
		.features { display: none; }
		.how-it-works { display: none; }
		.clip {
			grid-template-columns: 28px 1fr;
			padding: 12px 14px;
		}
		.clip-actions { grid-column: 2; }
		.pin-btn, .delete-btn, .resume-btn { opacity: 1; }
	}

	/* ── Delete modal ── */
	.del-backdrop {
		position: fixed;
		inset: 0;
		background: hsla(0 0% 0% / 0.6);
		z-index: 900;
		backdrop-filter: blur(6px);
	}
	.del-modal {
		position: fixed;
		top: 50%; left: 50%;
		transform: translate(-50%, -50%);
		z-index: 901;
		background: var(--gray2);
		border: 1px solid var(--gray4);
		border-radius: var(--radius-lg);
		padding: 24px;
		width: min(360px, 90vw);
		box-shadow: var(--shadow-lg);
		animation: delIn var(--duration-fast) var(--ease);
	}
	@keyframes delIn {
		from { opacity: 0; transform: translate(-50%, -48%); }
		to   { opacity: 1; transform: translate(-50%, -50%); }
	}
	.del-title {
		font-size: 15px;
		font-weight: 600;
		color: var(--gray12);
		margin: 0 0 6px;
	}
	.del-sub {
		font-size: 13px;
		color: var(--gray11);
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
		padding: 8px 18px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--gray4);
		background: transparent;
		font-size: 13px;
		font-weight: 500;
		color: var(--gray11);
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease), background var(--duration-fast) var(--ease);
	}
	.del-cancel:hover { background: var(--gray3); color: var(--gray12); }
	.del-confirm {
		padding: 8px 18px;
		border-radius: var(--radius-sm);
		border: none;
		background: var(--red);
		font-size: 13px;
		font-weight: 500;
		color: #fff;
		cursor: pointer;
		transition: opacity var(--duration-fast) var(--ease);
	}
	.del-confirm:hover { opacity: 0.85; }
</style>
