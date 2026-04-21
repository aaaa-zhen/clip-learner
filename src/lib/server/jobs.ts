/**
 * In-memory progress tracker for background episode processing.
 *
 * Background jobs (fetching audio → transcribing → analyzing) don't finish
 * within an HTTP request, so the poll endpoint needs a place to look up
 * "how far along is episode X?".
 *
 * Simple Map keyed by episodeId. Jobs are cleared on completion/error or
 * server restart. If a job disappears, the status endpoint falls back to
 * the DB `episodes.status` field.
 */

export type JobStage =
	| 'queued'
	| 'fetching_audio'
	| 'transcribing'
	| 'analyzing'
	| 'ready'
	| 'error';

export interface JobSnapshot {
	stage: JobStage;
	/** Unix ms timestamp when the job started. */
	startedAt: number;
	/** Unix ms timestamp when the current stage started. */
	stageStartedAt: number;
	/** Estimated total seconds, or null if unknown. */
	estimateSeconds: number | null;
	/** Video duration in seconds, if known. */
	videoDurationSeconds: number | null;
	/** Optional error message if stage === 'error'. */
	errorMessage?: string | null;
}

const jobs = new Map<string, JobSnapshot>();

export function startJob(
	episodeId: string,
	opts: { estimateSeconds?: number | null; videoDurationSeconds?: number | null } = {}
): JobSnapshot {
	const now = Date.now();
	const snap: JobSnapshot = {
		stage: 'queued',
		startedAt: now,
		stageStartedAt: now,
		estimateSeconds: opts.estimateSeconds ?? null,
		videoDurationSeconds: opts.videoDurationSeconds ?? null,
		errorMessage: null
	};
	jobs.set(episodeId, snap);
	return snap;
}

export function setStage(episodeId: string, stage: JobStage) {
	const job = jobs.get(episodeId);
	if (!job) return;
	job.stage = stage;
	job.stageStartedAt = Date.now();
}

export function setEstimate(
	episodeId: string,
	opts: { estimateSeconds?: number | null; videoDurationSeconds?: number | null }
) {
	const job = jobs.get(episodeId);
	if (!job) return;
	if (opts.estimateSeconds !== undefined) job.estimateSeconds = opts.estimateSeconds;
	if (opts.videoDurationSeconds !== undefined) job.videoDurationSeconds = opts.videoDurationSeconds;
}

export function finishJob(episodeId: string, stage: 'ready' | 'error', errorMessage?: string) {
	const job = jobs.get(episodeId);
	if (!job) return;
	job.stage = stage;
	if (errorMessage !== undefined) job.errorMessage = errorMessage;
	// Keep around briefly so the final poll can see the terminal state,
	// then drop it so we don't leak memory.
	setTimeout(() => jobs.delete(episodeId), 30_000);
}

export function getJob(episodeId: string): JobSnapshot | undefined {
	return jobs.get(episodeId);
}
