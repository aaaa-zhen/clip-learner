	<script lang="ts">
		import { currentTime, isPlaying, duration, subtitleVisible } from '$lib/stores/player';
		import { formatTime } from '$lib/utils/time';
		import { clearResumePosition, loadResumePosition, saveResumePosition } from '$lib/utils/resume';
		import { Play, Pause, RotateCcw, RotateCw, ListChecks } from 'lucide-svelte';
		import { onMount } from 'svelte';

	interface Segment {
		start_time: number;
		end_time: number;
		text?: string;
	}

	let { src, segments = [] }: { src: string; segments?: Segment[] } = $props();
	let video: HTMLVideoElement | undefined = $state();
	let showControls = $state(true);
	let hideTimeout: ReturnType<typeof setTimeout>;
	let autoPause = $state(false);
		let saveTimer: ReturnType<typeof setTimeout>;
		let resumed = $state(false);
		let maxWatchedTime = $state(0);
		let rewindTimer: ReturnType<typeof setTimeout> | null = null;
		let rewindSubtitle = $state(false); // show subtitle after rewind for 3s

	// Extract video ID from src for storage key
	const videoId = $derived(src.match(/\/media\/([^/]+)\//)?.[1] || '');

	// Save position periodically
		$effect(() => {
			if (!videoId || $currentTime < 1) return;
			clearTimeout(saveTimer);
			saveTimer = setTimeout(() => {
				saveResumePosition(videoId, $currentTime);
			}, 2000);
		});

	const currentSegmentIndex = $derived.by(() => {
		if (segments.length === 0) return -1;
		for (let i = 0; i < segments.length; i++) {
			if ($currentTime >= segments[i].start_time && $currentTime < segments[i].end_time) {
				return i;
			}
		}
		// If past last segment or between segments, find the nearest preceding one
		for (let i = segments.length - 1; i >= 0; i--) {
			if ($currentTime >= segments[i].start_time) return i;
		}
		return -1;
	});

		const activeSegment = $derived(currentSegmentIndex >= 0 ? segments[currentSegmentIndex] : null);
		const showSubtitles = $derived(
			!!activeSegment?.text && (rewindSubtitle || $subtitleVisible)
		);

	function handleTimeUpdate() {
		if (!video) return;
		const prevTime = $currentTime;
		$currentTime = video.currentTime;
		if (video.currentTime > maxWatchedTime) {
			maxWatchedTime = video.currentTime;
		}

		// Auto-pause: check if we just crossed a segment's end_time
		if (autoPause && segments.length > 0 && $isPlaying) {
			for (const seg of segments) {
				if (prevTime < seg.end_time && video.currentTime >= seg.end_time) {
					video.pause();
					// Snap to exactly the end_time so we don't drift
					video.currentTime = seg.end_time;
					break;
				}
			}
		}
	}

		function handleLoadedMetadata() {
			if (!video) return;
			$duration = video.duration;

			// Resume from last position
			if (!resumed && videoId) {
				const pos = loadResumePosition(videoId);
				if (pos && pos > 5 && pos < video.duration - 5) {
					video.currentTime = pos;
					maxWatchedTime = pos;
				}
				resumed = true;
			}
		}

		function handlePlay() { $isPlaying = true; }
		function handlePause() {
			$isPlaying = false;
			if (videoId && video) {
				saveResumePosition(videoId, video.currentTime);
			}
		}
		function handleEnded() {
			$isPlaying = false;
			if (videoId) {
				clearResumePosition(videoId);
			}
		}

		export function seekTo(time: number) {
			if (video) {
				video.currentTime = time;
				if (videoId) saveResumePosition(videoId, time);
			}
		}

	function togglePlay() {
		if (video) {
			if (video.paused) video.play();
			else video.pause();
		}
	}

		function skip(seconds: number) {
			if (!video) return;
			video.currentTime = Math.max(0, video.currentTime + seconds);
			if (videoId) saveResumePosition(videoId, video.currentTime);
			if (seconds < 0) triggerRewindSubtitle();
		}

	function triggerRewindSubtitle() {
		rewindSubtitle = true;
		if (rewindTimer) clearTimeout(rewindTimer);
		rewindTimer = setTimeout(() => { rewindSubtitle = false; }, 3500);
	}

		function replayCurrentSegment() {
			if (!video || segments.length === 0) return;
			const idx = currentSegmentIndex;
			if (idx >= 0) {
				video.currentTime = segments[idx].start_time;
				if (videoId) saveResumePosition(videoId, video.currentTime);
				video.play();
			}
		}

		function jumpToPreviousSegment() {
			if (!video || segments.length === 0) return;
			const idx = currentSegmentIndex;
			const target = idx > 0 ? idx - 1 : 0;
			video.currentTime = segments[target].start_time;
			if (videoId) saveResumePosition(videoId, video.currentTime);
			video.play();
		}

	function jumpToNextSegment() {
		if (!video || segments.length === 0) return;
		const idx = currentSegmentIndex;
		if (idx >= 0 && idx < segments.length - 1) {
			video.currentTime = segments[idx + 1].start_time;
			video.play();
		}
	}

	function toggleAutoPause() {
		autoPause = !autoPause;
	}

	function handleMouseMove() {
		showControls = true;
		clearTimeout(hideTimeout);
		if ($isPlaying) {
			hideTimeout = setTimeout(() => { showControls = false; }, 2500);
		}
	}

	function handleMouseLeave() {
		if ($isPlaying) {
			hideTimeout = setTimeout(() => { showControls = false; }, 1000);
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		// Don't intercept when word popup or modal is open
		if (document.querySelector('.popup-content, .drawer.open, .quiz-modal')) return;
		if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
		if (e.code === 'ArrowLeft') { e.preventDefault(); skip(-5); }
		if (e.code === 'ArrowRight') { e.preventDefault(); skip(5); }
		if (e.key === 's' || e.key === 'S') { e.preventDefault(); replayCurrentSegment(); }
		if (e.key === 'a' || e.key === 'A') { e.preventDefault(); jumpToPreviousSegment(); }
		if (e.key === 'd' || e.key === 'D') { e.preventDefault(); jumpToNextSegment(); }
	}

		function handleProgressClick(e: MouseEvent) {
			if (!video) return;
			const bar = e.currentTarget as HTMLElement;
			const rect = bar.getBoundingClientRect();
			const pct = (e.clientX - rect.left) / rect.width;
			video.currentTime = pct * video.duration;
			if (videoId) saveResumePosition(videoId, video.currentTime);
		}

	const progress = $derived($duration > 0 ? ($currentTime / $duration) * 100 : 0);

		onMount(() => {
			const onOpen = () => { if (video && !video.paused) video.pause(); };
			const onClose = () => { if (video && video.paused) video.play(); };
			const persistResume = () => {
				if (!video || !videoId) return;
				if (video.duration && video.currentTime >= video.duration - 5) {
					clearResumePosition(videoId);
					return;
				}
				saveResumePosition(videoId, video.currentTime);
			};
			window.addEventListener('wordpopup:open', onOpen);
			window.addEventListener('wordpopup:close', onClose);
			window.addEventListener('pagehide', persistResume);
			window.addEventListener('beforeunload', persistResume);
			return () => {
				window.removeEventListener('wordpopup:open', onOpen);
				window.removeEventListener('wordpopup:close', onClose);
				window.removeEventListener('pagehide', persistResume);
				window.removeEventListener('beforeunload', persistResume);
				persistResume();
			};
		});
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="player"
	onmousemove={handleMouseMove}
	onmouseleave={handleMouseLeave}
	role="region"
	aria-label="Video player"
>
	<video
		bind:this={video}
		{src}
		ontimeupdate={handleTimeUpdate}
			onloadedmetadata={handleLoadedMetadata}
			onplay={handlePlay}
			onpause={handlePause}
			onended={handleEnded}
			onclick={togglePlay}
			preload="metadata"
		>
		<track kind="captions" />
	</video>

	{#if showSubtitles && activeSegment?.text}
		<div class="smart-captions" aria-live="polite">
			<p>{activeSegment.text}</p>
		</div>
	{/if}

	<!-- Overlay controls -->
	<div class="overlay" class:visible={showControls || !$isPlaying}>
		<div class="center-controls">
			<button class="circle-btn small" onclick={() => skip(-5)} title="Back 5s">
				<RotateCcw size={20} strokeWidth={2.5} />
				<span class="skip-label">5</span>
			</button>

			<button class="circle-btn large" onclick={togglePlay} title={$isPlaying ? 'Pause' : 'Play'}>
				{#if $isPlaying}
					<Pause size={32} strokeWidth={2.5} fill="currentColor" />
				{:else}
					<Play size={32} strokeWidth={2.5} fill="currentColor" style="margin-left: 3px" />
				{/if}
			</button>

			<button class="circle-btn small" onclick={() => skip(5)} title="Forward 5s">
				<RotateCw size={20} strokeWidth={2.5} />
				<span class="skip-label">5</span>
			</button>
		</div>

		<!-- Bottom bar -->
		<div class="bottom-bar">
			<button
				type="button"
				class="progress-bar"
				onclick={handleProgressClick}
				aria-label="Seek through video"
			>
				<span class="progress-fill" style="width: {progress}%"></span>
			</button>
			<div class="time-row">
				<span class="time">{formatTime($currentTime)}</span>
				<div class="bottom-actions"></div>
				<span class="time">{formatTime($duration)}</span>
			</div>
		</div>
	</div>
</div>

<style>
		.player {
		width: 100%;
		overflow: hidden;
		position: relative;
		background: #000;
		cursor: pointer;
		border-radius: inherit;
	}

	video {
		width: 100%;
		display: block;
	}

	.smart-captions {
		position: absolute;
		left: 50%;
		bottom: 56px;
		transform: translateX(-50%);
		width: min(86%, 760px);
		display: flex;
		justify-content: center;
		pointer-events: none;
		z-index: 2;
	}

	.smart-captions {
		animation: captionIn 0.2s ease-out;
	}

	@keyframes captionIn {
		from { opacity: 0; transform: translateX(-50%) translateY(4px); }
		to { opacity: 1; transform: translateX(-50%) translateY(0); }
	}

	.smart-captions p {
		margin: 0;
		padding: 10px 14px;
		border-radius: 10px;
		background: rgba(0, 0, 0, 0.82);
		color: white;
		font-family: var(--font-ui);
		font-size: 18px;
		font-weight: 600;
		line-height: 1.45;
		text-align: center;
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
	}

	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		background: rgba(0, 0, 0, 0.15);
		opacity: 0;
		transition: opacity 0.3s ease;
		pointer-events: none;
	}

	.overlay.visible {
		opacity: 1;
		pointer-events: auto;
	}

	.center-controls {
		display: flex;
		align-items: center;
		gap: 28px;
	}

	.circle-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		border: none;
		cursor: pointer;
		color: white;
		transition: transform 0.15s, background 0.15s;
		position: relative;
	}

	.circle-btn:hover {
		transform: scale(1.1);
	}

	.circle-btn:active {
		transform: scale(0.95);
	}

	.circle-btn.large {
		width: 68px;
		height: 68px;
		background: rgba(255, 255, 255, 0.15);
		backdrop-filter: blur(16px) saturate(180%);
		-webkit-backdrop-filter: blur(16px) saturate(180%);
		border: 1.5px solid rgba(255, 255, 255, 0.3);
	}

	.circle-btn.small {
		width: 46px;
		height: 46px;
		background: rgba(255, 255, 255, 0.1);
		backdrop-filter: blur(12px) saturate(160%);
		-webkit-backdrop-filter: blur(12px) saturate(160%);
		border: 1px solid rgba(255, 255, 255, 0.2);
	}

	.skip-label {
		position: absolute;
		font-family: var(--font-ui);
		font-size: 9px;
		font-weight: 700;
		color: white;
		pointer-events: none;
	}

	/* Bottom bar */
	.bottom-bar {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 0 12px 8px;
	}

	.progress-bar {
		width: 100%;
		height: 4px;
		background: rgba(255, 255, 255, 0.25);
		border: none;
		padding: 0;
		display: block;
		border-radius: 2px;
		cursor: pointer;
		transition: height 0.15s;
	}

	.progress-bar:focus-visible {
		outline: 2px solid white;
		outline-offset: 2px;
	}

	.progress-bar:hover {
		height: 6px;
	}

	.progress-fill {
		display: block;
		height: 100%;
		background: var(--accent);
		border-radius: 2px;
		transition: width 0.1s linear;
	}

	.time-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding-top: 4px;
	}

	.time {
		font-family: var(--font-ui);
		font-size: 12px;
		color: rgba(255, 255, 255, 0.8);
		font-variant-numeric: tabular-nums;
	}

	.bottom-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.auto-pause-btn {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: none;
		background: rgba(255, 255, 255, 0.15);
		color: rgba(255, 255, 255, 0.7);
		cursor: pointer;
		transition: background 0.15s, color 0.15s, transform 0.15s;
	}

	.auto-pause-btn:hover {
		background: rgba(255, 255, 255, 0.25);
		color: white;
		transform: scale(1.05);
	}

	.auto-pause-btn:active {
		transform: scale(0.95);
	}

	.auto-pause-btn.active {
		background: var(--accent);
		color: white;
	}

	.auto-pause-btn.active:hover {
		background: var(--accent-hover);
	}

	.auto-pause-badge {
		position: absolute;
		top: -2px;
		right: -2px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #22c55e;
		border: 1.5px solid black;
	}

	@media (max-width: 768px) {
		.center-controls {
			gap: 20px;
		}

		.auto-pause-btn {
			width: 36px;
			height: 36px;
		}

		.progress-bar {
			height: 6px;
		}

		.smart-captions {
			bottom: 62px;
			width: calc(100% - 24px);
		}

		.smart-captions p {
			font-size: 15px;
			padding: 8px 12px;
		}
	}
</style>
