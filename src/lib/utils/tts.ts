let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;

// In-memory audio cache: text → blob URL. Survives page navigation within the
// same session. We keep the blob URL alive (don't revoke on ended) so we can
// replay without a new API call. Max 50 entries; evict oldest when full.
const MAX_AUDIO_CACHE = 50;
const audioCache = new Map<string, string>(); // text → objectURL

function stopCurrentAudio() {
	if (currentAudio) {
		currentAudio.pause();
		currentAudio = null;
	}
	// Don't revoke currentObjectUrl — it may be in the cache for replay.
	currentObjectUrl = null;
	if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
		window.speechSynthesis.cancel();
	}
}

function speakWithBrowserVoice(text: string): boolean {
	if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;

	stopCurrentAudio();
	const utterance = new SpeechSynthesisUtterance(text);
	utterance.lang = 'en-US';
	utterance.rate = 0.9;
	window.speechSynthesis.speak(utterance);
	return true;
}

export async function playPronunciation(text: string): Promise<boolean> {
	const cleaned = text.trim();
	if (!cleaned) return false;

	// Cache hit — play immediately without a network call
	const cached = audioCache.get(cleaned);
	if (cached) {
		stopCurrentAudio();
		currentObjectUrl = cached;
		currentAudio = new Audio(cached);
		currentAudio.onended = () => { currentAudio = null; };
		await currentAudio.play();
		return true;
	}

	try {
		const res = await fetch('/api/tts', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: cleaned })
		});

		if (!res.ok) {
			return speakWithBrowserVoice(cleaned);
		}

		const blob = await res.blob();
		const url = URL.createObjectURL(blob);

		// Evict oldest entry if at capacity
		if (audioCache.size >= MAX_AUDIO_CACHE) {
			const firstKey = audioCache.keys().next().value;
			if (firstKey) {
				URL.revokeObjectURL(audioCache.get(firstKey)!);
				audioCache.delete(firstKey);
			}
		}
		audioCache.set(cleaned, url);

		stopCurrentAudio();
		currentObjectUrl = url;
		currentAudio = new Audio(url);
		currentAudio.onended = () => { currentAudio = null; };
		await currentAudio.play();
		return true;
	} catch {
		return speakWithBrowserVoice(cleaned);
	}
}
