let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;

function stopCurrentAudio() {
	if (currentAudio) {
		currentAudio.pause();
		currentAudio = null;
	}
	if (currentObjectUrl) {
		URL.revokeObjectURL(currentObjectUrl);
		currentObjectUrl = null;
	}
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
		stopCurrentAudio();

		currentObjectUrl = url;
		currentAudio = new Audio(url);
		currentAudio.onended = () => {
			if (currentObjectUrl === url) {
				URL.revokeObjectURL(url);
				currentObjectUrl = null;
				currentAudio = null;
			}
		};

		await currentAudio.play();
		return true;
	} catch {
		return speakWithBrowserVoice(cleaned);
	}
}
