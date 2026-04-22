/**
 * Simple in-memory sliding-window rate limiter.
 * Resets on server restart — good enough for a single-instance app.
 */

interface Bucket {
	timestamps: number[];
}

const buckets = new Map<string, Bucket>();

// Prune stale buckets every 5 minutes to avoid memory leak.
setInterval(() => {
	const now = Date.now();
	for (const [key, bucket] of buckets) {
		bucket.timestamps = bucket.timestamps.filter((t) => now - t < 600_000);
		if (bucket.timestamps.length === 0) buckets.delete(key);
	}
}, 300_000);

/**
 * Check if a request is allowed under the rate limit.
 * @param key   Unique key (e.g. IP + endpoint)
 * @param limit Max requests allowed in the window
 * @param windowMs Window size in milliseconds
 * @returns `true` if allowed, `false` if rate-limited
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
	const now = Date.now();
	let bucket = buckets.get(key);
	if (!bucket) {
		bucket = { timestamps: [] };
		buckets.set(key, bucket);
	}
	bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
	if (bucket.timestamps.length >= limit) return false;
	bucket.timestamps.push(now);
	return true;
}
