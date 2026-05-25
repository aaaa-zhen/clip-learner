<script lang="ts">
	import { X, Loader2, CheckCircle2, Eye, EyeOff } from 'lucide-svelte';

	let { open = $bindable(false), isGuest = false } = $props();

	let apiKey = $state('');
	let baseUrl = $state('https://aihubmix.com');
	let model = $state('gpt-5.4-mini');
	let showApiKey = $state(false);
	let saving = $state(false);
	let saved = $state(false);
	let error = $state('');
	let loaded = $state(false);

	$effect(() => {
		if (open && !loaded) {
			fetch('/api/settings').then(r => r.json()).then(data => {
				if (data.api_key) apiKey = data.api_key;
				if (data.base_url) baseUrl = data.base_url;
				if (data.model) model = data.model;
				loaded = true;
			}).catch(() => {});
		}
	});

	async function save() {
		saving = true;
		saved = false;
		error = '';
		try {
			const res = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					api_key: apiKey,
					base_url: baseUrl,
					model
				})
			});
			if (!res.ok) throw new Error('Failed to save');
			saved = true;
			setTimeout(() => { saved = false; }, 2000);
		} catch {
			error = 'Failed to save settings';
		} finally {
			saving = false;
		}
	}

	// Cookies upload (owner only)
	let cookiesFile = $state<File | null>(null);
	let cookiesSaving = $state(false);
	let cookiesSaved = $state(false);
	let cookiesError = $state('');

	async function uploadCookies() {
		if (!cookiesFile) return;
		cookiesSaving = true;
		cookiesSaved = false;
		cookiesError = '';
		try {
			const form = new FormData();
			form.append('cookies', cookiesFile);
			const res = await fetch('/api/cookies', { method: 'POST', body: form });
			const d = await res.json();
			if (!res.ok) throw new Error(d.error || 'Upload failed');
			cookiesSaved = true;
			cookiesFile = null;
			setTimeout(() => { cookiesSaved = false; }, 3000);
		} catch (e) {
			cookiesError = e instanceof Error ? e.message : 'Upload failed';
		} finally {
			cookiesSaving = false;
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="overlay" onclick={() => open = false}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h3>Settings</h3>
				<button class="close-btn" onclick={() => open = false}>
					<X size={16} />
				</button>
			</div>

				<div class="modal-body">
				{#if !isGuest}
					<div class="field">
						<label for="settings-api-key">API Key</label>
						<div class="input-wrap">
							<input
								id="settings-api-key"
								type={showApiKey ? 'text' : 'password'}
								bind:value={apiKey}
								placeholder="sk-..."
							/>
							<button type="button" class="eye-btn" onclick={() => showApiKey = !showApiKey} aria-label={showApiKey ? 'Hide key' : 'Show key'}>
								{#if showApiKey}<EyeOff size={15} />{:else}<Eye size={15} />{/if}
							</button>
						</div>
						<span class="hint">Your LLM provider API key (AIHubMix, OpenAI, etc.)</span>
					</div>

					<div class="field">
						<label for="settings-base-url">Base URL</label>
						<input
							id="settings-base-url"
							type="text"
							bind:value={baseUrl}
							placeholder="https://aihubmix.com"
						/>
						<span class="hint">API provider URL (without /v1)</span>
					</div>

					<div class="field">
						<label for="settings-model">Model</label>
						<input
							id="settings-model"
							type="text"
							bind:value={model}
							placeholder="gpt-5.4-mini"
						/>
						<span class="hint">Model name to use for analysis</span>
					</div>

					{#if error}
						<p class="error">{error}</p>
					{/if}
				{/if}
				</div>


				{#if !isGuest}
				<!-- Cookies upload -->
				<div class="settings-section">
					<h3 class="section-title">YouTube Cookies</h3>
					<p class="section-desc">Export youtube.com cookies from a logged-in browser in Netscape format, then upload the cookies.txt file here.</p>
					<div class="cookies-row">
						<label class="cookies-label">
							<input type="file" accept=".txt,text/plain" onchange={(e) => { cookiesFile = (e.target as HTMLInputElement).files?.[0] ?? null; }} style="display:none" />
							<span class="cookies-pick-btn">Choose file</span>
							<span class="cookies-filename">{cookiesFile ? cookiesFile.name : 'No file chosen'}</span>
						</label>
						<button class="save-btn cookies-upload-btn" onclick={uploadCookies} disabled={!cookiesFile || cookiesSaving}>
							{#if cookiesSaving}
								<Loader2 size={13} class="spin" /> Uploading…
							{:else if cookiesSaved}
								<CheckCircle2 size={13} /> Uploaded
							{:else}
								Upload
							{/if}
						</button>
					</div>
					{#if cookiesError}<p class="error">{cookiesError}</p>{/if}
				</div>

				<div class="modal-footer">
					<button class="cancel-btn" onclick={() => open = false}>Cancel</button>
					<button class="save-btn" onclick={save} disabled={saving}>
						{#if saving}
							<Loader2 size={14} class="spin" /> Saving…
						{:else if saved}
							<CheckCircle2 size={14} /> Saved
						{:else}
							Save
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		backdrop-filter: blur(2px);
	}

	.modal {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		width: 420px;
		max-width: calc(100vw - 32px);
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20px 24px 0;
	}

	.modal-header h3 {
		font-size: 16px;
		font-weight: 600;
		color: var(--text);
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		background: none;
		color: var(--text-light);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.close-btn:hover {
		background: var(--bg-dark);
		color: var(--text);
	}

	.modal-body {
		padding: 20px 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.field label {
		font-size: 13px;
		font-weight: 500;
		color: var(--text);
	}

	.input-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}

	.input-wrap input {
		flex: 1;
		padding-right: 36px;
	}

	.eye-btn {
		position: absolute;
		right: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		background: none;
		color: var(--text-light);
		cursor: pointer;
		border-radius: var(--radius-sm);
		min-height: auto;
		min-width: auto;
		padding: 0;
	}
	.eye-btn:hover { color: var(--text); }

	.field input {
		padding: 9px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: 14px;
		background: var(--bg);
		color: var(--text);
		outline: none;
		width: 100%;
	}
	.field input:focus {
		border-color: var(--accent);
	}

	.hint {
		font-size: 11px;
		color: var(--text-light);
	}

	.error {
		font-size: 13px;
		color: var(--red);
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 0 24px 20px;
	}

	.cancel-btn {
		padding: 8px 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-card);
		color: var(--text-muted);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}
	.cancel-btn:hover {
		border-color: var(--text-light);
		color: var(--text);
	}

	.save-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 18px;
		border: none;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: white;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.save-btn:hover:not(:disabled) {
		background: var(--accent-hover);
	}
	.save-btn:disabled {
		opacity: 0.6;
	}

	.settings-section {
		padding: 16px 24px;
		border-top: 1px solid var(--gray3);
	}
	.section-title {
		font-size: 13px;
		font-weight: 600;
		margin: 0 0 4px;
		color: var(--gray12);
	}
	.section-desc {
		font-size: 12px;
		color: var(--gray9);
		margin: 0 0 10px;
	}
	.cookies-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.cookies-label {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
	}
	.cookies-pick-btn {
		background: var(--gray3);
		border: 1px solid var(--gray5);
		border-radius: 6px;
		padding: 5px 10px;
		font-size: 12px;
		color: var(--gray12);
		white-space: nowrap;
		cursor: pointer;
	}
	.cookies-pick-btn:hover { background: var(--gray4); }
	.cookies-filename {
		font-size: 12px;
		color: var(--gray9);
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cookies-upload-btn { padding: 6px 14px; font-size: 12px; }
</style>
