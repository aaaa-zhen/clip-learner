	<script lang="ts">
		import { currentTime, isPlaying, duration } from '$lib/stores/player';
		import { clearResumePosition, loadResumePosition, saveResumePosition } from '$lib/utils/resume';
		import { formatTime } from '$lib/utils/time';
		import { onMount } from 'svelte';

	interface Segment {
		start_time: number;
		end_time: number;
		text?: string;
	}

	let { videoId, segments = [] }: { videoId: string; segments?: Segment[] } = $props();

	let player: any = $state(null);
	let container: HTMLDivElement | undefined = $state();
		let autoPause = $state(false);
		let timeInterval: ReturnType<typeof setInterval>;
		let maxWatchedTime = $state(0);
		let pendingResumeTime = $state<number | null>(null);
		let resumeApplied = $state(false);

	// Current segment index — used by A/S/D keyboard jumping. The dedicated
	// paused-line panel in +page.svelte computes its own pausedSegment from
	// the same store, so this component no longer needs an activeSegment.
	const currentSegmentIndex = $derived.by(() => {
		if (segments.length === 0) return -1;
		for (let i = 0; i < segments.length; i++) {
			if ($currentTime >= segments[i].start_time && $currentTime < segments[i].end_time) {
				return i;
			}
		}
		for (let i = segments.length - 1; i >= 0; i--) {
			if ($currentTime >= segments[i].start_time) return i;
		}
		return -1;
	});

		function applyResumePosition() {
			if (!player?.seekTo || resumeApplied || pendingResumeTime == null || pendingResumeTime <= 5) return;
			player.seekTo(pendingResumeTime, true);
			maxWatchedTime = pendingResumeTime;
			resumeApplied = true;
		}

		onMount(() => {
			// Load YouTube IFrame API
			if (!(window as any).YT) {
				const tag = document.createElement('script');
			tag.src = 'https://www.youtube.com/iframe_api';
			document.head.appendChild(tag);
		}

		function initPlayer() {
			player = new (window as any).YT.Player(container, {
				videoId,
				playerVars: {
					autoplay: 0,
					controls: 1,
					modestbranding: 1,
					rel: 0,
					cc_load_policy: 0
				},
				events: {
					onReady: onPlayerReady,
					onStateChange: onPlayerStateChange
				}
			});
		}

		if ((window as any).YT && (window as any).YT.Player) {
			initPlayer();
		} else {
			(window as any).onYouTubeIframeAPIReady = initPlayer;
			}

			const onOpen = () => player?.pauseVideo?.();
			const onClose = () => player?.playVideo?.();
			const persistResume = () => {
				const time = player?.getCurrentTime?.() ?? 0;
				const total = player?.getDuration?.() ?? 0;
				if (total && time >= total - 5) {
					clearResumePosition(videoId);
					return;
				}
				saveResumePosition(videoId, time);
			};
			window.addEventListener('wordpopup:open', onOpen);
			window.addEventListener('wordpopup:close', onClose);
			window.addEventListener('pagehide', persistResume);
			window.addEventListener('beforeunload', persistResume);

			return () => {
				clearInterval(timeInterval);
				if (player?.destroy) player.destroy();
				window.removeEventListener('wordpopup:open', onOpen);
				window.removeEventListener('wordpopup:close', onClose);
				window.removeEventListener('pagehide', persistResume);
				window.removeEventListener('beforeunload', persistResume);
				persistResume();
			};
		});

		function onPlayerReady() {
			$duration = player.getDuration();
			pendingResumeTime = loadResumePosition(videoId);
			setTimeout(() => {
				applyResumePosition();
			}, 250);

			// Poll current time
			timeInterval = setInterval(() => {
			if (!player?.getCurrentTime) return;

			const prevTime = $currentTime;
			$currentTime = player.getCurrentTime();
			if ($currentTime > maxWatchedTime) {
				maxWatchedTime = $currentTime;
			}

			// Auto-pause logic
			if (autoPause && $isPlaying && segments.length > 0) {
				for (const seg of segments) {
					if (prevTime < seg.end_time && $currentTime >= seg.end_time) {
						player.pauseVideo();
						player.seekTo(seg.end_time, true);
						break;
					}
				}
			}

				// Save position
				if ($currentTime > 1) {
					saveResumePosition(videoId, $currentTime);
				}
			}, 250);
		}

		function onPlayerStateChange(event: any) {
			const YT = (window as any).YT;
			$isPlaying = event.data === YT.PlayerState.PLAYING;
			if ((event.data === YT.PlayerState.CUED || event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED) && !resumeApplied) {
				applyResumePosition();
			}
			if (event.data === YT.PlayerState.PLAYING) {
				$duration = player.getDuration();
			}
			if (event.data === YT.PlayerState.PAUSED) {
				saveResumePosition(videoId, player?.getCurrentTime?.() ?? 0);
			}
			if (event.data === YT.PlayerState.ENDED) {
				clearResumePosition(videoId);
			}
		}

		export function seekTo(time: number) {
			if (player?.seekTo) {
				player.seekTo(time, true);
				saveResumePosition(videoId, time);
			}
		}

		function replayCurrentSegment() {
			if (segments.length === 0) return;
			const idx = currentSegmentIndex;
			if (idx >= 0) {
				const time = segments[idx].start_time;
				player?.seekTo(time, true);
				saveResumePosition(videoId, time);
				player?.playVideo();
			}
		}

		function jumpToPreviousSegment() {
			if (segments.length === 0) return;
			const idx = currentSegmentIndex;
			const target = idx > 0 ? idx - 1 : 0;
			const time = segments[target].start_time;
			player?.seekTo(time, true);
			saveResumePosition(videoId, time);
			player?.playVideo();
		}

	function jumpToNextSegment() {
		if (segments.length === 0) return;
		const idx = currentSegmentIndex;
		if (idx >= 0 && idx < segments.length - 1) {
			player?.seekTo(segments[idx + 1].start_time, true);
			player?.playVideo();
		}
	}

		function skip(seconds: number) {
			if (!player?.seekTo) return;
			const current = player.getCurrentTime?.() ?? 0;
			const nextTime = Math.max(0, current + seconds);
			player.seekTo(nextTime, true);
			saveResumePosition(videoId, nextTime);
		}

	function togglePlay() {
		if (!player) return;
		if ($isPlaying) player.pauseVideo();
		else player.playVideo();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
		if (e.key === 's' || e.key === 'S') { e.preventDefault(); replayCurrentSegment(); }
		if (e.key === 'a' || e.key === 'A') { e.preventDefault(); jumpToPreviousSegment(); }
		if (e.key === 'd' || e.key === 'D') { e.preventDefault(); jumpToNextSegment(); }
		if (e.code === 'ArrowLeft') { e.preventDefault(); skip(-5); }
		if (e.code === 'ArrowRight') { e.preventDefault(); skip(5); }
	}
</script>

<svelte:window onkeydown={handleKeydown} />

	<div class="yt-player">
		<div class="yt-embed-wrap">
			<div bind:this={container}></div>
			<!-- The in-video caption overlay was removed because the dedicated
			     paused-line panel below the video now serves the same purpose
			     without overlapping the picture. -->
	</div>
	<div class="yt-bar">
		<span class="yt-time">{formatTime($currentTime)} / {formatTime($duration)}</span>
		<div class="yt-controls">
			<button
				class="yt-btn"
				class:active={autoPause}
				onclick={() => autoPause = !autoPause}
				title={autoPause ? 'Auto-pause ON' : 'Auto-pause OFF'}
			>
				{autoPause ? 'Auto-pause ON' : 'Auto-pause'}
			</button>
		</div>
		<div class="yt-shortcuts">
			<span class="shortcut-hint">A prev</span>
			<span class="shortcut-hint">S replay</span>
			<span class="shortcut-hint">D next</span>
		</div>
	</div>
</div>

<style>
		.yt-player {
			width: 100%;
			overflow: hidden;
			border-radius: inherit;
		}

	.yt-embed-wrap {
		width: 100%;
		aspect-ratio: 16 / 9;
		position: relative;
	}

	.yt-embed-wrap :global(iframe) {
		width: 100%;
		height: 100%;
		display: block;
	}

	.yt-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 14px;
		background: var(--bg-card);
		border-top: 1px solid var(--border);
		gap: 12px;
	}

	.yt-time {
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	.yt-controls {
		display: flex;
		gap: 8px;
	}

	.yt-btn {
		background: var(--bg-dark);
		color: var(--text-muted);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 4px 12px;
		font-family: var(--font-ui);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		min-height: auto;
		min-width: auto;
	}

	.yt-btn:hover {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}

	.yt-btn.active {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}

	.yt-shortcuts {
		display: flex;
		gap: 8px;
	}

	.shortcut-hint {
		font-family: var(--font-ui);
		font-size: 11px;
		color: var(--text-light);
		background: var(--bg-dark);
		padding: 2px 6px;
		border-radius: 4px;
	}

	@media (max-width: 768px) {
		.yt-shortcuts {
			display: none;
		}

		.yt-bar {
			padding: 6px 10px;
		}

	}
</style>
