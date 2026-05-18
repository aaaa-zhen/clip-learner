<script lang="ts">
	import { goto } from '$app/navigation';
	import { FFmpeg } from '@ffmpeg/ffmpeg';
	import { fetchFile, toBlobURL } from '@ffmpeg/util';
	import { Upload, Loader2, Film, AlertCircle, X } from 'lucide-svelte';

	interface Props {
		onclose?: () => void;
	}
	let { onclose }: Props = $props();

	let fileInput: HTMLInputElement | undefined = $state();
	let stage = $state<'idle' | 'extracting' | 'uploading' | 'done' | 'error'>('idle');
	let progress = $state(0); // 0–100
	let statusText = $state('');
	let errorMsg = $state('');
	let ffmpegLoaded = $state(false);
	let ffmpeg: FFmpeg | null = null;

	async function loadFFmpeg() {
		if (ffmpegLoaded) return;
		statusText = 'Loading audio extractor…';
		const f = new FFmpeg();
		const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
		await f.load({
			coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
			wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
		});
		ffmpeg = f;
		ffmpegLoaded = true;
	}

	async function handleFile(file: File) {
		if (!file) return;
		errorMsg = '';
		stage = 'extracting';
		progress = 0;
		statusText = 'Loading audio extractor…';

		try {
			await loadFFmpeg();
			if (!ffmpeg) throw new Error('FFmpeg failed to load');

			statusText = 'Extracting audio…';
			const inputName = 'input' + file.name.slice(file.name.lastIndexOf('.'));
			ffmpeg.on('progress', ({ progress: p }) => {
				progress = Math.round(Math.min(p, 1) * 60); // extraction = first 60%
				statusText = `Extracting audio… ${progress}%`;
			});

			await ffmpeg.writeFile(inputName, await fetchFile(file));
			await ffmpeg.exec([
				'-i', inputName,
				'-vn',           // strip video
				'-ac', '1',      // mono
				'-ar', '16000',  // 16kHz — optimal for Whisper
				'-b:a', '48k',
				'output.mp3'
			]);

			const data = await ffmpeg.readFile('output.mp3');
			await ffmpeg.deleteFile(inputName).catch(() => {});
			await ffmpeg.deleteFile('output.mp3').catch(() => {});

			const audioBlob = new Blob([data], { type: 'audio/mpeg' });
			const title = file.name.replace(/\.[^.]+$/, '');

			stage = 'uploading';
			progress = 60;
			statusText = 'Uploading audio to server…';

			const form = new FormData();
			form.append('audio', audioBlob, 'audio.mp3');
			form.append('title', title);

			const xhr = new XMLHttpRequest();
			xhr.upload.addEventListener('progress', (e) => {
				if (e.lengthComputable) {
					progress = 60 + Math.round((e.loaded / e.total) * 35);
					statusText = `Uploading… ${progress}%`;
				}
			});

			const res = await new Promise<Response>((resolve, reject) => {
				xhr.onload = () =>
					resolve(new Response(xhr.responseText, { status: xhr.status }));
				xhr.onerror = () => reject(new Error('Network error'));
				xhr.open('POST', '/api/upload-audio');
				xhr.send(form);
			});

			const d = JSON.parse(await res.text());
			if (!res.ok || d.error) throw new Error(d.error || 'Upload failed');

			progress = 100;
			stage = 'done';
			await goto(`/episode/${d.id}`);
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Something went wrong';
			stage = 'error';
		}
	}

	function onFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) handleFile(file);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		const file = e.dataTransfer?.files?.[0];
		if (file) handleFile(file);
	}
</script>

<div class="local-upload" role="dialog" aria-modal="true" aria-label="Upload local video">
	<div class="modal-header">
		<span class="modal-title">
			<Film size={16} aria-hidden="true" />
			Upload local video
		</span>
		{#if onclose}
			<button class="close-btn" onclick={onclose} aria-label="Close">
				<X size={16} />
			</button>
		{/if}
	</div>

	{#if stage === 'idle' || stage === 'error'}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="dropzone"
			class:has-error={stage === 'error'}
			ondragover={(e) => e.preventDefault()}
			ondrop={onDrop}
			onclick={() => fileInput?.click()}
			onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
			role="button"
			tabindex="0"
			aria-label="Click or drag a video file here"
		>
			<Upload size={28} aria-hidden="true" class="upload-icon" />
			<p class="drop-hint">Click or drag a video file here</p>
			<p class="drop-sub">MP4, MKV, MOV, AVI, WebM — audio only is sent to the server</p>
			<input
				bind:this={fileInput}
				type="file"
				accept="video/*,audio/*"
				onchange={onFileChange}
				style="display:none"
			/>
		</div>
		{#if errorMsg}
			<p class="error-msg" role="alert">
				<AlertCircle size={14} aria-hidden="true" />
				{errorMsg}
			</p>
		{/if}
	{:else}
		<div class="progress-area">
			<Loader2 size={24} aria-hidden="true" class="spin" />
			<p class="status-text">{statusText}</p>
			<div class="progress-bar-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
				<div class="progress-bar-fill" style="width:{progress}%"></div>
			</div>
			<p class="progress-pct">{progress}%</p>
		</div>
	{/if}
</div>

<style>
	.local-upload {
		background: var(--bg-card, #1a1a1a);
		border: 1px solid var(--border, #333);
		border-radius: 12px;
		padding: 0;
		overflow: hidden;
		width: 100%;
		max-width: 480px;
	}
	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 18px;
		border-bottom: 1px solid var(--border, #333);
		font-size: 0.9rem;
		font-weight: 600;
	}
	.modal-title {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text, #eee);
	}
	.close-btn {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-muted, #888);
		padding: 2px;
		line-height: 0;
	}
	.close-btn:hover { color: var(--text, #eee); }

	.dropzone {
		margin: 18px;
		border: 2px dashed var(--border, #444);
		border-radius: 10px;
		padding: 36px 24px;
		text-align: center;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.dropzone:hover, .dropzone:focus {
		border-color: var(--accent, #6b8aff);
		background: var(--bg-hover, rgba(107,138,255,0.05));
		outline: none;
	}
	.dropzone.has-error { border-color: #e05; }
	:global(.upload-icon) { color: var(--text-muted, #888); margin-bottom: 10px; }
	.drop-hint {
		margin: 0 0 6px;
		font-weight: 500;
		color: var(--text, #eee);
	}
	.drop-sub {
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-muted, #888);
	}
	.error-msg {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 18px 18px;
		color: #e05;
		font-size: 0.82rem;
	}
	.progress-area {
		padding: 32px 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.status-text {
		margin: 0;
		font-size: 0.88rem;
		color: var(--text-muted, #aaa);
	}
	.progress-bar-track {
		width: 100%;
		height: 6px;
		background: var(--border, #333);
		border-radius: 3px;
		overflow: hidden;
	}
	.progress-bar-fill {
		height: 100%;
		background: var(--accent, #6b8aff);
		border-radius: 3px;
		transition: width 0.3s ease;
	}
	.progress-pct {
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-muted, #888);
	}
</style>
