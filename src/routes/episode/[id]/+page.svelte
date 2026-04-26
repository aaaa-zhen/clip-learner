<script lang="ts">
	import YouTubePlayer from '$lib/components/YouTubePlayer.svelte';
	import VideoPlayer from '$lib/components/VideoPlayer.svelte';
	import WordPopup from '$lib/components/WordPopup.svelte';
	import Transcript from '$lib/components/Transcript.svelte';
	import AnalysisPanel from '$lib/components/AnalysisPanel.svelte';

	import { invalidateAll } from '$app/navigation';
	import { onDestroy, onMount, tick } from 'svelte';
	import { isPlaying, currentTime } from '$lib/stores/player';
	import { loadResumePosition } from '$lib/utils/resume';
	import { Download, BookOpen, HelpCircle, X, ArrowLeft, CheckCircle, Volume2 } from 'lucide-svelte';

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

	// Analysis panel state
	let analysisTab = $state<'explanation' | 'scenes' | 'vocab'>('explanation');
	let focusSegmentId = $state<number | null>(null);

	// Study mode: 'listening' shows only paused line, 'transcript' shows full panels
	let showTranscript = $state(false);

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
	// Always tracks the current segment (used for caption bar)
	const activeSegment = $derived.by(() => {
		const t = $currentTime;
		for (let i = data.segments.length - 1; i >= 0; i--) {
			if (t >= data.segments[i].start_time) return data.segments[i];
		}
		return data.segments[0] ?? null;
	});

	// Keep pausedSegment as alias so nothing else breaks
	const pausedSegment = $derived($isPlaying ? null : activeSegment);

	// Caption phrase highlighting
	interface HighlightSpan { text: string; type: 'collocation' | 'phrasal_verb'; }
	let captionSpans = $state<HighlightSpan[]>([]);
	let highlightingSegmentId = $state<number | null>(null);

	$effect(() => {
		// Only highlight when paused and segment exists
		if ($isPlaying || !activeSegment) {
			captionSpans = [];
			return;
		}
		const seg = activeSegment;
		if (seg.id === highlightingSegmentId) return; // already fetched for this segment
		highlightingSegmentId = seg.id;
		captionSpans = [];
		fetch('/api/highlight', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: seg.text })
		}).then(r => r.ok ? r.json() : { spans: [] })
		  .then(d => { if (seg.id === highlightingSegmentId) captionSpans = d.spans || []; })
		  .catch(() => {});
	});

	// Build annotated caption parts: plain text chunks interleaved with highlight spans
	type CaptionPart = { text: string; span?: HighlightSpan };
	const captionParts = $derived.by((): CaptionPart[] => {
		const text = activeSegment?.text ?? '';
		if (!captionSpans.length) return [{ text }];

		// Sort spans by position in text, deduplicate overlaps
		const sorted = [...captionSpans]
			.map(s => ({ ...s, idx: text.indexOf(s.text) }))
			.filter(s => s.idx >= 0)
			.sort((a, b) => a.idx - b.idx);

		const parts: CaptionPart[] = [];
		let cursor = 0;
		for (const span of sorted) {
			if (span.idx < cursor) continue; // overlap, skip
			if (span.idx > cursor) parts.push({ text: text.slice(cursor, span.idx) });
			parts.push({ text: span.text, span });
			cursor = span.idx + span.text.length;
		}
		if (cursor < text.length) parts.push({ text: text.slice(cursor) });
		return parts;
	});

	// Adaptive quiz state — two-phase tutor.
	// Flow: openQuiz() fetches 3 initial questions → user answers all 3 →
	// loadAdaptivePhase() fetches 2 follow-ups tailored to weaknesses → user
	// answers those → loadDiagnosis() fetches the final breakdown.
	interface Question {
		type: string;
		category: string;
		question: string;
		options: string[];
		correct: number;
		context?: string;
		sourceWord?: string;
	}
	interface QuizAnswerRecord {
		questionIndex: number;
		selected: number;
		correct: boolean;
	}
	interface Diagnosis {
		score: number;
		total: number;
		comprehension: 'excellent' | 'good' | 'fair' | 'needs-work';
		byCategory: { category: string; correct: number; total: number }[];
		summary: string;
		strengths: string[];
		weaknesses: string[];
		recommendations: string[];
	}
	type QuizPhase =
		| 'idle'
		| 'loading_initial'
		| 'initial'
		| 'loading_adaptive'
		| 'adaptive'
		| 'loading_diagnosis'
		| 'diagnosed';

	let quizPhase = $state<QuizPhase>('idle');
	let questions = $state<Question[]>([]);
	let answerRecords = $state<QuizAnswerRecord[]>([]);
	let currentQ = $state(0);
	let selectedAnswer = $state(-1);
	let answered = $state(false);
	let diagnosis = $state<Diagnosis | null>(null);

	// Derived helpers
	const quizLoading = $derived(
		quizPhase === 'loading_initial' ||
			quizPhase === 'loading_adaptive' ||
			quizPhase === 'loading_diagnosis'
	);
	const quizFinished = $derived(quizPhase === 'diagnosed');
	const quizScore = $derived(answerRecords.filter((a) => a.correct).length);
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

	let localNotebook = $state<Array<{word: string; definition: string; example?: string; category?: string}>>([]);

	$effect(() => {
		localNotebook = data.notebookEntries ? [...data.notebookEntries] : [];
	});

	const savedWordSet = $derived(new Set(localNotebook.map(e => e.word.toLowerCase())));

	$effect(() => {
		const onSaved = (e: Event) => {
			wordsSaved++;
			const detail = (e as CustomEvent).detail;
			if (detail?.word) {
				localNotebook = [{ word: detail.word, definition: detail.definition, example: detail.example, category: detail.category }, ...localNotebook];
			}
		};
		window.addEventListener('word:saved', onSaved);
		return () => window.removeEventListener('word:saved', onSaved);
	});

	const backdropVisible = $derived(notebookOpen || quizOpen || lineHelpOpen);

	let drawerTtsLoading = $state<string | null>(null);
	let drawerTtsAudio: HTMLAudioElement | null = null;

	async function playDrawerTTS(word: string) {
		if (drawerTtsLoading) return;
		drawerTtsLoading = word;
		try {
			const res = await fetch('/api/tts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: word })
			});
			if (!res.ok) return;
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			if (drawerTtsAudio) { drawerTtsAudio.pause(); URL.revokeObjectURL(drawerTtsAudio.src); }
			drawerTtsAudio = new Audio(url);
			drawerTtsAudio.play();
			drawerTtsAudio.onended = () => URL.revokeObjectURL(url);
		} catch {
			// silently fail
		} finally {
			drawerTtsLoading = null;
		}
	}

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
		currentQ = 0;
		selectedAnswer = -1;
		answered = false;
		answerRecords = [];
		questions = [];
		diagnosis = null;
		quizPhase = 'loading_initial';
		quizOpen = true;
		try {
			const res = await fetch('/api/quiz', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ episodeId: data.episode.id, phase: 'initial' })
			});
			const result = await res.json();
			const initial: Question[] = Array.isArray(result.questions) ? result.questions : [];
			if (initial.length === 0) {
				quizPhase = 'idle';
				return;
			}
			questions = initial;
			quizPhase = 'initial';
		} catch {
			questions = [];
			quizPhase = 'idle';
		}
	}

	async function loadAdaptivePhase() {
		quizPhase = 'loading_adaptive';
		try {
			const res = await fetch('/api/quiz', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					episodeId: data.episode.id,
					phase: 'adaptive',
					previousQuestions: questions,
					previousAnswers: answerRecords
				})
			});
			const result = await res.json();
			const followUps: Question[] = Array.isArray(result.questions) ? result.questions : [];
			if (followUps.length === 0) {
				// No adaptive follow-ups — go straight to diagnosis.
				await loadDiagnosis();
				return;
			}
			questions = [...questions, ...followUps];
			currentQ = questions.length - followUps.length;
			selectedAnswer = -1;
			answered = false;
			quizPhase = 'adaptive';
		} catch {
			// On failure, still let the user see their partial results.
			await loadDiagnosis();
		}
	}

	async function loadDiagnosis() {
		quizPhase = 'loading_diagnosis';
		try {
			const res = await fetch('/api/quiz', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					episodeId: data.episode.id,
					phase: 'diagnose',
					questions,
					answers: answerRecords
				})
			});
			const result = await res.json();
			diagnosis = result.diagnosis || null;
		} catch {
			diagnosis = null;
		}
		quizPhase = 'diagnosed';
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

	const pipelineSteps = [
		{ key: 'fetching_audio', label: 'Audio', icon: '🎵' },
		{ key: 'transcribing', label: 'Transcribe', icon: '📝' },
		{ key: 'analyzing', label: 'Analyze', icon: '🧠' }
	] as const;

	const currentStepIndex = $derived.by(() => {
		const s = progressStage || episodeStatus;
		if (s === 'fetching_audio' || s === 'downloading') return 0;
		if (s === 'transcribing') return 1;
		if (s === 'analyzing') return 2;
		return 0; // queued/pending
	});

	const progressPercent = $derived.by(() => {
		if (!progressEstimate || progressEstimate <= 0) return 0;
		return Math.min(95, Math.round((progressElapsed / progressEstimate) * 100));
	});

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
		// Update analysis panel to show this segment's explanation
		focusSegmentId = segmentId;
		analysisTab = 'explanation';
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
		answered = true;
		selectedAnswer = i;
		const q = questions[currentQ];
		const ok = i === q.correct;
		answerRecords = [...answerRecords, { questionIndex: currentQ, selected: i, correct: ok }];
	}

	async function nextQuestion() {
		// Last question in the current batch?
		const isLastInBatch = currentQ + 1 >= questions.length;

		if (!isLastInBatch) {
			currentQ++;
			selectedAnswer = -1;
			answered = false;
			return;
		}

		// End of initial batch (3 questions) → fetch adaptive follow-ups.
		if (quizPhase === 'initial') {
			await loadAdaptivePhase();
			return;
		}
		// End of adaptive batch → diagnose.
		if (quizPhase === 'adaptive') {
			await loadDiagnosis();
			return;
		}
	}

	// Progress bar fills based on completed questions, with a small bump
	// during the transition between batches so it doesn't appear stuck.
	const quizProgress = $derived.by(() => {
		if (quizPhase === 'diagnosed') return 100;
		// Assume a target of 5 questions across both batches.
		const target = 8;
		const completed = answerRecords.length;
		return Math.min(100, (completed / target) * 100);
	});

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
				{#if isReady}
					<div class="content-card">
						<div class="video-shell">
							{#if hasLocalVideo}
								<VideoPlayer bind:this={videoPlayer} src={videoPath} segments={data.segments} />
							{:else}
								<YouTubePlayer
									bind:this={videoPlayer}
									videoId={data.episode.video_id || data.episode.id}
									segments={data.segments}
								/>
							{/if}
						</div>
						<div class="caption-bar" class:dim={$isPlaying && !showTranscript}>
							<div class="caption-text">
								{#if activeSegment && (showTranscript || !$isPlaying)}
									<p class="paused-text">{#each captionParts as part}{#if part.span}<span class="hl hl-{part.span.type}" title={part.span.type === 'phrasal_verb' ? 'Phrasal verb' : 'Collocation'}>{part.text}</span>{:else}{part.text}{/if}{/each}</p>
								{:else if $isPlaying && !showTranscript}
									<p class="paused-text hint">Space to pause</p>
								{/if}
							</div>
							{#if data.segments.length > 0}
								<button
									type="button"
									class="transcript-toggle"
									class:active={showTranscript}
									onclick={() => showTranscript = !showTranscript}
								>
									{showTranscript ? 'Off' : 'Show'}
								</button>
							{/if}
						</div>
					</div>
				{:else if isErrored}
					<div class="video-shell">
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
					</div>
				{:else}
					<div class="video-shell">
						<div class="processing-panel">
							<div class="proc-header">
								<div class="proc-stage-label">{stageLabel(progressStage, episodeStatus)}</div>
								{#if videoDurationSec}
									<span class="proc-video-len">{formatDuration(videoDurationSec)} video</span>
								{/if}
							</div>

							<div class="proc-steps">
								{#each pipelineSteps as step, i}
									<div
										class="proc-step"
										class:done={i < currentStepIndex}
										class:active={i === currentStepIndex}
										class:pending={i > currentStepIndex}
									>
										<div class="proc-step-icon">
											{#if i < currentStepIndex}
												<svg viewBox="0 0 16 16" fill="none" class="proc-check"><path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
											{:else if i === currentStepIndex}
												<div class="proc-step-pulse"></div>
											{:else}
												<div class="proc-step-dot"></div>
											{/if}
										</div>
										<span class="proc-step-text">{step.label}</span>
									</div>
									{#if i < pipelineSteps.length - 1}
										<div class="proc-connector" class:filled={i < currentStepIndex}></div>
									{/if}
								{/each}
							</div>

							<div class="proc-bar-track">
								<div class="proc-bar-fill" style="width: {progressPercent}%"></div>
							</div>

							<div class="proc-stats">
								<div class="proc-stat">
									<span class="proc-stat-val">{formatDuration(progressElapsed)}</span>
									<span class="proc-stat-key">elapsed</span>
								</div>
								{#if progressEstimate}
									<div class="proc-stat">
										<span class="proc-stat-val">~{formatDuration(progressEstimate)}</span>
										<span class="proc-stat-key">estimated</span>
									</div>
								{/if}
							</div>

							<p class="proc-hint">
								Runs in the background — feel free to leave this tab.
							</p>
						</div>
					</div>
				{/if}
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
		{#if !localNotebook.length}
			<div class="drawer-empty"><p>Save words while studying to see them here.</p></div>
		{:else}
			{#each localNotebook as entry}
				<div class="nb-entry">
					<div class="nb-entry-head">
						<strong class="nb-word">{entry.word}</strong>
						<span class="nb-cat">{entry.category}</span>
						<button
							class="nb-tts"
							class:loading={drawerTtsLoading === entry.word}
							onclick={() => playDrawerTTS(entry.word)}
							aria-label="Listen to {entry.word}"
							title="Listen"
						>
							<Volume2 size={12} strokeWidth={2} />
						</button>
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
						<svg class="quiz-spinner" viewBox="0 0 24 24" fill="none" aria-label="Loading…">
							<circle cx="12" cy="12" r="9" stroke="var(--border)" stroke-width="2"/>
							<path d="M12 3 a9 9 0 0 1 9 9" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
						</svg>
						<p>
							{#if quizPhase === 'loading_initial'}Warming up the tutor…
							{:else if quizPhase === 'loading_adaptive'}Looking at your weak spots and asking a couple more…
							{:else if quizPhase === 'loading_diagnosis'}Grading and writing your feedback…
							{/if}
						</p>
					</div>
				{:else if questions.length === 0}
					<div class="quiz-empty"><p>Not enough data for a quiz yet.</p></div>
				{:else if quizFinished}
					<div class="quiz-results">
						<h3>Quiz complete</h3>
						{#if diagnosis}
							<div class="quiz-score-big">{diagnosis.score}<span class="quiz-total">/{diagnosis.total}</span></div>
							<div class="quiz-comprehension" class:good={diagnosis.comprehension === 'good'} class:excellent={diagnosis.comprehension === 'excellent'} class:fair={diagnosis.comprehension === 'fair'} class:needs-work={diagnosis.comprehension === 'needs-work'}>
								Comprehension · <strong>{diagnosis.comprehension.replace('-', ' ')}</strong>
							</div>
							<p class="quiz-msg">{diagnosis.summary}</p>

							{#if diagnosis.byCategory.length > 0}
								<div class="category-grid">
									{#each diagnosis.byCategory as cat}
										<div class="category-row">
											<span class="category-name">{cat.category}</span>
											<div class="category-bar">
												<div
													class="category-fill"
													class:perfect={cat.correct === cat.total}
													class:partial={cat.correct > 0 && cat.correct < cat.total}
													class:zero={cat.correct === 0}
													style="width: {cat.total > 0 ? (cat.correct / cat.total) * 100 : 0}%"
												></div>
											</div>
											<span class="category-score">{cat.correct}/{cat.total}</span>
										</div>
									{/each}
								</div>
							{/if}

							{#if diagnosis.strengths.length > 0}
								<div class="diag-block">
									<div class="diag-label">Strong on</div>
									<ul class="diag-list">
										{#each diagnosis.strengths as s}<li>{s}</li>{/each}
									</ul>
								</div>
							{/if}
							{#if diagnosis.weaknesses.length > 0}
								<div class="diag-block">
									<div class="diag-label">Revisit</div>
									<ul class="diag-list">
										{#each diagnosis.weaknesses as w}<li>{w}</li>{/each}
									</ul>
								</div>
							{/if}
							{#if diagnosis.recommendations.length > 0}
								<div class="diag-block">
									<div class="diag-label">Next steps</div>
									<ul class="diag-list">
										{#each diagnosis.recommendations as r}<li>{r}</li>{/each}
									</ul>
								</div>
							{/if}
						{:else}
							<!-- Diagnosis failed / blocked — fall back to a simple summary. -->
							<div class="quiz-score-big">{quizScore}<span class="quiz-total">/{questions.length}</span></div>
							<p class="quiz-msg">Here's how you did — run it again for a deeper breakdown.</p>
						{/if}

						<div class="quiz-result-actions">
							<button type="button" class="quiz-btn ghost" onclick={openQuiz}>Try again</button>
							<button type="button" class="quiz-btn" onclick={() => quizOpen = false}>Back to clip</button>
						</div>
					</div>
				{:else}
					<div class="q-meta">
						<span class="q-type">{questions[currentQ].type}</span>
						<span class="q-num">Q{answerRecords.length + 1}</span>
						<span class="q-score">{quizScore} correct</span>
						{#if quizPhase === 'adaptive'}
							<span class="q-phase">Adaptive</span>
						{/if}
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
							{#if currentQ + 1 >= questions.length}
								{quizPhase === 'initial' ? 'Continue →' : 'See results'}
							{:else}
								Next
							{/if}
						</button>
					</div>
			{/if}
		</div>
	</div>
{/if}

<WordPopup episodeTitle={data.episode.title} episodeId={data.episode.id} savedWords={savedWordSet} />

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
	}

	/* Centered single-column layout that scales fluidly across screen
	 * sizes. max-width grows with the viewport up to 1100px on wide
	 * monitors so the video isn't a tiny island in a sea of whitespace;
	 * on mobile it fills the screen with compact padding.
	 * Horizontal padding uses clamp() so margins feel right at any width
	 * without adding breakpoints. */
	.stage-inner {
		width: 100%;
		max-width: clamp(600px, 90vw, 1440px);
		margin: 0 auto;
		padding: clamp(8px, 1vw, 16px) clamp(16px, 2.5vw, 28px) clamp(20px, 2.5vw, 40px);
		display: flex;
		flex-direction: column;
		gap: clamp(6px, 0.8vw, 12px);
	}

	/* Below 600px the clamp() min would force overflow, so drop back to
	 * full-width on phones. */
	@media (max-width: 600px) {
		.stage-inner {
			max-width: 100%;
		}
	}

	/* When video-shell is inside content-card (ready state), no own border/radius */
	.content-card .video-shell {
		overflow: hidden;
		flex-shrink: 0;
	}
	/* Standalone video-shell (processing/error state) */
	.video-shell {
		border-radius: var(--radius-sm);
		overflow: hidden;
		border: 1px solid var(--border);
		flex-shrink: 0;
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
		gap: 20px;
	}
	.processing-panel.error {
		background: color-mix(in srgb, var(--red) 6%, var(--bg-card));
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
	.processing-sub {
		font-size: 13px;
		color: var(--text-muted);
		max-width: 46ch;
		margin: 0;
		line-height: 1.6;
	}

	/* ---- new processing panel styles ---- */
	.proc-header {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.proc-stage-label {
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.proc-video-len {
		font-size: 11.5px;
		color: var(--text-muted);
		padding: 2px 8px;
		border: 1px solid var(--border);
		border-radius: 20px;
		font-variant-numeric: tabular-nums;
	}

	/* pipeline steps */
	.proc-steps {
		display: flex;
		align-items: center;
		gap: 0;
		width: 100%;
		max-width: 340px;
	}
	.proc-step {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.proc-step-icon {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--border);
		background: var(--bg-dark);
		transition: all 0.3s ease;
	}
	.proc-step.done .proc-step-icon {
		border-color: var(--green);
		background: color-mix(in srgb, var(--green) 15%, var(--bg-card));
	}
	.proc-step.active .proc-step-icon {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, var(--bg-card));
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 10%, transparent);
	}
	.proc-check {
		width: 16px;
		height: 16px;
		color: var(--green);
	}
	.proc-step-pulse {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
		animation: pulse 1.5s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.5; transform: scale(0.7); }
	}
	.proc-step-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--border);
	}
	.proc-step-text {
		font-size: 11px;
		font-weight: 500;
		color: var(--text-muted);
		letter-spacing: 0.02em;
		transition: color 0.3s;
	}
	.proc-step.done .proc-step-text { color: var(--green); }
	.proc-step.active .proc-step-text { color: var(--accent); font-weight: 600; }

	.proc-connector {
		flex: 1;
		height: 2px;
		background: var(--border);
		margin: 0 4px;
		margin-bottom: 24px; /* offset for the label below icon */
		transition: background 0.3s;
	}
	.proc-connector.filled { background: var(--green); }

	/* progress bar */
	.proc-bar-track {
		width: 100%;
		max-width: 340px;
		height: 4px;
		background: var(--border);
		border-radius: 999px;
		overflow: hidden;
	}
	.proc-bar-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 70%, var(--green)));
		border-radius: 999px;
		transition: width 0.6s ease;
	}

	/* stats */
	.proc-stats {
		display: flex;
		gap: 28px;
	}
	.proc-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}
	.proc-stat-val {
		font-size: 20px;
		font-weight: 700;
		color: var(--text);
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
	}
	.proc-stat-key {
		font-size: 10.5px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.proc-hint {
		font-size: 12.5px;
		color: var(--text-muted);
		margin: 0;
		opacity: 0.7;
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

	/* Content card: video + caption bar + optional transcript */
	.content-card {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-card);
		overflow: hidden;
	}
	.caption-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 20px;
		border-left: 3px solid var(--accent);
		min-height: 52px;
		transition: opacity 0.2s, min-height 0.2s;
	}
	.caption-bar.playing {
		border-left-color: var(--border);
		min-height: 44px;
		opacity: 0.5;
	}
	.caption-text {
		flex: 1;
		min-width: 0;
	}
	.paused-text {
		font-size: 19px;
		line-height: 1.6;
		color: var(--text);
		margin: 0;
		font-family: var(--font-body);
		user-select: text;
		/* Limit to 2 lines so long segments don't overwhelm */
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.paused-text.hint {
		color: var(--text-muted);
		font-size: 13px;
		font-style: italic;
	}
	/* Phrase highlights in caption */
	.hl {
		cursor: pointer;
		border-radius: 2px;
		padding-bottom: 2px;
		transition: background 0.12s;
	}
	.hl-phrasal_verb {
		border-bottom: 2px solid #7c9ef5;
		color: #a8c0ff;
	}
	.hl-phrasal_verb:hover { background: rgba(124, 158, 245, 0.15); }
	.hl-collocation {
		border-bottom: 2px solid #f5a85c;
		color: #ffc98a;
	}
	.hl-collocation:hover { background: rgba(245, 168, 92, 0.15); }
	.caption-bar.dim {
		opacity: 0.4;
		border-left-color: var(--border);
	}
	.transcript-toggle {
		padding: 5px 13px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: transparent;
		font-family: inherit;
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.15s;
		flex-shrink: 0;
	}
	.transcript-toggle:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.transcript-toggle.active {
		background: color-mix(in srgb, var(--accent) 12%, var(--bg-card));
		border-color: var(--accent);
		color: var(--accent);
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
	.nb-tts {
		display: flex; align-items: center; justify-content: center;
		width: 22px; height: 22px; border-radius: var(--radius-xs);
		background: none; border: none; color: var(--text-light);
		cursor: pointer; padding: 0; min-height: auto; min-width: auto;
		opacity: 0; transition: opacity 0.12s, color 0.12s, background 0.12s;
	}
	.nb-entry:hover .nb-tts { opacity: 1; }
	.nb-tts:hover { color: var(--accent); background: var(--accent-soft); }
	.nb-tts.loading { opacity: 0.5; cursor: default; }
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
	.quiz-score-big { font-size: 72px; font-weight: 700; color: var(--accent); line-height: 1; margin: 16px 0 4px; letter-spacing: -0.04em; }
	.quiz-total { color: var(--text-light); font-size: 42px; margin-left: 4px; }
	.quiz-comprehension {
		display: inline-block;
		font-size: 11.5px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-light);
		padding: 3px 10px;
		border-radius: 20px;
		border: 1px solid var(--border);
		background: var(--bg-dark);
		margin-bottom: 12px;
	}
	.quiz-comprehension.excellent { color: var(--green); border-color: color-mix(in srgb, var(--green) 40%, var(--border)); }
	.quiz-comprehension.good { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
	.quiz-comprehension.fair { color: var(--text-muted); }
	.quiz-comprehension.needs-work { color: var(--red); border-color: color-mix(in srgb, var(--red) 30%, var(--border)); }
	.quiz-msg { color: var(--text-muted); font-size: 14.5px; margin-bottom: 16px; max-width: 42ch; margin-left: auto; margin-right: auto; }
	.category-grid { text-align: left; border-top: 1px solid var(--border); padding-top: 14px; margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
	.category-row { display: grid; grid-template-columns: 96px 1fr 42px; align-items: center; gap: 10px; font-size: 12.5px; color: var(--text-muted); }
	.category-name { text-transform: capitalize; font-weight: 500; color: var(--text); }
	.category-bar { height: 6px; background: var(--bg-dark); border-radius: 999px; overflow: hidden; border: 1px solid var(--border); }
	.category-fill { height: 100%; transition: width 0.4s ease; }
	.category-fill.perfect { background: var(--green); }
	.category-fill.partial { background: var(--accent); }
	.category-fill.zero { background: var(--red); }
	.category-score { font-variant-numeric: tabular-nums; text-align: right; }
	.diag-block { text-align: left; margin-top: 16px; }
	.diag-label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-light); font-weight: 600; margin-bottom: 4px; }
	.diag-list { margin: 0; padding-left: 18px; font-size: 13.5px; color: var(--text); line-height: 1.55; display: flex; flex-direction: column; gap: 3px; }
	.quiz-result-actions { display: flex; gap: 10px; justify-content: center; margin-top: 20px; }
	.q-phase {
		padding: 2px 8px;
		border-radius: 20px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		background: color-mix(in srgb, var(--accent) 12%, var(--bg-card));
		color: var(--accent);
		margin-left: auto;
	}
	.quiz-empty { text-align: center; padding: 40px 20px; color: var(--text-muted); display: flex; flex-direction: column; align-items: center; gap: 12px; }
	.quiz-spinner { width: 28px; height: 28px; animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

		@media (max-width: 768px) {
			header { padding: 10px 14px; gap: 10px; }
			h1 { font-size: 13px; }
			.icon-btn { padding: 6px 10px; font-size: 12px; }
			.stage-inner { padding: 12px 14px 30px; }

			.quiz-body { padding: 16px 18px; }
			.q-question { font-size: 18px; }
		}
	</style>
