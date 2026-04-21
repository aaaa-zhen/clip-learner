export interface Episode {
	id: string;
	video_id?: string | null;
	title: string;
	url: string;
	thumbnail: string | null;
	duration: number | null;
	video_path: string | null;
	subs_path: string | null;
	// `downloading` is a legacy name kept for rows created before the
	// Whisper swap; new episodes use `fetching_audio` + `transcribing`.
	status:
		| 'pending'
		| 'fetching_audio'
		| 'downloading'
		| 'transcribing'
		| 'analyzing'
		| 'ready'
		| 'error';
	error_message: string | null;
	created_at: string;
	studied_at: string | null;
}

export interface Segment {
	id: number;
	episode_id: string;
	index_num: number;
	start_time: number;
	end_time: number;
	text: string;
}

export interface HumorAnnotation {
	id: number;
	episode_id: string;
	segment_id: number;
	category: HumorCategory;
	explanation: string;
	excerpt: string;
	start_pos: number;
	end_pos: number;
}

export type HumorCategory =
	| 'wordplay'
	| 'cultural_reference'
	| 'sarcasm'
	| 'deadpan'
	| 'callback'
	| 'self_deprecation'
	| 'banter'
	| 'slang'
	| 'idiom'
	| 'absurdist'
	| 'double_entendre'
	| 'caption_error';

export interface SceneBreakdown {
	id: number;
	episode_id: string;
	start_seg: number;
	end_seg: number;
	title: string;
	explanation: string;
	humor_types: HumorCategory[];
}

export interface VocabEntry {
	id: number;
	word: string;
	definition: string;
	example: string;
	episode_id: string | null;
	category: string;
	confidence: number;
	created_at: string;
	reviewed_at: string | null;
}
