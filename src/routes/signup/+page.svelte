<script lang="ts">
	import { enhance } from '$app/forms';
	let { form } = $props();
</script>

<svelte:head><title>Sign up – Clip Learner</title></svelte:head>

<div class="auth-wrap">
	<div class="auth-card">
		<div class="auth-logo">Clip Learner</div>
		<h1 class="auth-title">Create account</h1>

		{#if form?.error}
			<p class="auth-error">{form.error}</p>
		{/if}

		<form method="POST" use:enhance>
			<label class="auth-label">
				Username
				<input class="auth-input" type="text" name="username" required minlength="3" autocomplete="username" />
			</label>
			<label class="auth-label">
				Password
				<input class="auth-input" type="password" name="password" required minlength="8" autocomplete="new-password" />
			</label>
			<button class="auth-btn" type="submit">Sign up</button>
		</form>

		<p class="auth-foot">Already have an account? <a href="/login">Log in</a></p>
	</div>
</div>

<style>
	.auth-wrap {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--gray1);
		padding: 24px;
	}
	.auth-card {
		width: min(400px, 100%);
		background: var(--gray2);
		border: 1px solid var(--gray4);
		border-radius: var(--radius-lg);
		padding: 40px 36px;
		box-shadow: var(--shadow-lg);
	}
	.auth-logo {
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--accent);
		margin-bottom: 24px;
	}
	.auth-title {
		font-family: var(--font-display);
		font-size: 28px;
		font-weight: 400;
		letter-spacing: -0.02em;
		margin-bottom: 28px;
		color: var(--gray12);
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
		margin-bottom: 16px;
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
		padding: 11px;
		margin-top: 8px;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease);
	}
	.auth-btn:hover { background: var(--accent-hover); }
	.auth-foot {
		margin-top: 24px;
		text-align: center;
		font-size: 13px;
		color: var(--gray9);
	}
	.auth-foot a { color: var(--accent); }
	.auth-foot a:hover { text-decoration: underline; }
</style>
