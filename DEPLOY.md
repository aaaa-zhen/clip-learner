# Deployment Guide

## Infrastructure

| What | Where |
|---|---|
| Source code | https://github.com/aaaa-zhen/clip-learner |
| Live site | http://43.134.87.27 |
| VPS user | `ubuntu` |
| PEM key | `my.pem` (in this folder) |
| App on VPS | `/home/ubuntu/clip-learner` |
| Database | `/home/ubuntu/clip-learner/data/app.db` |
| Process manager | PM2 (app name: `clip-learner`) |
| Web server | nginx (proxies port 80 → 3000) |

---

## First-time setup on a fresh VPS

Do these once. Details below each block.

### 1. System packages

```bash
ssh -i my.pem ubuntu@43.134.87.27
sudo apt update
sudo apt install -y ffmpeg python3-pip nginx
pip install -U yt-dlp
# Optional: keep yt-dlp fresh (YouTube breaks it periodically)
(crontab -l 2>/dev/null; echo "0 4 * * * pip install -U yt-dlp") | crontab -
```

### 2. Node 22.5+ (required for `node:sqlite`)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22
node --version   # should be v22.x
```

### 3. Clone + install

```bash
cd /home/ubuntu
git clone https://github.com/aaaa-zhen/clip-learner.git
cd clip-learner
npm ci
```

### 4. Secrets

Create `/home/ubuntu/clip-learner/.env.production` (NOT checked into git):

```env
# Transcription — Groq free tier recommended
WHISPER_API_KEY=gsk_your_real_groq_key
WHISPER_BASE_URL=https://api.groq.com/openai/v1
WHISPER_MODEL=whisper-large-v3-turbo

# LLM — leave empty to force Settings modal per user, or set globally
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=
```

### 5. Build + boot with PM2

```bash
npm install -g pm2
npm run build
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup          # follow the instructions it prints so PM2 survives reboot
```

### 6. nginx reverse proxy

`/etc/nginx/sites-available/clip-learner`:

```nginx
server {
	listen 80;
	server_name 43.134.87.27 _;

	# The app needs to read byte-range requests for /media/* video seeking,
	# so don't buffer responses and pass the Range header through cleanly.
	client_max_body_size 32M;
	proxy_http_version 1.1;
	proxy_request_buffering off;
	proxy_buffering off;

	location / {
		proxy_pass http://127.0.0.1:3000;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_read_timeout 300s;     # generous for long LLM calls
		proxy_send_timeout 300s;
	}
}
```

Enable + reload:

```bash
sudo ln -s /etc/nginx/sites-available/clip-learner /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Daily deploy workflow

```bash
# Local:
git push

# On VPS:
ssh -i my.pem ubuntu@43.134.87.27
cd /home/ubuntu/clip-learner
git pull
npm ci        # safer than npm install for prod
npm run build
pm2 restart clip-learner
pm2 logs clip-learner --lines 40 --nostream
```

---

## Release checklist (before announcing)

Run each of these **on the VPS** and confirm. All green = safe to share the URL.

### Environment

- [ ] `node --version` → `v22.x` (needs 22.5+ for `node:sqlite`)
- [ ] `which yt-dlp ffmpeg ffprobe` → all three resolve
- [ ] `yt-dlp --version` → recent date (YouTube breaks old versions)
- [ ] `ls /home/ubuntu/clip-learner/.env.production` → file exists
- [ ] `cat /home/ubuntu/clip-learner/.env.production | grep WHISPER_API_KEY` → key is there

### PM2

- [ ] `pm2 list` → clip-learner is `online`
- [ ] `pm2 logs clip-learner --nostream --lines 20` shows **no** `[startup] ⚠` warnings
- [ ] Test restart: `pm2 restart clip-learner && sleep 3 && pm2 logs clip-learner --nostream --lines 15` → sees "Marked N orphan episode(s)…" if any were stuck

### nginx

- [ ] `curl -I http://127.0.0.1:3000/` → `200 OK` directly on Node
- [ ] `curl -I http://43.134.87.27/` → `200 OK` through nginx
- [ ] `sudo nginx -t` → syntax OK

### Database

- [ ] `ls -la /home/ubuntu/clip-learner/data/app.db` → file exists, owned by `ubuntu`
- [ ] App boots fresh without the file (node:sqlite will auto-create) if you delete it

### End-to-end smoke test — **the one that actually matters**

1. [ ] Open http://43.134.87.27/ → hero page renders
2. [ ] Sign up with a test account → redirects to homepage with your username in nav
3. [ ] Click ⚙ Settings → fill in LLM key (AIHubMix or equivalent) → Save
4. [ ] Paste a short YouTube URL (a 1–2 min clip is fastest) → click Study
5. [ ] Watch status progression: `Fetching audio…` → `Transcribing with Whisper…` → `Analyzing with LLM…` → `Ready` (no manual refresh)
6. [ ] Video loads and plays inside iframe
7. [ ] Pause → caption appears in the panel below (no overlay on video)
8. [ ] Click a word → popup shows phonetic + definition + example
9. [ ] Save a word → notebook badge increments
10. [ ] Click **Quiz me** → 3 initial questions → "Looking at your weak spots…" → 2 more → final diagnosis with per-category bars
11. [ ] Log out → try to visit the episode URL directly → redirected to `/` with "You were signed out" toast

If any step fails, `pm2 logs clip-learner --lines 100` usually has the real error.

---

## Known risks for initial launch

1. **Orphan jobs on crash.** We mark transient episodes as `error` on boot (see `src/lib/server/startup.ts`), so the user can click "Try again". Not lost work, but they do have to retry.

2. **yt-dlp breakage.** YouTube changes their anti-bot logic every few weeks. If new videos suddenly fail with "Failed to download audio", SSH in and `pip install -U yt-dlp`.

3. **Groq rate limits.** Free tier is ~100 requests/day. One 30-min video = ~3 requests. Check https://console.groq.com/settings/limits. Errors look like `429` in the PM2 logs.

4. **LLM model name drift.** The Settings modal defaults to `gpt-5.4-nano` via AIHubMix. If the provider changes the name, users will see "Couldn't parse definition" errors until they update the model in Settings.

5. **In-process caches lose on restart.** Word-lookup cache and job-progress tracker are in RAM. Harmless — worst case is 1 extra LLM call.

---

## Useful commands

```bash
pm2 list
pm2 logs clip-learner                         # live logs
pm2 logs clip-learner --lines 80 --nostream   # recent only
pm2 restart clip-learner
pm2 flush clip-learner                        # clear old logs

sudo systemctl status nginx
sudo nginx -t
sudo systemctl reload nginx

# Peek at DB without starting the app:
sqlite3 /home/ubuntu/clip-learner/data/app.db \
  'SELECT id, title, status, error_message FROM episodes ORDER BY created_at DESC LIMIT 10;'
```

---

## Data

- SQLite database is stored on the VPS only — it is NOT in GitHub
- User accounts, API keys, episodes, and vocab are all in `data/app.db`
- Logging out does NOT delete your API key — it stays saved until you change it
- Back it up:
  ```bash
  scp -i my.pem ubuntu@43.134.87.27:/home/ubuntu/clip-learner/data/app.db ./backups/app-$(date +%Y%m%d).db
  ```
