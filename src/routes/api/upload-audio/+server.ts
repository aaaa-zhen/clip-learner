import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';
import { transcribeAudioFile } from '$lib/server/whisper';
import { processEpisode } from '$lib/server/analysis';
import { startJob, setStage, finishJob } from '$lib/server/jobs';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'crypto';

const MAX_AUDIO_BYTES = 200 * 1024 * 1024; // 200 MB

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user?.id;
	if (!userId) return json({ error: 'Not authenticated' }, { status: 401 });

	const contentType = request.headers.get('content-type') || '';
	if (!contentType.includes('multipart/form-data')) {
		return json({ error: 'Expected multipart/form-data' }, { status: 400 });
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return json({ error: 'Failed to parse form data' }, { status: 400 });
	}

	const audioFile = formData.get('audio') as File | null;
	const title = (formData.get('title') as string | null)?.trim() || 'Local Video';

	if (!audioFile || audioFile.size === 0) {
		return json({ error: 'No audio file provided' }, { status: 400 });
	}
	if (audioFile.size > MAX_AUDIO_BYTES) {
		return json({ error: 'Audio file too large (max 200 MB)' }, { status: 413 });
	}

	const episodeId = crypto.randomUUID();
	const audioPath = path.join(tmpdir(), `clip-upload-${episodeId}.mp3`);

	// Persist episode record immediately so the client can redirect
	await query(
		'INSERT INTO episodes (id, video_id, title, url, status, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
		[episodeId, episodeId, title, '', 'fetching_audio', userId]
	);

	startJob(episodeId);

	// Write audio to tmp, kick off background processing
	const arrayBuffer = await audioFile.arrayBuffer();
	await writeFile(audioPath, Buffer.from(arrayBuffer));

	processUpload(episodeId, audioPath, userId).catch(() => {});

	return json({ id: episodeId, status: 'fetching_audio', title });
};

async function processUpload(episodeId: string, audioPath: string, userId: number) {
	try {
		setStage(episodeId, 'transcribing');
		await query('UPDATE episodes SET status = $1 WHERE id = $2', ['transcribing', episodeId]);

		const { srt, durationSeconds } = await transcribeAudioFile(audioPath, userId);

		if (durationSeconds) {
			await query('UPDATE episodes SET duration = $1 WHERE id = $2', [
				Math.round(durationSeconds),
				episodeId
			]);
		}

		if (!srt.trim()) throw new Error('Transcription produced no output.');

		setStage(episodeId, 'analyzing');
		await query('UPDATE episodes SET status = $1 WHERE id = $2', ['analyzing', episodeId]);

		await processEpisode(episodeId, srt, userId);

		const { rows: [ep] } = await query('SELECT status, error_message FROM episodes WHERE id = $1', [episodeId]);
		if (ep?.status === 'error') {
			finishJob(episodeId, 'error', ep.error_message as string);
		} else {
			finishJob(episodeId, 'ready');
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		await query('UPDATE episodes SET status = $1, error_message = $2 WHERE id = $3', [
			'error', message, episodeId
		]);
		finishJob(episodeId, 'error', message);
	} finally {
		await unlink(audioPath).catch(() => {});
	}
}
