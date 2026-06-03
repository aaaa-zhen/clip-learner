/**
 * localStorage-based vocabulary storage for guest users.
 * Mirrors the shape of vocab_notebook DB rows so the notebook UI works unchanged.
 */

import { nextSchedule, type Grade } from './srs';

const STORAGE_KEY = 'clip-guest-vocab';

export interface GuestVocabEntry {
	id: number;
	word: string;
	definition: string;
	example: string;
	phonetic: string;
	source_text: string;
	episode_id: string | null;
	episode_title?: string | null;
	episode_url?: string | null;
	source_time: number | null;
	category: string;
	confidence: number;
	created_at: string;
	reviewed_at: string | null;
	review_due?: string | null;
	review_interval?: number;
	review_reps?: number;
}

function load(): GuestVocabEntry[] {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
	} catch {
		return [];
	}
}

function persist(entries: GuestVocabEntry[]) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

let nextId = 0;

export function getGuestVocab(): GuestVocabEntry[] {
	return load().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/** Returns { id, duplicate } matching the server API shape. */
export function saveGuestWord(entry: Omit<GuestVocabEntry, 'id' | 'confidence' | 'created_at' | 'reviewed_at'>): { id: number; duplicate?: boolean } {
	const entries = load();
	const dup = entries.find((e) => e.word.toLowerCase() === entry.word.toLowerCase());
	if (dup) return { id: dup.id, duplicate: true };

	if (!nextId) nextId = entries.reduce((max, e) => Math.max(max, e.id), 0);
	const id = ++nextId;

	entries.push({
		...entry,
		id,
		confidence: 0,
		created_at: new Date().toISOString(),
		reviewed_at: null
	});
	persist(entries);
	return { id };
}

export function deleteGuestWord(id: number) {
	persist(load().filter((e) => e.id !== id));
}

export function updateGuestConfidence(id: number, confidence: number) {
	const entries = load();
	const entry = entries.find((e) => e.id === id);
	if (entry) {
		entry.confidence = confidence;
		entry.reviewed_at = new Date().toISOString();
		persist(entries);
	}
}

/** Record a spaced-repetition review result for a guest's saved word. */
export function reviewGuestWord(id: number, grade: Grade) {
	const entries = load();
	const entry = entries.find((e) => e.id === id);
	if (!entry) return;
	const next = nextSchedule(grade, {
		review_interval: entry.review_interval ?? 0,
		review_reps: entry.review_reps ?? 0
	});
	entry.review_interval = next.interval;
	entry.review_reps = next.reps;
	entry.review_due = next.due;
	entry.reviewed_at = new Date().toISOString();
	persist(entries);
}

/** Export all guest vocab for migration to a real account. */
export function exportAndClearGuestVocab(): GuestVocabEntry[] {
	const entries = load();
	localStorage.removeItem(STORAGE_KEY);
	return entries;
}
