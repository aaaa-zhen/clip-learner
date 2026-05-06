import type { HumorCategory } from '$lib/types';

export const categoryColors: Record<HumorCategory, string> = {
	slang: '#d97706',
	idiom: '#2563eb',
	cultural_reference: '#7c3aed',
	wordplay: '#059669',
	sarcasm: '#dc2626',
	deadpan: '#4b5563',
	callback: '#c026d3',
	self_deprecation: '#b45309',
	banter: '#0891b2',
	absurdist: '#e11d48',
	double_entendre: '#e11d48',
	caption_error: '#9333ea'
};

export const categoryLabels: Record<HumorCategory, string> = {
	slang: 'Slang',
	idiom: 'Idiom',
	cultural_reference: 'Culture',
	wordplay: 'Wordplay',
	sarcasm: 'Sarcasm',
	deadpan: 'Deadpan',
	callback: 'Callback',
	self_deprecation: 'Self-deprecation',
	banter: 'Banter',
	absurdist: 'Absurdist',
	double_entendre: 'Dirty Joke',
	caption_error: 'Possible miscaption'
};
