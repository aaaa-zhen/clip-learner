<script lang="ts">
	import { X, Loader2, CheckCircle2, Eye, EyeOff } from 'lucide-svelte';

	let { open = $bindable(false) } = $props();

	let apiKey = $state('');
	let baseUrl = $state('https://aihubmix.com');
	let model = $state('gpt-5.4-nano');
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
</style>
