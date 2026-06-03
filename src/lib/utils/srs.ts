/**
 * Spaced-repetition scheduling — a simplified two-button (Forgot / Got it)
 * SM-2 variant. Shared by the server (`/api/notebook/review`), the guest
 * localStorage store, and the review UI so all three agree on the schedule.
 */

export type Grade = 0 | 1; // 0 = Forgot, 1 = Got it

export interface ReviewState {
	review_interval?: number; // days until next review after the last "Got it"
	review_reps?: number; // consecutive "Got it" count
	review_due?: string | null;
}

export interface NextSchedule {
	interval: number; // days
	reps: number;
	due: string; // ISO datetime
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_INTERVAL_DAYS = 365;

function addDays(from: Date, days: number): Date {
	return new Date(from.getTime() + days * DAY_MS);
}

/**
 * Compute the next schedule given a grade and the entry's prior review state.
 * - Forgot: reset progress; due again right away (same session / today).
 * - Got it: grow the interval 1d → 3d → ×2.4 (capped at a year).
 */
export function nextSchedule(grade: Grade, prev: ReviewState, now: Date = new Date()): NextSchedule {
	if (grade === 0) {
		return { interval: 0, reps: 0, due: now.toISOString() };
	}
	const reps = (prev.review_reps ?? 0) + 1;
	let interval: number;
	if (reps <= 1) interval = 1;
	else if (reps === 2) interval = 3;
	else interval = Math.min(MAX_INTERVAL_DAYS, Math.round((prev.review_interval || 3) * 2.4));
	return { interval, reps, due: addDays(now, interval).toISOString() };
}

/** A card is due when it has never been reviewed or its due time has passed. */
export function isDue(entry: ReviewState, now: Date = new Date()): boolean {
	if (!entry.review_due) return true;
	return new Date(entry.review_due).getTime() <= now.getTime();
}

/** Human label for the next interval, used under the grade buttons. */
export function intervalLabel(grade: Grade, prev: ReviewState): string {
	if (grade === 0) return '< 1 min';
	const { interval } = nextSchedule(1, prev);
	return interval <= 1 ? '1 day' : `${interval} days`;
}
