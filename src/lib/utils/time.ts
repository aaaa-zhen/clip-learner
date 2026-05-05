export function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function parseSrtTime(timeStr: string): number {
	const parts = timeStr.trim().split(':');
	const hours = parseInt(parts[0]);
	const minutes = parseInt(parts[1]);
	const secParts = parts[2].replace(',', '.').split('.');
	const seconds = parseInt(secParts[0]);
	const ms = parseInt((secParts[1] || '0').padEnd(3, '0').slice(0, 3));
	return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}
