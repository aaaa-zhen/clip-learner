import { writable, get } from 'svelte/store';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'clip-theme';

function isThemeMode(value: string | null): value is ThemeMode {
	return value === 'light' || value === 'dark' || value === 'system';
}

function getInitial(): ThemeMode {
	if (typeof localStorage === 'undefined') return 'system';
	const stored = localStorage.getItem(STORAGE_KEY);
	return isThemeMode(stored) ? stored : 'system';
}

export const themeMode = writable<ThemeMode>(getInitial());

function resolve(mode: ThemeMode): 'light' | 'dark' {
	if (mode !== 'system') return mode;
	if (typeof window === 'undefined') return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(mode: ThemeMode) {
	const resolved = resolve(mode);
	document.documentElement.classList.add('theme-transitioning');
	document.documentElement.setAttribute('data-theme', resolved);
	document.documentElement.style.colorScheme = resolved;
	setTimeout(() => {
		document.documentElement.classList.remove('theme-transitioning');
	}, 300);
}

let initialized = false;

/** Call once from the root layout's onMount. Returns a cleanup function. */
export function initTheme(): () => void {
	if (initialized) return () => {};
	initialized = true;

	// The inline script in app.html already set data-theme before paint,
	// so we only need to wire up reactivity here — no flash.

	const mq = window.matchMedia('(prefers-color-scheme: dark)');
	const mqHandler = () => {
		if (get(themeMode) === 'system') applyTheme('system');
	};
	mq.addEventListener('change', mqHandler);

	const unsubscribe = themeMode.subscribe(mode => {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(STORAGE_KEY, mode);
		}
		if (typeof document !== 'undefined') {
			applyTheme(mode);
		}
	});

	return () => {
		mq.removeEventListener('change', mqHandler);
		unsubscribe();
		initialized = false;
	};
}
