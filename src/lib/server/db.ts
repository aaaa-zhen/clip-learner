// Uses Node.js built-in SQLite (available in Node 22.5+)
// No external dependencies needed
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'app.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

initSchema();

function initSchema() {
	db.exec(`
		CREATE TABLE IF NOT EXISTS episodes (
			id            TEXT PRIMARY KEY,
			title         TEXT NOT NULL,
			url           TEXT NOT NULL,
			thumbnail     TEXT,
			duration      INTEGER,
			video_path    TEXT,
			subs_path     TEXT,
			status        TEXT DEFAULT 'pending',
			error_message TEXT,
			created_at    TEXT DEFAULT (datetime('now')),
			studied_at    TEXT
		);

		CREATE TABLE IF NOT EXISTS segments (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			episode_id  TEXT REFERENCES episodes(id),
			index_num   INTEGER,
			start_time  REAL,
			end_time    REAL,
			text        TEXT,
			UNIQUE(episode_id, index_num)
		);

		CREATE TABLE IF NOT EXISTS humor_annotations (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			episode_id  TEXT REFERENCES episodes(id),
			segment_id  INTEGER REFERENCES segments(id),
			category    TEXT,
			explanation TEXT,
			excerpt     TEXT,
			start_pos   INTEGER,
			end_pos     INTEGER
		);

		CREATE TABLE IF NOT EXISTS scene_breakdowns (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			episode_id   TEXT REFERENCES episodes(id),
			start_seg    INTEGER,
			end_seg      INTEGER,
			title        TEXT,
			explanation  TEXT,
			humor_types  TEXT
		);

		CREATE TABLE IF NOT EXISTS app_settings (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS user_settings (
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			key     TEXT NOT NULL,
			value   TEXT NOT NULL,
			PRIMARY KEY (user_id, key)
		);

		CREATE TABLE IF NOT EXISTS vocab_notebook (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			word        TEXT NOT NULL,
			definition  TEXT,
			example     TEXT,
			episode_id  TEXT,
			category    TEXT,
			confidence  INTEGER DEFAULT 0,
			created_at  TEXT DEFAULT (datetime('now')),
			reviewed_at TEXT
		);

		CREATE TABLE IF NOT EXISTS users (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			username   TEXT NOT NULL UNIQUE,
			password   TEXT NOT NULL,
			created_at TEXT DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS sessions (
			id         TEXT PRIMARY KEY,
			user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at TEXT NOT NULL,
			created_at TEXT DEFAULT (datetime('now'))
		);

		CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
	`);

	// Add user_id columns to existing tables (safe to run multiple times — SQLite throws if column exists)
	for (const table of ['episodes', 'vocab_notebook']) {
		try {
			db.exec(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0`);
		} catch { /* column already exists */ }
	}

	try {
		db.exec('ALTER TABLE episodes ADD COLUMN video_id TEXT');
	} catch { /* column already exists */ }

	db.exec(`
		UPDATE episodes
		SET video_id = id
		WHERE video_id IS NULL OR video_id = ''
	`);

	// Indexes on user_id columns (must come after the ALTER TABLE above)
	db.exec(`
		CREATE INDEX IF NOT EXISTS idx_episodes_user ON episodes(user_id);
		CREATE INDEX IF NOT EXISTS idx_vocab_user    ON vocab_notebook(user_id);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_user_video ON episodes(user_id, video_id);
	`);
}

// Async-compatible wrapper so the rest of the codebase doesn't need to change.
// Converts Postgres $1 placeholders to SQLite ?.
export async function query(text: string, params: any[] = []) {
	const converted = text.replace(/\$\d+/g, '?');
	const upper = converted.trimStart().toUpperCase();

	if (upper.startsWith('SELECT') || upper.startsWith('WITH')) {
		const rows = db.prepare(converted).all(...params) as any[];
		return { rows };
	}

	if (upper.startsWith('INSERT') && /RETURNING\s+\S+/i.test(converted)) {
		const clean = converted.replace(/\s+RETURNING\s+\S+/i, '');
		const result = db.prepare(clean).run(...params) as any;
		return { rows: [{ id: result.lastInsertRowid }] };
	}

	db.prepare(converted).run(...params);
	return { rows: [] };
}

/** Run multiple statements in a single SQLite transaction. */
export async function transaction(fn: () => Promise<void>): Promise<void> {
	db.exec('BEGIN');
	try {
		await fn();
		db.exec('COMMIT');
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
}
