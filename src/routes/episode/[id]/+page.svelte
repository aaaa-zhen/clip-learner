<script lang="ts">
	import YouTubePlayer from '$lib/components/YouTubePlayer.svelte';
	import VideoPlayer from '$lib/components/VideoPlayer.svelte';
		import WordPopup from '$lib/components/WordPopup.svelte';

	import { invalidateAll } from '$app/navigation';
	import { onDestroy, onMount, tick } from 'svelte';
	import { isPlaying, currentTime } from '$lib/stores/player';
	import { loadResumePosition } from '$lib/utils/resume';
	import { Download, BookOpen, HelpCircle, X, ArrowLeft, CheckCircle } from 'lucide-svelte';

	let { data } = $props();

	let videoPlayer: YouTubePlayer | VideoPlayer | undefined = $state();
	let videoPath = $state('');
	const hasLocalVideo = $derived(!!videoPath);
	let explanation = $state('');
	let loadingExplanation = $state(false);
	let downloading = $state(false);
	let downloaded = $state(false);
	let episodeStatus = $state('');
	let episodeError = $state('');

	// Progress info from /api/episode/[id]/status. The poll runs every 3s,
	// but we tick a client-side counter every second so elapsed time feels
	// live rather than jumpy.
	let progressStage = $state<string | null>(null);
	let progressElapsed = $state(0);
	let progressEstimate = $state<number | null>(null);
	let videoDurationSec = $state<number | null>(null);
	let elapsedLastSyncedAt = 0;
	let elapsedTicker: ReturnType<typeof setInterval> | null = null;
	let retryPending = $state(false);

	const isProcessing = $derived(
		episodeStatus === 'fetching_audio' ||
			episodeStatus === 'transcribing' ||
			episodeStatus === 'analyzing' ||
			episodeStatus === 'downloading' || // legacy value, still safe
			episodeStatus === 'pending'
	);
	const isErrored = $derived(episodeStatus === 'error');
	const isReady = $derived(episodeStatus === 'ready');

	// Overlay state
	let notebookOpen = $state(false);
	let quizOpen = $state(false);
	let lineHelpOpen = $state(false);
	let lineHelpText = $state('');
	let lineHelpTime = $state('');
	let notebookDrawerEl: HTMLElement | undefined = $state();
	let lineHelpDrawerEl: HTMLElement | undefined = $state();
	let quizCardEl: HTMLDivElement | undefined = $state();
	let lastFocusedElement: HTMLElement | null = null;
	let overlayWasOpen = false;

	// Transcript collapse
	let downloadPollInterval: ReturnType<typeof setInterval> | null = null;
	let processPollInterval: ReturnType<typeof setInterval> | null = null;

	// Active segment when paused — show as focused single line
	const pausedSegment = $derived.by(() => {
		if ($isPlaying) return null;
		const t = $currentTime;
		for (let i = data.segments.length - 1; i >= 0; i--) {
			if (t >= data.segments[i].start_time) return data.segments[i];
		}
		return data.segments[0] ?? null;
	});

	// Quiz state
	interface Question {
		type: string;
		question: string;
		options: string[];
		correct: number;
		context?: string;
	}
	let questions = $state<Question[]>([]);
	let quizLoading = $state(false);
	let currentQ = $state(0);
	let selectedAnswer = $state(-1);
	let answered = $state(false);
	let quizScore = $state(0);
	let quizFinished = $state(false);
	let answers = $state<{ok: boolean; q: string}[]>([]);
	let wordsSaved = $state(0);

	$effect(() => {
		episodeStatus = data.episode.status;
		episodeError = data.episode.error_message || '';
		if (data.episode.video_path) {
			videoPath = data.episode.video_path;
			downloaded = true;
		} else if (!downloading) {
			videoPath = '';
			downloaded = false;
		}
		wordsSaved = data.wordsSaved ?? 0;
	});

	$effect(() => {
		const inc = () => wordsSaved++;
		window.addEventListener('word:saved', inc);
		return () => window.removeEventListener('word:saved', inc);
	});

	const backdropVisible = $derived(notebookOpen || quizOpen || lineHelpOpen);

	function closeAll() { notebookOpen = false; quizOpen = false; lineHelpOpen = false; }

	function openNotebook() { lineHelpOpen = false; notebookOpen = true; }

	function openLineHelp(segmentId: number, text: string, time: string) {
		notebookOpen = false;
		lineHelpText = text;
		lineHelpTime = time;
		lineHelpOpen = true;
		fetchLineExplanation(segmentId);
	}

	async function fetchLineExplanation(segmentId: number) {
		loadingExplanation = true;
		explanation = '';
		try {
			const res = await fetch('/api/explain', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ segmentId })
			});
			const result = await res.json();
			explanation = result.explanation || result.error || 'No explanation available.';
		} catch {
			explanation = 'Failed to get explanation.';
		} finally {
			loadingExplanation = false;
		}
	}

	async function openQuiz() {
		currentQ = 0; selectedAnswer = -1; answered = false;
		quizScore = 0; quizFinished = false; answers = [];
		questions = [];
		quizLoading = true;
		quizOpen = true;
		try {
			const res = await fetch('/api/quiz', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ episodeId: data.episode.id })
			});
			const result = await res.json();
			questions = result.questions || [];
		} catch {
			questions = [];
		} finally {
			quizLoading = false;
		}
	}

	function clearDownloadPolling() {
		if (downloadPollInterval) {
			clearInterval(downloadPollInterval);
			downloadPollInterval = null;
		}
	}

	function clearProcessPolling() {
		if (processPollInterval) {
			clearInterval(processPollInterval);
			processPollInterval = null;
		}
	}

	function applyDownloadedVideo(path?: string) {
		videoPath = path || `/media/${data.episode.id}/video.mp4`;
		downloaded = true;
		downloading = false;
		clearDownloadPolling();
	}

	async function pollDownloadStatus() {
		const response = await fetch('/api/download', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ episodeId: data.episode.id })
		});
		const result = await response.json();
		if (response.status === 501 || result.error) {
			clearDownloadPolling();
			downloading = false;
			return;
		}
		if (result.status === 'ready') {
			applyDownloadedVideo(result.path);
		}
	}

	function startDownloadPolling() {
		if (downloadPollInterval) return;
		downloadPollInterval = setInterval(async () => {
			try {
				await pollDownloadStatus();
			} catch {}
		}, 5000);
	}

	async function handleDownload() {
		if (downloading || downloaded) return;
		downloading = true;
		try {
			const res = await fetch('/api/download', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ episodeId: data.episode.id })
			});
			const result = await res.json();
			if (res.status === 501 || result.error) {
				// Offline download not supported in this deployment
				downloading = false;
				alert(result.error || 'Offline download is not available.');
				return;
			}
			if (result.status === 'ready') {
				applyDownloadedVideo(result.path);
			} else {
				startDownloadPolling();
			}
		} catch {
			downloading = false;
		}
	}

	async function refreshEpisodeState() {
		try {
			// Read-only status check. Previously this POSTed to /api/process,
			// which would re-trigger analysis on page refresh if the episode was
			// in `analyzing` or `error` state — resetting progress every reload.
			const res = await fetch(`/api/episode/${data.episode.id}/status`);
			if (res.status === 401) {
				// Session expired while polling. Stop and let the layout show
				// the sign-in prompt on next navigation.
				clearProcessPolling();
				return;
			}
			if (!res.ok) return;
			const result = await res.json();
			if (result.status) episodeStatus = result.status;
			if (result.errorMessage) episodeError = result.errorMessage;
			if (result.durationSeconds) videoDurationSec = result.durationSeconds;
			if (result.progress) {
				progressStage = result.progress.stage;
				progressElapsed = result.progress.elapsedSeconds;
				progressEstimate = result.progress.estimateSeconds;
				if (result.progress.videoDurationSeconds) {
					videoDurationSec = result.progress.videoDurationSeconds;
				}
				elapsedLastSyncedAt = Date.now();
			} else if (result.status === 'ready' || result.status === 'error') {
				progressStage = null;
			}
			if (result.status === 'ready') {
				clearProcessPolling();
				stopElapsedTicker();
				await invalidateAll();
			}
		} catch {}
	}

	function startProcessPolling() {
		if (processPollInterval || episodeStatus === 'ready') return;
		// Fire an immediate poll so the UI doesn't sit blank for 3s on load.
		void refreshEpisodeState();
		processPollInterval = setInterval(async () => {
			await refreshEpisodeState();
		}, 3000);
		startElapsedTicker();
	}

	function startElapsedTicker() {
		if (elapsedTicker) return;
		elapsedTicker = setInterval(() => {
			if (!elapsedLastSyncedAt) return;
			// Advance client-side counter between polls so the timer ticks
			// every second instead of jumping every 3s.
			const drift = Math.floor((Date.now() - elapsedLastSyncedAt) / 1000);
			if (drift > 0) {
				progressElapsed = progressElapsed + drift;
				elapsedLastSyncedAt = Date.now();
			}
		}, 1000);
	}

	function stopElapsedTicker() {
		if (elapsedTicker) {
			clearInterval(elapsedTicker);
			elapsedTicker = null;
		}
	}

	function formatDuration(s: number | null | undefined) {
		if (s == null || !Number.isFinite(s) || s < 0) return '--:--';
		const total = Math.round(s);
		const mm = Math.floor(total / 60);
		const ss = total % 60;
		return `${mm}:${String(ss).padStart(2, '0')}`;
	}

	function stageLabel(stage: string | null | undefined, fallback: string) {
		switch (stage || fallback) {
			case 'queued':
			case 'pending':
				return 'Queued…';
			case 'fetching_audio':
			case 'downloading':
				return 'Fetching audio…';
			case 'transcribing':
				return 'Transcribing with Whisper…';
			case 'analyzing':
				return 'Analyzing with LLM…';
			case 'ready':
				return 'Ready';
			case 'error':
				return 'Failed';
			default:
				return (stage || fallback || '…').replace(/_/g, ' ');
		}
	}

	async function retryEpisode() {
		if (retryPending) return;
		retryPending = true;
		episodeError = '';
		try {
			const res = await fetch('/api/process', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: data.episode.url })
			});
			const result = await res.json();
			if (res.status === 401) return;
			if (result.status) episodeStatus = result.status;
			progressStage = 'queued';
			progressElapsed = 0;
			elapsedLastSyncedAt = Date.now();
			startProcessPolling();
		} catch {
			/* ignore */
		} finally {
			retryPending = false;
		}
	}

	function getActiveDialogElement() {
		if (quizOpen) return quizCardEl;
		if (lineHelpOpen) return lineHelpDrawerEl;
		if (notebookOpen) return notebookDrawerEl;
		return null;
	}

	function getFocusableElements(container: HTMLElement) {
		return Array.from(
			container.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		).filter((element) => !element.hasAttribute('hidden'));
	}

	function trapFocus(container: HTMLElement, event: KeyboardEvent) {
		const focusable = getFocusableElements(container);
		if (focusable.length === 0) {
			event.preventDefault();
			container.focus();
			return;
		}

		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement;

		if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		} else if (event.shiftKey && active === first) {
			event.preventDefault();
			last.focus();
		}
	}

	async function focusActiveDialog() {
		await tick();
		const dialog = getActiveDialogElement();
		if (!dialog) return;
		const focusable = getFocusableElements(dialog);
		(focusable[0] ?? dialog).focus();
	}

	$effect(() => {
		if (typeof document === 'undefined') return;
		const dialogOpen = backdropVisible;
		if (dialogOpen && !overlayWasOpen) {
			lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		}
		if (dialogOpen) {
			void focusActiveDialog();
		} else if (overlayWasOpen) {
			lastFocusedElement?.focus?.();
			lastFocusedElement = null;
		}
		overlayWasOpen = dialogOpen;
	});

	onMount(() => {
		// Pre-populate currentTime from the saved resume position so the
		// "paused line" panel shows the correct segment immediately after
		// refresh, instead of flickering to segment 0 until the YouTube
		// iframe fires onReady (which can take 1–2 seconds). Key must match
		// what YouTubePlayer writes — which is the YouTube video_id.
		const resumeKey = data.episode.video_id || data.episode.id;
		const saved = loadResumePosition(resumeKey);
		if (saved && saved > 0) {
			currentTime.set(saved);
		}

		if (episodeStatus !== 'ready' && episodeStatus !== 'error') {
			startProcessPolling();
		}

		const handleKey = (e: KeyboardEvent) => {
			if ((e.target as HTMLElement).matches('input, textarea')) return;
			if (e.key === 'Escape') closeAll();
			if (backdropVisible && e.key === 'Tab') {
				const dialog = getActiveDialogElement();
				if (dialog) {
					trapFocus(dialog, e);
				}
				return;
			}
			if (quizOpen && !answered && e.key >= '1' && e.key <= '4') pickOption(parseInt(e.key) - 1);
			if (quizOpen && answered && e.key === 'Enter') nextQuestion();
		};
		window.addEventListener('keydown', handleKey);
		return () => {
			window.removeEventListener('keydown', handleKey);
			clearDownloadPolling();
			clearProcessPolling();
		};
	});

	onDestroy(() => {
		clearDownloadPolling();
		clearProcessPolling();
		stopElapsedTicker();
		// Reset shared player stores so navigating to another episode
		// doesn't briefly show the previous episode's timestamp/caption.
		currentTime.set(0);
		isPlaying.set(false);
	});

	function handleSeek(time: number) {
		videoPlayer?.seekTo(time);
	}

	function handleExplain(segmentId: number) {
		const seg = data.segments.find((s: any) => s.id === segmentId);
		openLineHelp(segmentId, seg?.text || '', seg ? formatTime(seg.start_time) : '');
	}

	function formatTime(s: number) {
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}

	function shuffle<T>(arr: T[]): T[] {
		const a = [...arr];
		for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
		return a;
	}
	function pickOption(i: number) {
		if (answered) return;
		answered = true; selectedAnswer = i;
		const ok = i === questions[currentQ].correct;
		if (ok) quizScore++;
		answers = [...answers, { ok, q: questions[currentQ].question }];
	}
	function nextQuestion() {
		if (currentQ + 1 >= questions.length) { quizFinished = true; }
		else { currentQ++; selectedAnswer = -1; answered = false; }
	}

	const quizProgress = $derived(questions.length > 0 ? (currentQ / questions.length) * 100 : 0);

	async function saveWord(vocab: any) {
		try {
			await fetch('/api/notebook', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ word: vocab.word, definition: vocab.definition, example: vocab.example, episode_id: data.episode.id, category: vocab.category })
			});
		} catch {}
	}
</script>

<svelte:head>
	<title>{data.episode.title} - Clip Learner</title>
</svelte:head>

<div class="study-view" inert={backdropVisible} aria-hidden={backdropVisible}>
	<header>
		<a href="/" class="back"><ArrowLeft size={13} aria-hidden="true" />Back</a>
		<span class="divider"></span>
			<h1>{data.episode.title}</h1>
			<div class="top-actions">
				<button type="button" class="icon-btn" class:saved={downloaded} onclick={handleDownload} disabled={downloading || downloaded}>
					{#if downloaded}
						<CheckCircle size={13} strokeWidth={2} aria-hidden="true" />
						Saved
					{:else}
						<Download size={13} strokeWidth={2} aria-hidden="true" />
						{downloading ? 'Saving…' : 'Offline'}
					{/if}
				</button>
				<button type="button" class="icon-btn" onclick={openNotebook}>
					<BookOpen size={13} strokeWidth={2} aria-hidden="true" />
					Notebook
					{#if wordsSaved > 0}<span class="count">{wordsSaved}</span>{/if}
				</button>
				<button type="button" class="icon-btn primary" onclick={openQuiz}>
					<HelpCircle size={13} strokeWidth={2.2} aria-hidden="true" />
					Quiz me
				</button>
		</div>
	</header>

	<div class="stage">
			<div class="stage-inner">
				<div class="video-shell">
					{#if isReady}
						{#if hasLocalVideo}
							<VideoPlayer bind:this={videoPlayer} src={videoPath} segments={data.segments} />
						{:else}
							<YouTubePlayer
								bind:this={videoPlayer}
								videoId={data.episode.video_id || data.episode.id}
								segments={data.segments}
							/>
						{/if}
					{:else if isErrored}
						<div class="processing-panel error">
							<div class="processing-kicker">Processing failed</div>
							<h2 class="processing-title">Couldn't process this video</h2>
							<p class="processing-sub">{episodeError || 'An unknown error occurred.'}</p>
							<div class="processing-actions">
								<button
									type="button"
									class="retry-btn"
									onclick={retryEpisode}
									disabled={retryPending}
								>
									{retryPending ? 'Retrying…' : 'Try again'}
								</button>
								<a href="/" class="retry-link">← Back to clips</a>
							</div>
						</div>
					{:else}
						<div class="processing-panel">
							<div class="processing-spinner" aria-hidden="true"></div>
							<div class="processing-kicker">{stageLabel(progressStage, episodeStatus)}</div>
							<div class="processing-meta">
								<span class="processing-meta-item">
									<span class="processing-meta-label">Elapsed</span>
									<strong>{formatDuration(progressElapsed)}</strong>
								</span>
								{#if progressEstimate}
									<span class="processing-meta-dot">·</span>
									<span class="processing-meta-item">
										<span class="processing-meta-label">Estimated total</span>
										<strong>~{formatDuration(progressEstimate)}</strong>
									</span>
								{/if}
								{#if videoDurationSec}
									<span class="processing-meta-dot">·</span>
									<span class="processing-meta-item">
										<span class="processing-meta-label">Video length</span>
										<strong>{formatDuration(videoDurationSec)}</strong>
									</span>
								{/if}
							</div>
							<p class="processing-sub">
								This runs in the background. You can leave this tab — we'll be here
								when you come back.
							</p>
						</div>
					{/if}
			</div>

				<div class="paused-slot">
					{#if isReady && pausedSegment}
						<div class="paused-line transcript">
							<p class="paused-text">{pausedSegment.text}</p>
						</div>
					{/if}
				</div>

		</div>
	</div>
</div>

{#if backdropVisible}
	<div class="backdrop" onclick={closeAll} role="presentation"></div>
{/if}

<!-- Notebook drawer -->
<div
	class="drawer"
	class:open={notebookOpen}
	bind:this={notebookDrawerEl}
	role="dialog"
	aria-modal="true"
	aria-labelledby="notebook-dialog-title"
	aria-hidden={!notebookOpen}
	inert={!notebookOpen}
	tabindex="-1"
>
	<div class="drawer-head">
		<div class="drawer-head-row">
			<h2 id="notebook-dialog-title">Notebook</h2>
			<span class="drawer-count">{wordsSaved} words</span>
			<button type="button" class="drawer-close" onclick={() => notebookOpen = false} aria-label="Close notebook"><X size={18} /></button>
		</div>
	</div>
	<div class="drawer-body">
		{#if !data.notebookEntries?.length}
			<div class="drawer-empty"><p>Save words while studying to see them here.</p></div>
		{:else}
			{#each data.notebookEntries as entry}
				<div class="nb-entry">
					<div class="nb-entry-head">
						<strong class="nb-word">{entry.word}</strong>
						<span class="nb-cat">{entry.category}</span>
					</div>
					<p class="nb-def">{entry.definition}</p>
					{#if entry.example}<p class="nb-ex">{entry.example}</p>{/if}
				</div>
			{/each}
		{/if}
	</div>
	<div class="drawer-foot">
		<a href="/notebook" class="drawer-foot-link">Open full notebook →</a>
	</div>
</div>

<!-- Line help drawer -->
<div
	class="drawer"
	class:open={lineHelpOpen}
	bind:this={lineHelpDrawerEl}
	role="dialog"
	aria-modal="true"
	aria-labelledby="line-help-dialog-title"
	aria-hidden={!lineHelpOpen}
	inert={!lineHelpOpen}
	tabindex="-1"
>
	<div class="drawer-head">
		<div class="drawer-head-row">
			<h2 id="line-help-dialog-title">Line help</h2>
			{#if lineHelpTime}<span class="drawer-count">{lineHelpTime}</span>{/if}
			<button type="button" class="drawer-close" onclick={() => lineHelpOpen = false} aria-label="Close line help"><X size={18} /></button>
		</div>
	</div>
	<div class="drawer-body">
		{#if lineHelpText}
			<div class="help-ctx"><p class="help-quote">{lineHelpText}</p></div>
		{/if}
		{#if loadingExplanation}
			<div class="loading-dots">
				<span class="dot"></span><span class="dot"></span><span class="dot"></span>
			</div>
			{:else if explanation}
				<div class="help-content">{explanation}</div>
			{/if}
		</div>
</div>

<!-- Quiz modal -->
{#if quizOpen}
	<div class="quiz-modal">
		<div
			class="quiz-card"
			bind:this={quizCardEl}
			role="dialog"
			aria-modal="true"
			aria-labelledby="quiz-dialog-title"
			tabindex="-1"
		>
			<div class="quiz-head">
				<div>
					<div class="quiz-kicker">Quiz</div>
					<div class="quiz-ep" id="quiz-dialog-title">{data.episode.title}</div>
				</div>
				<button type="button" class="drawer-close" onclick={() => quizOpen = false} aria-label="Close quiz"><X size={18} /></button>
			</div>
			<div class="quiz-progress-bar">
				<div class="quiz-progress-fill" style="width: {quizFinished ? 100 : quizProgress}%"></div>
			</div>
			<div class="quiz-body">
				{#if quizLoading}
					<div class="quiz-empty">
						<svg class="quiz-spinner" viewBox="0 0 24 24" fill="none" aria-label="Generating quiz…">
							<circle cx="12" cy="12" r="9" stroke="var(--border)" stroke-width="2"/>
							<path d="M12 3 a9 9 0 0 1 9 9" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
						</svg>
						<p>Generating quiz…</p>
					</div>
				{:else if questions.length === 0}
					<div class="quiz-empty"><p>Not enough data for a quiz yet.</p></div>
				{:else if quizFinished}
					<div class="quiz-results">
						<h3>Quiz complete</h3>
						<div class="quiz-score-big">{quizScore}<span class="quiz-total">/{questions.length}</span></div>
						<p class="quiz-msg">
							{#if quizScore === questions.length}Perfect! You really get it!
							{:else if quizScore >= questions.length * 0.7}Great work — you're getting the hang of it!
							{:else}Keep studying! Watch the clip again and try once more.{/if}
						</p>
						<div class="quiz-result-rows">
							{#each answers as a, i}
								<div class="result-row">
									<span class="result-mark" class:ok={a.ok} class:no={!a.ok}>{a.ok ? '✓' : '✕'}</span>
									<span class="result-q">Q{i+1} · {a.q}</span>
								</div>
							{/each}
							</div>
							<div class="quiz-result-actions">
								<button type="button" class="quiz-btn ghost" onclick={openQuiz}>Try again</button>
								<button type="button" class="quiz-btn" onclick={() => quizOpen = false}>Back to clip</button>
							</div>
						</div>
					{:else}
					<div class="q-meta">
						<span class="q-type">{questions[currentQ].type}</span>
						<span class="q-num">Q{currentQ + 1}/{questions.length}</span>
						<span class="q-score">{quizScore} correct</span>
					</div>
					<h3 class="q-question">{questions[currentQ].question}</h3>
					{#if questions[currentQ].context}
						<p class="q-context">{questions[currentQ].context}</p>
					{/if}
					<div class="q-options">
						{#each questions[currentQ].options as opt, i}
								<button
									type="button"
									class="q-opt"
									class:correct={answered && i === questions[currentQ].correct}
									class:wrong={answered && selectedAnswer === i && i !== questions[currentQ].correct}
								class:disabled={answered}
								onclick={() => pickOption(i)}
								disabled={answered}
							>
								<span class="q-letter">{['A','B','C','D'][i]}</span>
								<span>{opt}</span>
							</button>
						{/each}
					</div>
					{#if answered}
						<div class="q-feedback" class:miss={selectedAnswer !== questions[currentQ].correct}>
							<span class="q-feedback-tag">{selectedAnswer === questions[currentQ].correct ? 'Correct!' : 'Not quite.'}</span>
						</div>
					{/if}
				{/if}
			</div>
			{#if !quizLoading && !quizFinished && questions.length > 0}
					<div class="quiz-foot">
						<span class="quiz-hint"><kbd>1</kbd>–<kbd>4</kbd> answer · <kbd>Esc</kbd> close</span>
						<button type="button" class="quiz-btn" disabled={!answered} onclick={nextQuestion}>
							{currentQ + 1 >= questions.length ? 'See results' : 'Next'}
						</button>
					</div>
			{/if}
		</div>
	</div>
{/if}

<WordPopup episodeTitle={data.episode.title} episodeId={data.episode.id} />

<style>
	.study-view {
		height: 100vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	header {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px 24px;
		height: 64px;
		background: var(--bg-card);
		border-bottom: 1px solid var(--border);
		position: relative;
		z-index: 5;
		flex-shrink: 0;
		user-select: none;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12.5px;
		color: var(--text-muted);
		white-space: nowrap;
		transition: color 0.12s;
	}
	.back:hover { color: var(--text); text-decoration: none; }
	.divider { width: 1px; height: 20px; background: var(--border); flex-shrink: 0; }
	h1 {
		flex: 1;
		font-size: 15px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		letter-spacing: -0.01em;
		color: var(--text);
		user-select: none;
	}
	.top-actions { display: flex; align-items: center; gap: 8px; }
		.icon-btn {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 9px 14px;
			border: 1px solid var(--border);
			border-radius: var(--radius-sm);
			background: var(--bg-card);
			font-size: 13px;
			color: var(--text-muted);
			transition: border-color 0.15s, color 0.15s, background-color 0.15s, opacity 0.15s;
			white-space: nowrap;
		}
	.icon-btn:hover { border-color: var(--text-light); color: var(--text); }
	.icon-btn.saved { color: var(--green); border-color: var(--green); }
	.icon-btn.primary { background: var(--accent); border-color: var(--accent); color: white; }
	.icon-btn.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
	.icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.count { color: var(--text-light); font-weight: 500; margin-left: 2px; }

	.stage {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		background: var(--bg);
		display: flex;
		flex-direction: column;
		/* Vertically center the content when it's shorter than the viewport —
		 * turns the dead space below the video into symmetric padding above
		 * and below. On small screens there's not enough room to center so
		 * this naturally falls back to top-aligned. */
		justify-content: center;
	}

	/* Centered single-column layout that scales fluidly across screen
	 * sizes. max-width grows with the viewport up to 1100px on wide
	 * monitors so the video isn't a tiny island in a sea of whitespace;
	 * on mobile it fills the screen with compact padding.
	 * Horizontal padding uses clamp() so margins feel right at any width
	 * without adding breakpoints. */
	.stage-inner {
		width: 100%;
		max-width: clamp(600px, 78vw, 1280px);
		margin: 0 auto;
		padding: clamp(16px, 2.4vw, 32px) clamp(16px, 3vw, 32px) clamp(24px, 3vw, 48px);
		display: flex;
		flex-direction: column;
		gap: clamp(12px, 1.5vw, 20px);
	}

	/* Below 600px the clamp() min would force overflow, so drop back to
	 * full-width on phones. */
	@media (max-width: 600px) {
		.stage-inner {
			max-width: 100%;
		}
	}

	.video-shell {
		border-radius: var(--radius-sm);
		overflow: hidden;
		border: 1px solid var(--border);
	}
	.video-shell :global(video),
	.video-shell :global(iframe) { width: 100%; display: block; }

	.processing-panel {
		aspect-ratio: 16 / 9;
		width: 100%;
		background: var(--bg-card);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 28px 32px;
		gap: 16px;
	}
	.processing-panel.error {
		background: color-mix(in srgb, var(--red) 6%, var(--bg-card));
	}
	.processing-spinner {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 3px solid var(--border);
		border-top-color: var(--accent);
		animation: spin 0.85s linear infinite;
	}
	.processing-kicker {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.processing-panel.error .processing-kicker {
		color: var(--red);
	}
	.processing-title {
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text);
		margin: 0;
	}
	.processing-meta {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: baseline;
		gap: 12px;
		color: var(--text-light);
		font-size: 13px;
	}
	.processing-meta-item {
		display: inline-flex;
		align-items: baseline;
		gap: 6px;
	}
	.processing-meta-label {
		font-size: 11px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-light);
	}
	.processing-meta strong {
		color: var(--text);
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		font-size: 15px;
	}
	.processing-meta-dot {
		color: var(--text-light);
		opacity: 0.5;
	}
	.processing-sub {
		font-size: 13px;
		color: var(--text-muted);
		max-width: 46ch;
		margin: 0;
		line-height: 1.6;
	}
	.processing-actions {
		display: flex;
		gap: 14px;
		align-items: center;
	}
	.retry-btn {
		padding: 9px 18px;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s, opacity 0.15s;
	}
	.retry-btn:hover:not(:disabled) { background: var(--accent-hover); }
	.retry-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.retry-link {
		font-size: 13px;
		color: var(--text-muted);
		text-decoration: none;
	}
	.retry-link:hover { color: var(--text); }

	.paused-slot {
		/* Reserve a fixed-ish height regardless of whether a caption is showing,
		 * so the video doesn't jump up/down when the user plays/pauses. The
		 * clamp gives a sensible range from phone to big monitor. */
		height: clamp(88px, 9vh, 140px);
		margin-top: 4px;
		display: flex;
		align-items: flex-start;
	}
	.paused-line {
		width: 100%;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius-sm);
		padding: clamp(14px, 1.6vw, 22px) clamp(18px, 2vw, 28px);
		animation: fadeSlideIn 0.18s ease-out;
	}
	@keyframes fadeSlideIn {
		from { opacity: 0; transform: translateY(-4px); }
		to   { opacity: 1; transform: translateY(0); }
	}
	.paused-text {
		font-size: clamp(17px, 1.5vw, 22px);
		line-height: 1.6;
		color: var(--text);
		margin: 0;
		font-family: var(--font-body);
		user-select: text;
		cursor: text;
		letter-spacing: -0.005em;
	}

		/* Backdrop */
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: color-mix(in srgb, var(--bg) 40%, transparent);
		backdrop-filter: blur(8px);
		animation: fadeIn 0.2s ease;
	}
	@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

	/* Drawer */
	.drawer {
		position: fixed;
		top: 0; right: 0;
		height: 100vh;
		width: min(440px, 92vw);
		background: var(--bg-card);
		display: flex;
		flex-direction: column;
		z-index: 60;
		transform: translateX(100%);
		transition: transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
		border-left: 1px solid var(--border);
	}
		.drawer.open { transform: translateX(0); }
		.drawer:focus-visible,
		.quiz-card:focus-visible {
			outline: 2px solid var(--accent);
			outline-offset: -2px;
		}
		.drawer-head { padding: 18px 22px 14px; border-bottom: 1px solid var(--border); }
	.drawer-head-row { display: flex; align-items: center; gap: 10px; }
	.drawer-head h2 { font-size: 20px; font-weight: 600; flex: 1; letter-spacing: -0.01em; }
	.drawer-count { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-light); font-weight: 500; }
	.drawer-close {
		width: 32px; height: 32px;
		border-radius: var(--radius-sm);
		color: var(--text-light);
		display: flex; align-items: center; justify-content: center;
		transition: background 0.12s, color 0.12s;
	}
	.drawer-close:hover { background: var(--bg-dark); color: var(--text); }
	.drawer-body { flex: 1; overflow-y: auto; padding: 6px 10px 20px; }
	.drawer-empty { padding: 40px 20px; text-align: center; color: var(--text-muted); font-size: 14px; }
	.drawer-foot { padding: 12px 22px; border-top: 1px solid var(--border); background: var(--bg-dark); }
	.drawer-foot-link { font-size: 13px; color: var(--accent); font-weight: 500; }
	.drawer-foot-link:hover { text-decoration: underline; }

	.nb-entry { padding: 14px 12px; border-bottom: 1px solid var(--border-light); }
	.nb-entry:last-child { border-bottom: none; }
	.nb-entry-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
	.nb-word { font-size: 15px; font-weight: 600; color: var(--text); }
	.nb-cat {
		font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase;
		padding: 2px 7px; border-radius: var(--radius-xs); font-weight: 600;
		background: var(--bg-dark); color: var(--text-muted);
		border: 1px solid var(--border);
	}
	.nb-def { font-size: 13.5px; color: var(--text-muted); line-height: 1.55; }
	.nb-ex { font-size: 13px; color: var(--text-muted); font-style: italic; margin-top: 4px; }

	.help-ctx {
		background: var(--bg-dark);
		border-left: 3px solid var(--accent);
		border-radius: 0 8px 8px 0;
		padding: 12px 14px;
		margin: 14px 10px 18px;
	}
	.help-quote { font-size: 15px; line-height: 1.5; color: var(--text); font-style: italic; margin: 0; }
	.help-content { padding: 0 12px; font-size: 14px; line-height: 1.7; color: var(--text); white-space: pre-line; }

	.loading-dots { display: flex; justify-content: center; gap: 6px; padding: 30px; }
	.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: bounce 1.2s ease-in-out infinite; }
	.dot:nth-child(2) { animation-delay: 0.15s; }
	.dot:nth-child(3) { animation-delay: 0.3s; }
	@keyframes bounce {
		0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
		40% { transform: scale(1); opacity: 1; }
	}

	/* Quiz modal */
	.quiz-modal {
		position: fixed; inset: 0; z-index: 60;
		display: flex; align-items: center; justify-content: center;
		padding: 24px;
		animation: fadeIn 0.2s ease;
	}
	.quiz-card {
		width: min(620px, 100%);
		max-height: min(720px, 90vh);
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		display: flex; flex-direction: column; overflow: hidden;
		animation: scaleIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	@keyframes scaleIn {
		from { transform: scale(0.96) translateY(8px); opacity: 0; }
		to { transform: scale(1) translateY(0); opacity: 1; }
	}
	.quiz-head {
		padding: 16px 22px;
		display: flex; align-items: center; gap: 14px;
		border-bottom: 1px solid var(--border);
	}
	.quiz-head > div:first-child { flex: 1; overflow: hidden; }
	.quiz-kicker { font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
	.quiz-ep { font-size: 12.5px; color: var(--text-light); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.quiz-progress-bar { height: 3px; background: var(--border-light); }
	.quiz-progress-fill { height: 100%; background: var(--accent); transition: width 0.3s ease; }
	.quiz-body { flex: 1; overflow-y: auto; padding: 24px 28px 16px; }
	.q-meta { display: flex; align-items: center; gap: 10px; font-size: 11.5px; color: var(--text-light); margin-bottom: 14px; }
		.q-type {
			padding: 3px 9px; border-radius: 20px;
			background: color-mix(in srgb, var(--accent) 12%, var(--bg-card));
			color: var(--accent);
			font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px;
		}
	.q-score { color: var(--green); font-weight: 500; }
	.q-question { font-size: 22px; font-weight: 600; line-height: 1.25; letter-spacing: -0.015em; margin-bottom: 8px; color: var(--text); }
	.q-context { font-size: 13.5px; color: var(--text-muted); font-style: italic; margin-bottom: 20px; padding-left: 10px; border-left: 2px solid var(--border); }
	.q-options { display: grid; gap: 8px; }
		.q-opt {
			display: flex; align-items: center; gap: 12px;
			padding: 13px 16px;
			background: var(--bg-dark);
			border: 1px solid var(--border);
			border-radius: var(--radius-sm);
			font-size: 14px; text-align: left; color: var(--text);
			transition: border-color 0.15s, background-color 0.15s, color 0.15s;
			width: 100%;
		}
		.q-opt:hover:not(.disabled) {
			border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
			background: color-mix(in srgb, var(--accent) 6%, var(--bg-card));
		}
	.q-opt.correct { border-color: var(--green); background: color-mix(in srgb, var(--green) 10%, var(--bg-dark)); }
	.q-opt.wrong { border-color: var(--red); background: color-mix(in srgb, var(--red) 8%, var(--bg-dark)); }
	.q-opt.disabled { cursor: default; }
	.q-letter {
		width: 24px; height: 24px; border-radius: var(--radius-xs);
		background: var(--bg-subtle); color: var(--text-muted);
		border: 1px solid var(--border);
		display: flex; align-items: center; justify-content: center;
		font-size: 11px; font-weight: 600; flex-shrink: 0;
	}
	.q-opt.correct .q-letter { background: var(--green); color: white; border-color: var(--green); }
	.q-opt.wrong .q-letter { background: var(--red); color: white; border-color: var(--red); }
	.q-feedback {
		margin-top: 14px; padding: 12px 14px;
		background: color-mix(in srgb, var(--green) 10%, var(--bg-dark));
		border: 1px solid color-mix(in srgb, var(--green) 30%, var(--border));
		border-radius: var(--radius-sm); font-size: 13.5px;
	}
	.q-feedback.miss {
		background: color-mix(in srgb, var(--red) 8%, var(--bg-dark));
		border-color: color-mix(in srgb, var(--red) 25%, var(--border));
	}
	.q-feedback-tag { font-weight: 600; color: var(--green); }
	.q-feedback.miss .q-feedback-tag { color: var(--red); }
	.quiz-foot {
		padding: 12px 22px; border-top: 1px solid var(--border);
		display: flex; align-items: center; gap: 10px; background: var(--bg-dark);
	}
	.quiz-hint { font-size: 12px; color: var(--text-light); }
	.quiz-hint kbd {
		padding: 2px 6px; background: var(--bg-card);
		border: 1px solid var(--border); border-radius: 4px;
		font-size: 10.5px; color: var(--text-muted);
	}
	.quiz-btn {
		padding: 8px 18px; border-radius: var(--radius-sm);
		background: var(--accent); color: white;
		font-size: 13px; font-weight: 600; border: none;
		transition: background 0.15s; margin-left: auto;
	}
	.quiz-btn:hover:not(:disabled) { background: var(--accent-hover); }
	.quiz-btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.quiz-btn.ghost {
		background: transparent; color: var(--text-muted);
		border: 1px solid var(--border); margin-left: 0;
	}
	.quiz-btn.ghost:hover { background: var(--bg-card); color: var(--text); }

	.quiz-results { text-align: center; padding: 8px 0; }
	.quiz-results h3 { font-size: 22px; font-weight: 500; margin-bottom: 8px; }
	.quiz-score-big { font-size: 72px; font-weight: 700; color: var(--accent); line-height: 1; margin: 16px 0 8px; letter-spacing: -0.04em; }
	.quiz-total { color: var(--text-light); font-size: 42px; margin-left: 4px; }
	.quiz-msg { color: var(--text-muted); font-size: 14.5px; margin-bottom: 20px; }
	.quiz-result-rows { text-align: left; border-top: 1px solid var(--border); padding-top: 14px; margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
	.result-row { display: flex; gap: 10px; align-items: center; font-size: 13.5px; color: var(--text-muted); }
	.result-mark { width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; color: white; flex-shrink: 0; }
	.result-mark.ok { background: var(--green); }
	.result-mark.no { background: var(--red); }
	.result-q { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
	.quiz-result-actions { display: flex; gap: 10px; justify-content: center; margin-top: 20px; }
	.quiz-empty { text-align: center; padding: 40px 20px; color: var(--text-muted); display: flex; flex-direction: column; align-items: center; gap: 12px; }
	.quiz-spinner { width: 28px; height: 28px; animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

		@media (max-width: 768px) {
			header { padding: 10px 14px; gap: 10px; }
			h1 { font-size: 13px; }
			.icon-btn { padding: 6px 10px; font-size: 12px; }
			.stage-inner { padding: 12px 14px 30px; }
			.paused-slot { min-height: 118px; }
			.quiz-body { padding: 16px 18px; }
			.q-question { font-size: 18px; }
		}
	</style>
