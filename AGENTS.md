# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development server
npm run build        # Production build
npm run check        # Run svelte-check + TypeScript type checking
npm run check:watch  # Watch mode for type checking
npm run preview      # Preview production build
```

No test framework is configured.

## Requirements

- Node.js 22.5+ + npm (`node:sqlite` is used)
- `yt-dlp` on PATH (used for YouTube audio/video download)
- `ffmpeg` and `ffprobe` on PATH (used for audio conversion and duration detection)
- Whisper transcription:
  - preferred: `.env` with `WHISPER_API_KEY`, `WHISPER_BASE_URL`, and `WHISPER_MODEL`
  - fallback: local `whisper` CLI on PATH
- LLM analysis:
  - per-user settings in the app UI, or
  - `.env` fallback with `ANTHROPIC_API_KEY` and optionally `ANTHROPIC_BASE_URL`
- SQLite database auto-created at `data/app.db` on first run

## Architecture

**Clip Learner** is a SvelteKit app for learning English from YouTube clips. Users paste a URL; the app downloads audio, transcribes it with Whisper, analyzes the transcript with an LLM for humor/slang/idioms, and provides an interactive study UI.

### Data Flow

1. `POST /api/process` — validates YouTube URL, creates episode record (status: `fetching_audio`), then kicks off background processing (not awaited)
2. Background: `transcribeYouTubeVideo()` downloads audio with `yt-dlp` → transcribes with Whisper API or local CLI → returns SRT → `parseSrt()` cleans and merges into study chunks → `processEpisode()` inserts segments → `analyzeTranscript()` calls LLM → inserts annotations/scenes → status set to `ready`
3. User is redirected to `/episode/[id]` which may show an "analyzing" state until ready

### Key Server Modules (`src/lib/server/`)

- **`db.ts`** — SQLite via Node's built-in `node:sqlite`; schema auto-initialized on first use; tables include `users`, `sessions`, `user_settings`, `episodes`, `segments`, `humor_annotations`, `scene_breakdowns`, `vocab_notebook`
- **`claude.ts`** — LLM interactions: `analyzeTranscript()`, `explainSegment()`, `lookupWord()`, `generateQuiz()`. Uses the OpenAI SDK against OpenAI-compatible endpoints via `base_url` config
- **`whisper.ts`** — Audio download and transcription pipeline: `yt-dlp` → `ffmpeg` chunking → Whisper API or local `whisper` CLI → SRT
- **`ytdlp.ts`** — YouTube video id extraction, oEmbed metadata, and a legacy subtitle wrapper around Whisper transcription
- **`subtitles.ts`** — SRT parsing, segment merging, deduplication of transcript artifacts
- **`analysis.ts`** — Orchestrates the full pipeline from segments → LLM → DB

### API Routes (`src/routes/api/`)

| Route | Purpose |
|---|---|
| `process` | Ingest YouTube URL, trigger analysis, delete episode |
| `explain` | On-demand segment explanation or word lookup |
| `quiz` | Generate quiz from episode vocabulary |
| `notebook` | CRUD for saved vocabulary |
| `settings` | Persist LLM config (api_key, base_url, model) in DB |
| `download` | Download video for offline playback (returns 501 on serverless) |
| `stats` | Usage statistics |
| `debug` | Debug helpers |

### LLM Configuration

Settings are stored per user in the `user_settings` DB table. The UI's `SettingsModal.svelte` allows changing `api_key`, `base_url`, and `model`. Falls back to env vars `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`.

### Svelte 5 Runes

Components use Svelte 5 runes (`$state()`, `$effect()`, `$derived()`) — not the legacy reactive `$:` syntax.

### Media Serving

`src/hooks.server.ts` intercepts `/media/*` requests and serves files from the local `media/<episode_id>/` directory with HTTP range request support (for video seeking). Media access is restricted to the owning user. This only works on Node.js runtimes, not serverless.

### Humor Categories

The 11 annotation categories used throughout the type system and UI: `wordplay`, `cultural_reference`, `sarcasm`, `deadpan`, `callback`, `self_deprecation`, `banter`, `slang`, `idiom`, `absurdist`, `double_entendre`, `caption_error`.
