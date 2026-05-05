<script lang="ts">
	import type { Segment, HumorAnnotation } from '$lib/types';
	import { currentTime } from '$lib/stores/player';
	import TranscriptLine from './TranscriptLine.svelte';
	import { tick, onMount } from 'svelte';

	let {
		segments = [],
		annotations = [],
		onseek,
		onexplain
	}: {
		segments?: Segment[];
		annotations?: HumorAnnotation[];
		onseek?: (time: number) => void;
		onexplain?: (id: number) => void;
	} = $props();

	let container: HTMLDivElement | undefined = $state();
	let showCoachMark = $state(false);

	onMount(() => {
		if (!localStorage.getItem('clip-coach-seen') && segments.length > 0) {
			showCoachMark = true;
			setTimeout(() => {
				showCoachMark = false;
				localStorage.setItem('clip-coach-seen', '1');
			}, 5000);
		}
	});
	let activeIndex = $state(-1);
	let followPlayback = $state(true);
	let internalScroll = false;
	let scrollResetTimer: ReturnType<typeof setTimeout> | null = null;

	const annotationMap = $derived(
		annotations.reduce((map, ann) => {
			const list = map.get(ann.segment_id) || [];
			list.push(ann);
			map.set(ann.segment_id, list);
			return map;
		}, new Map<number, HumorAnnotation[]>())
	);

	$effect(() => {
		const time = $currentTime;
		const idx = segments.findIndex((s, i) => {
			const next = segments[i + 1];
			const end = next ? Math.min(s.end_time + 0.35, next.start_time) : s.end_time + 0.35;
			return time >= s.start_time && time < end;
		});
		if (idx !== activeIndex) {
			activeIndex = idx;
			if (idx >= 0 && followPlayback) {
				scrollToActive();
			}
		}
	});

	function handleScroll() {
		if (internalScroll) return;
		followPlayback = false;
	}

	function handleSeek(time: number) {
		followPlayback = true;
		onseek?.(time);
	}

	function resumeFollowing() {
		followPlayback = true;
		scrollToActive();
	}

	async function scrollToActive() {
		await tick();
		if (!container) return;
		const el = container.querySelector('.line.active') as HTMLElement | null;
		if (!el) return;
		internalScroll = true;
		if (scrollResetTimer) clearTimeout(scrollResetTimer);
		// Scroll active line to the top of the panel so previous lines don't distract
		el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		scrollResetTimer = setTimeout(() => {
			internalScroll = false;
		}, 400);
	}
</script>

<div class="transcript-wrap">
	{#if showCoachMark}
		<button type="button" class="coach-mark" onclick={() => { showCoachMark = false; localStorage.setItem('clip-coach-seen', '1'); }}>
			Tap any word for its definition
		</button>
	{/if}
	<div class="transcript" bind:this={container} onscroll={handleScroll}>
		{#each segments as segment, i}
			<TranscriptLine
				text={segment.text}
				startTime={segment.start_time}
				active={i === activeIndex}
				dimmed={activeIndex >= 0 && i > activeIndex}
				annotations={annotationMap.get(segment.id) || []}
				segmentId={segment.id}
				onseek={handleSeek}
				onexplain={onexplain}
			/>
		{/each}
	</div>

	{#if !followPlayback}
		<button type="button" class="follow-btn" onclick={resumeFollowing}>
			Follow Live
		</button>
	{/if}
</div>

<style>
	.transcript-wrap {
		position: relative;
		height: 100%;
	}

	.transcript {
		overflow-y: auto;
		height: 100%;
	}

	.follow-btn {
		position: absolute;
		right: 12px;
		bottom: 12px;
		padding: 7px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--bg-card);
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 500;
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		transition: border-color 0.12s, color 0.12s;
	}

	.follow-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.coach-mark {
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
		padding: 8px 16px;
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		animation: coachFade 5s ease forwards;
		box-shadow: 0 4px 16px rgba(32, 184, 205, 0.3);
	}
	@keyframes coachFade {
		0%, 70% { opacity: 1; }
		100% { opacity: 0; }
	}
</style>
