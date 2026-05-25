<script lang="ts">
	import '../app.css';
	import { authModalOpen } from '$lib/stores/auth';
	import { initTheme } from '$lib/stores/theme';
	import { exportAndClearGuestVocab } from '$lib/utils/guestVocab';
	import { onMount } from 'svelte';

	let { children, data } = $props();

	let authTab = $state<'login' | 'signup'>('login');
	let authError = $state('');
	let authLoading = $state(false);
	let authSuccess = $state('');

	// Flash message when the session expired mid-use. Fades after 5s
	// and also cleans `?signed_out=1` out of the URL so a reload doesn't
	// re-trigger the toast.
	let expiredToast = $state(false);
	onMount(() => {
		const cleanupTheme = initTheme();
		let toastTimer: ReturnType<typeof setTimeout> | null = null;
		if (data.sessionExpired) {
			expiredToast = true;
			try {
				const url = new URL(window.location.href);
				url.searchParams.delete('signed_out');
				history.replaceState(history.state, '', url.toString());
			} catch {}
			toastTimer = setTimeout(() => { expiredToast = false; }, 5000);
		}
		return () => {
			cleanupTheme();
			if (toastTimer) clearTimeout(toastTimer);
		};
	});

	async function handleAuth(e: SubmitEvent) {
		e.preventDefault();
		authError = '';
		authLoading = true;
		const form = e.target as HTMLFormElement;
		const fd = new FormData(form);
		try {
			const res = await fetch('/api/auth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: authTab,
					username: fd.get('username'),
					password: fd.get('password')
				})
			});
			const data = await res.json();
			if (data.error) {
				authError = data.error;
			} else {
				// Migrate guest localStorage vocab to the real account
				const guestWords = exportAndClearGuestVocab();
				if (guestWords.length > 0) {
					await Promise.allSettled(
						guestWords.map((w) =>
							fetch('/api/notebook', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify(w)
							})
						)
					);
				}

				if (authTab === 'signup') {
					localStorage.setItem('clip-just-signed-up', '1');
					authSuccess = 'Account created! Logging you in…';
				} else {
					authSuccess = 'Welcome back!';
				}
				setTimeout(() => window.location.reload(), 800);
			}
		} catch {
			authError = 'Network error. Please try again.';
		} finally {
			authLoading = false;
		}
	}
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
</svelte:head>

{@render children()}

{#if expiredToast}
	<div class="session-toast" role="status" aria-live="polite">
		<span>You were signed out. Please sign in again.</span>
		<button
			type="button"
			class="session-toast-close"
			onclick={() => (expiredToast = false)}
			aria-label="Dismiss"
		>×</button>
	</div>
{/if}

{#if $authModalOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="auth-overlay"
		tabindex="-1"
		onclick={(e) => { if (e.target === e.currentTarget) authModalOpen.set(false); }}
		onkeydown={(e) => { if (e.key === 'Escape') authModalOpen.set(false); }}
	>
		<div class="auth-card" inert={authLoading}>
			<button type="button" class="auth-close" onclick={() => authModalOpen.set(false)} aria-label="Close">
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
			</button>
			<div class="auth-logo">Clip Learner</div>
			<p class="auth-prompt">Sign in to sync your vocabulary and progress across devices.</p>

			<div class="auth-tabs">
				<button class="auth-tab" class:active={authTab === 'login'} onclick={() => { authTab = 'login'; authError = ''; }}>Log in</button>
				<button class="auth-tab" class:active={authTab === 'signup'} onclick={() => { authTab = 'signup'; authError = ''; }}>Sign up</button>
			</div>

			{#if authSuccess}
				<p class="auth-success">{authSuccess}</p>
			{:else}
				{#if authError}
					<p class="auth-error">{authError}</p>
				{/if}

				<form onsubmit={handleAuth}>
					<label class="auth-label">
						Username
						<input class="auth-input" type="text" name="username" required minlength={authTab === 'signup' ? 3 : 1} autocomplete="username" />
					</label>
					<label class="auth-label">
						Password
						<input class="auth-input" type="password" name="password" required minlength={authTab === 'signup' ? 8 : 1} autocomplete={authTab === 'login' ? 'current-password' : 'new-password'} />
					</label>
					<button class="auth-btn" type="submit" disabled={authLoading}>
						{authLoading ? '…' : authTab === 'login' ? 'Log in' : 'Create account'}
					</button>
				</form>
			{/if}
		</div>
	</div>
{/if}

<style>
	.auth-overlay {
		position: fixed;
		inset: 0;
		z-index: 500;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: hsla(0 0% 0% / 0.4);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		animation: fadeIn var(--duration-normal) var(--ease);
	}
	@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

	.auth-card {
		width: min(400px, 100%);
		background: var(--gray2);
		border: 1px solid var(--gray4);
		border-radius: var(--radius-lg);
		padding: 36px;
		box-shadow: var(--shadow-lg);
		animation: slideUp var(--duration-normal) var(--ease);
	}
	@keyframes slideUp {
		from { transform: translateY(8px); opacity: 0; }
		to   { transform: translateY(0);   opacity: 1; }
	}

	.auth-close {
		position: absolute;
		top: 14px;
		right: 14px;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--gray9);
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease);
	}
	.auth-close:hover { background: var(--gray4); color: var(--gray12); }

	.auth-card { position: relative; }

	.auth-logo {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--accent);
		margin-bottom: 8px;
	}
	.auth-prompt {
		font-size: 14px;
		color: var(--gray11);
		margin-bottom: 24px;
		line-height: 1.5;
	}

	.auth-tabs {
		display: flex;
		border: 1px solid var(--gray4);
		border-radius: var(--radius-sm);
		padding: 3px;
		margin-bottom: 24px;
		background: var(--gray3);
	}
	.auth-tab {
		flex: 1;
		padding: 8px 12px;
		font-size: 13px;
		font-weight: 500;
		border-radius: calc(var(--radius-sm) - 2px);
		color: var(--gray10);
		background: none;
		border: none;
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease);
	}
	.auth-tab.active {
		background: var(--gray5);
		color: var(--gray12);
	}

	.auth-success {
		background: hsla(145 50% 48% / 0.08);
		border: 1px solid hsla(145 50% 48% / 0.2);
		color: var(--green);
		border-radius: var(--radius-sm);
		padding: 12px 16px;
		font-size: 14px;
		font-weight: 500;
		text-align: center;
		margin-top: 8px;
	}

	.auth-error {
		background: hsla(0 50% 52% / 0.08);
		border: 1px solid hsla(0 50% 52% / 0.2);
		color: var(--red);
		border-radius: var(--radius-sm);
		padding: 10px 14px;
		font-size: 13px;
		margin-bottom: 16px;
	}

	.auth-label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
		font-weight: 500;
		color: var(--gray11);
		margin-bottom: 14px;
	}
	.auth-input {
		padding: 10px 12px;
		border: 1px solid var(--gray4);
		border-radius: var(--radius-sm);
		background: var(--gray1);
		color: var(--gray12);
		font-size: 14px;
		font-family: var(--font-ui);
		transition: border-color var(--duration-fast) var(--ease);
	}
	.auth-input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}

	.auth-btn {
		width: 100%;
		padding: 10px;
		margin-top: 8px;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease), opacity var(--duration-fast) var(--ease);
	}
	.auth-btn:hover:not(:disabled) { background: var(--accent-hover); }
	.auth-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.session-toast {
		position: fixed;
		top: 20px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 600;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px 10px 16px;
		background: var(--gray2);
		border: 1px solid var(--gray4);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-md);
		font-size: 13.5px;
		color: var(--gray12);
		animation: slideDown var(--duration-normal) var(--ease);
	}
	@keyframes slideDown {
		from { transform: translate(-50%, -12px); opacity: 0; }
		to   { transform: translate(-50%, 0);      opacity: 1; }
	}
	.session-toast-close {
		width: 24px;
		height: 24px;
		border-radius: var(--radius-xs);
		border: none;
		background: none;
		color: var(--gray9);
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease);
	}
	.session-toast-close:hover { background: var(--gray4); color: var(--gray12); }
</style>
