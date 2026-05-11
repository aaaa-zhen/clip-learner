# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development server
npm run build        # Production build
npm run start        # Run production build (node build)
npm run check        # Run svelte-check + TypeScript type checking
npm run check:watch  # Watch mode for type checking
npm run preview      # Preview production build
```

No test framework is configured.

## Requirements

- Node.js 22.5+ (required for built-in `node:sqlite`)
- npm
- `yt-dlp` on PATH (used for subtitle and video download)
- `ffmpeg` and `ffprobe` on PATH (audio conversion and duration detection)
- `.env` with `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_BASE_URL`)
- Optional: `whisper` CLI on PATH for local transcription, or `WHISPER_API_KEY` for API-based transcription (also supports `WHISPER_BASE_URL`, `WHISPER_MODEL`, `WHISPER_LOCAL_MODEL`)
- SQLite database auto-created at `data/app.db` on first run
- Downloaded media stored in `media/<youtube_id>/`

## Architecture

**Clip Learner** is a SvelteKit app for learning English from YouTube clips. Users paste a URL; the app downloads subtitles (or transcribes audio via Whisper), analyzes them with an LLM for humor/slang/idioms, and provides an interactive study UI.

### Data Flow

1. `POST /api/process` — validates YouTube URL, creates episode record (status: `pending`), then kicks off background processing (not awaited)
2. Background: downloads audio → transcribes via Whisper (API or local CLI) → `parseSrt()` cleans and merges into 5–10 second chunks → `processEpisode()` inserts segments → `analyzeTranscript()` calls LLM → inserts annotations/scenes/vocab → status set to `ready`
3. User is redirected to `/episode/[id]` which polls `/api/episode/[id]/status` until ready
4. In-memory job tracker (`jobs.ts`) provides live progress stages: `queued` → `fetching_audio` → `transcribing` → `analyzing` → `ready`

### Key Server Modules (`src/lib/server/`)

- **`db.ts`** — SQLite via `node:sqlite` (`DatabaseSync`); schema auto-initialized on first use; tables: `episodes`, `segments`, `humor_annotations`, `scene_breakdowns`, `vocab_notebook`, `app_settings`, `user_settings`, `users`, `sessions`
- **`claude.ts`** — All LLM interactions: `analyzeTranscript()`, `explainSegment()`, `lookupWord()`, `generateQuiz()`. Uses the `openai` SDK (OpenAI-compatible endpoint). Default base URL is `aihubmix.com`
- **`ytdlp.ts`** — Wraps `yt-dlp` CLI: video metadata, subtitle download (XML→SRT conversion), optional video download
- **`whisper.ts`** — Transcription pipeline replacing yt-dlp captions. If `WHISPER_API_KEY` is set, uses OpenAI-compatible API; otherwise falls back to local `whisper` CLI
- **`subtitles.ts`** — SRT parsing, segment merging, deduplication of auto-caption artifacts
- **`analysis.ts`** — Orchestrates the full pipeline from segments → LLM → DB
- **`auth.ts`** — Local user accounts: scrypt password hashing, session management
- **`jobs.ts`** — In-memory progress tracker for background episode processing (cleared on restart)
- **`startup.ts`** — Runs on boot via `hooks.server.ts`: cleans up orphaned in-flight episodes, checks for required binaries

### DB Query Pattern

The `query()` export in `db.ts` wraps synchronous `node:sqlite` calls with an async-compatible interface. It **converts Postgres-style `$1` placeholders to SQLite `?`**, so all query call sites use `$1, $2, ...` syntax even though the underlying engine is SQLite.

### Authentication

Local username/password auth with cookie-based sessions (`clip_session`). `hooks.server.ts` validates sessions on every request, protects API and page routes, and redirects unauthenticated users to `/`. Most data is scoped by `user_id`.

### API Routes (`src/routes/api/`)

| Route | Purpose |
|---|---|
| `process` | Ingest YouTube URL, trigger analysis, delete episode |
| `episode/[id]/status` | Poll background job progress |
| `explain` | On-demand segment explanation or word lookup |
| `quiz` | Generate quiz from episode vocabulary |
| `notebook` | CRUD for saved vocabulary |
| `settings` | Persist LLM config (api_key, base_url, model) per user |
| `download` | Download video for offline playback (returns 501 on serverless) |
| `stats` | Usage statistics |
| `auth` | Register / login |
| `logout` | End session |
| `debug` | Debug helpers |

### LLM Configuration

Per-user settings stored in `user_settings` table (keyed by `user_id` + `key`). Falls back to legacy `app_settings` table, then to env vars `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`. The UI's `SettingsModal.svelte` allows changing `api_key`, `base_url`, and `model`.

### Svelte 5 Runes

Components use Svelte 5 runes (`$state()`, `$effect()`, `$derived()`) — not the legacy reactive `$:` syntax.

### Media Serving

`src/hooks.server.ts` intercepts `/media/*` requests and serves files from the local `media/<youtube_id>/` directory with HTTP range request support (for video seeking). Media access is scoped to the owning user. This only works on Node.js runtimes, not serverless.

### Proxy Support

`hooks.server.ts` detects `HTTPS_PROXY`/`HTTP_PROXY` env vars at boot and configures `undici`'s `EnvHttpProxyAgent` as the global fetch dispatcher.

### Humor Categories

The annotation categories used throughout the type system and UI: `wordplay`, `cultural_reference`, `sarcasm`, `deadpan`, `callback`, `self_deprecation`, `banter`, `slang`, `idiom`, `absurdist`, `double_entendre`, `caption_error`.
