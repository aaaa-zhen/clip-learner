<script lang="ts">
	import { X, Volume2, Play, Check } from 'lucide-svelte';
	import { playPronunciation } from '$lib/utils/tts';
	import { reviewGuestWord } from '$lib/utils/guestVocab';
	import { isDue, intervalLabel, type Grade } from '$lib/utils/srs';
	import type { VocabEntry } from '$lib/types';

	type Entry = VocabEntry & { episode_title?: string | null };

	let {
		open = $bindable(false),
		entries = [],
		variant = 'modal',
		isGuest = false,
		title = 'Review',
		onClose,
		onSeek
	}: {
		open?: boolean;
		entries?: Entry[];
		variant?: 'modal' | 'drawer';
		isGuest?: boolean;
		title?: string;
		onClose?: () => void;
		onSeek?: (entry: Entry) => void;
	} = $props();

	let session = $state<Entry[]>([]);
	let idx = $state(0);
	let reviewed = $state(0);
	let again = $state(0);

	const current = $derived(session[idx] as Entry | undefined);
	const finished = $derived(session.length > 0 && idx >= session.length);
	const progress = $derived(session.length ? Math.min(100, (idx / session.length) * 100 + 6) : 6);

	// Start a fresh session each time the panel opens (due cards first).
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) startSession();
		wasOpen = open;
	});

	function startSession() {
		const due = entries.filter((e) => isDue(e));
		// Due cards first; if everything is caught up, practise the whole set.
		session = due.length ? due : [...entries];
		idx = 0;
		reviewed = 0;
		again = 0;
	}

	async function record(entry: Entry, grade: Grade) {
		try {
			if (isGuest) {
				reviewGuestWord(entry.id, grade);
			} else {
				await fetch('/api/notebook/review', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: entry.id, grade })
				});
			}
		} catch {
			/* schedule update is best-effort */
		}
	}

	function grade(g: Grade) {
		const entry = current;
		if (!entry) return;
		record(entry, g);
		reviewed++;
		if (g === 0) again++;
		idx++;
	}

	function say() {
		if (current) playPronunciation(current.word).catch(() => {});
	}

	function playClip() {
		if (current && onSeek) onSeek(current);
	}

	function close() {
		open = false;
		onClose?.();
	}

	function restart() {
		startSession();
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') close();
		else if (!finished) {
			if (e.key === '1') grade(0);
			else if (e.key === '2') grade(1);
		}
	}
</script>

<svelte:window on:keydown={onKeydown} />

<div class="rv-backdrop" class:on={open} onclick={close} aria-hidden="true"></div>

<div
	class="rv-panel {variant}"
	class:on={open}
	role="dialog"
	aria-modal="true"
	aria-label="Word review"
	inert={!open}
>
	<div class="rv-head">
		<h2>{title}</h2>
		{#if !finished}<span class="rv-count">{Math.min(idx + 1, session.length)} / {session.length}</span>{/if}
		<span class="rv-sp"></span>
		<button class="rv-x" onclick={close} aria-label="Close review"><X size={18} /></button>
	</div>
	<div class="rv-prog"><i style="width:{finished ? 100 : progress}%"></i></div>

	{#if !finished && current}
		<div class="rv-stage">
			{#key idx}
			<div class="rv-card">
				<div class="rv-top">
					{#if current.category}<span class="rv-tag">{current.category}</span>{/if}
					<div class="rv-word">{current.word}</div>
					{#if current.phonetic}<div class="rv-phon">{current.phonetic}</div>{/if}
				</div>
				<div class="rv-ans">
					{#if current.definition}<p class="rv-def">{current.definition}</p>{/if}
					{#if current.example}<p class="rv-ex">{current.example}</p>{/if}
					<div class="rv-meta">
						{#if current.episode_id}
							<button class="rv-pill" onclick={playClip}>
								<Play size={14} aria-hidden="true" />
								{onSeek ? 'Play clip' : 'Open clip'}
							</button>
						{/if}
						<button class="rv-pill" onclick={say}>
							<Volume2 size={14} aria-hidden="true" /> Hear it
						</button>
					</div>
				</div>
			</div>
			{/key}
		</div>

		<div class="rv-grades">
			<button class="rv-grade again" onclick={() => grade(0)}>
				<span class="g"><X size={15} strokeWidth={2.5} aria-hidden="true" /> Forgot</span>
				<span class="t">{intervalLabel(0, current)}</span>
			</button>
			<button class="rv-grade good" onclick={() => grade(1)}>
				<span class="g"><Check size={15} strokeWidth={2.5} aria-hidden="true" /> Got it</span>
				<span class="t">{intervalLabel(1, current)}</span>
			</button>
		</div>
	{:else}
		<div class="rv-done">
			<div class="em">🎉</div>
			<h3>Review complete</h3>
			<p>
				{reviewed} card{reviewed === 1 ? '' : 's'} reviewed{#if again > 0} · {again} to relearn soon{/if}.
			</p>
			<div class="rv-done-actions">
				<button class="rv-secondary" onclick={restart}>Review again</button>
				<button class="rv-primary" onclick={close}>Done</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.rv-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.34);
		opacity: 0;
		pointer-events: none;
		transition: opacity 340ms var(--ease);
		z-index: 60;
	}
	.rv-backdrop.on {
		opacity: 1;
		pointer-events: auto;
	}

	.rv-panel {
		position: fixed;
		background: var(--bg-card);
		z-index: 70;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		--ease-soft: cubic-bezier(0.16, 1, 0.3, 1);
	}
	/* right drawer (episode page — keeps the video visible) */
	.rv-panel.drawer {
		top: 0;
		right: 0;
		height: 100vh;
		width: 420px;
		max-width: 100vw;
		box-shadow: var(--shadow-lg);
		transform: translateX(100%);
		opacity: 0.65;
		transition: transform 440ms var(--ease-soft), opacity 300ms var(--ease);
	}
	.rv-panel.drawer.on {
		transform: translateX(0);
		opacity: 1;
	}
	/* centered modal (full notebook page — nothing to keep visible) */
	.rv-panel.modal {
		top: 50%;
		left: 50%;
		width: min(480px, calc(100vw - 40px));
		height: min(620px, calc(100vh - 96px));
		border-radius: var(--radius-lg);
		box-shadow: 0 30px 80px rgba(0, 0, 0, 0.22);
		transform: translate(-50%, -46%) scale(0.98);
		opacity: 0;
		pointer-events: none;
		transition: transform 360ms var(--ease-soft), opacity 260ms var(--ease);
	}
	.rv-panel.modal.on {
		transform: translate(-50%, -50%) scale(1);
		opacity: 1;
		pointer-events: auto;
	}
	/* Each card animates in on open and on every advance (keyed by idx),
	   with a small overshoot so it feels like the next card springs in. */
	.rv-card {
		animation: rvCardIn 440ms cubic-bezier(0.22, 1.16, 0.36, 1) both;
	}
	@keyframes rvCardIn {
		from { opacity: 0; transform: translateY(22px) scale(0.97); }
		60%  { opacity: 1; }
		to   { opacity: 1; transform: none; }
	}
	@media (prefers-reduced-motion: reduce) {
		.rv-card { animation: none; }
	}

	.rv-head {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 20px 22px 14px;
	}
	.rv-head h2 {
		font-size: 17px;
		font-weight: 650;
		letter-spacing: -0.01em;
		margin: 0;
	}
	.rv-count {
		font-size: 12px;
		color: var(--gray9);
		font-weight: 550;
		font-variant-numeric: tabular-nums;
	}
	.rv-sp { flex: 1; }
	.rv-x {
		width: 30px;
		height: 30px;
		border: none;
		background: transparent;
		border-radius: 9px;
		cursor: pointer;
		color: var(--gray11);
		display: grid;
		place-items: center;
		transition: background var(--duration-fast) var(--ease);
	}
	.rv-x:hover { background: var(--gray3); }

	.rv-prog {
		height: 3px;
		background: var(--gray4);
		margin: 0 22px;
		border-radius: 3px;
		overflow: hidden;
	}
	.rv-prog > i {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width 0.35s var(--ease);
	}

	.rv-stage {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 8px 22px 0;
		min-height: 0;
	}
	.rv-card {
		flex: 1;
		margin: 18px 0;
		border: 1px solid var(--gray4);
		border-radius: var(--radius-lg);
		background: var(--bg-card);
		display: flex;
		flex-direction: column;
		justify-content: center;
		position: relative;
		overflow: auto;
		box-shadow: 0 10px 34px rgba(30, 40, 70, 0.06);
	}
	.rv-top {
		padding: 0 26px;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}
	.rv-tag {
		font-size: 10.5px;
		font-weight: 650;
		letter-spacing: 0.07em;
		color: var(--gray9);
		background: var(--gray3);
		padding: 4px 9px;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
	}
	.rv-word {
		font-size: 30px;
		font-weight: 680;
		letter-spacing: -0.02em;
		margin: 18px 0 7px;
		line-height: 1.15;
		color: var(--gray12);
	}
	.rv-phon {
		font-size: 14px;
		color: var(--gray9);
	}
	.rv-ans {
		padding: 22px 26px 24px;
		border-top: 1px dashed var(--gray4);
		margin-top: 18px;
	}
	.rv-def {
		font-size: 16px;
		line-height: 1.55;
		color: var(--gray12);
		margin: 0 0 13px;
	}
	.rv-ex {
		font-size: 14px;
		line-height: 1.6;
		color: var(--gray11);
		font-style: italic;
		margin: 0;
		padding-left: 12px;
		border-left: 3px solid var(--gray4);
	}
	.rv-meta {
		display: flex;
		gap: 6px;
		margin-top: 16px;
		margin-left: -8px;
	}
	.rv-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--gray10);
		background: transparent;
		border: none;
		border-radius: var(--radius-pill);
		padding: 5px 8px;
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease), transform var(--duration-fast);
	}
	.rv-pill:hover { background: var(--gray3); color: var(--gray12); }
	.rv-pill:active { transform: scale(0.95); }

	.rv-grades {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		padding: 0 22px 22px;
	}
	.rv-grade {
		border: 1px solid var(--gray4);
		background: var(--bg-card);
		border-radius: var(--radius-md);
		padding: 13px 6px 11px;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		transition: transform var(--duration-fast) var(--ease), box-shadow var(--duration-fast) var(--ease);
	}
	.rv-grade:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.06); }
	.rv-grade:active { transform: scale(0.98); }
	.rv-grade .g {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 15px;
		font-weight: 640;
	}
	.rv-grade .t {
		font-size: 11.5px;
		color: var(--gray9);
		font-variant-numeric: tabular-nums;
	}
	.rv-grade.again { background: hsla(0 50% 50% / 0.08); border-color: transparent; }
	.rv-grade.again .g { color: var(--red); }
	.rv-grade.good { background: hsla(145 50% 42% / 0.1); border-color: transparent; }
	.rv-grade.good .g { color: var(--green); }

	.rv-done {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 0 40px;
	}
	.rv-done .em { font-size: 44px; margin-bottom: 10px; }
	.rv-done h3 { margin: 0 0 8px; font-size: 20px; letter-spacing: -0.01em; }
	.rv-done p { color: var(--gray11); font-size: 14px; line-height: 1.6; margin: 0 0 22px; }
	.rv-done-actions { display: flex; gap: 10px; }
	.rv-primary, .rv-secondary {
		border: none;
		font: inherit;
		font-weight: 600;
		font-size: 14px;
		padding: 11px 22px;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease);
	}
	.rv-primary { background: var(--accent); color: #fff; }
	.rv-primary:hover { background: var(--accent-hover); }
	.rv-secondary { background: var(--gray3); color: var(--gray12); }
	.rv-secondary:hover { background: var(--gray4); }

	@media (max-width: 480px) {
		.rv-panel.drawer { width: 100vw; }
	}
</style>
