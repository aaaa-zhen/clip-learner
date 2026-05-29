# Cookie Sync Setup (macOS → VPS)

Keeps the VPS's `cookies.txt` fresh so yt-dlp can download age/login-gated YouTube
videos. A LaunchAgent extracts cookies from Chrome on this Mac and `scp`s them to
the server twice a day.

## Why there are two copies of the script

`sync-cookies.sh` lives in this repo (under `~/Desktop/...`), but **launchd cannot
run it from there**. `~/Desktop` is a macOS TCC-protected folder, and the bash
process launchd spawns has no Full Disk Access — it fails with exit code 126
("Operation not permitted"). So launchd runs an **installed copy** from a
non-protected location:

```
~/Library/Application Support/clip-cookie-sync/
├── sync-cookies.sh   # installed copy launchd actually runs
└── my.pem            # copy of the VPS SSH key (chmod 600)
```

The repo `sync-cookies.sh` is the source of truth. The script derives its paths from
its own location (`my.pem` sits next to it), so the same file works in both places —
no hand-editing needed. **After editing it, just run:**

```bash
npm run cookies:install
```

That runs `scripts/install-cookie-sync.sh`, which copies `sync-cookies.sh` + `my.pem`
into the install dir, fixes perms, and reloads the LaunchAgent. Idempotent — also use
it for the first-time install.

The plist (`com.mafuzhen.clip-cookie-sync`, at `~/Library/LaunchAgents/`) runs the
script daily at **09:00** and **21:00**, and sets
`PATH=/opt/homebrew/bin:/usr/bin:/bin:...` so launchd can find `yt-dlp` and `scp`.
Logs go to `/tmp/sync-cookies.log`. If the plist itself is missing, the install
script will say so — recreate it from the template in git history.

## Operate

```bash
# run once now (real launchd run, not a shell run)
launchctl kickstart -k gui/$(id -u)/com.mafuzhen.clip-cookie-sync

# check it succeeded (want: last exit code = 0)
launchctl print gui/$(id -u)/com.mafuzhen.clip-cookie-sync | grep -iE "last exit code|runs ="

# stop / disable
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.mafuzhen.clip-cookie-sync.plist

# confirm cookies landed on the VPS (want: "# Netscape HTTP Cookie File")
ssh -i "$HOME/Library/Application Support/clip-cookie-sync/my.pem" ubuntu@43.134.87.27 \
  "head -1 /home/ubuntu/clip-learner/cookies.txt; stat -c %y /home/ubuntu/clip-learner/cookies.txt"
```

## Notes

- The `yt-dlp ... Requested format is not available` ERROR in the log is harmless —
  cookies are exported before format selection runs, and the script ignores it
  (`|| true`).
- The VPS reads this file via `YTDLP_COOKIES` (defaults to `<cwd>/cookies.txt`); see
  `src/lib/server/ytdlp-utils.ts`.
- Never upload the script (or any non-cookie text) through the in-app Settings cookie
  uploader — the server now rejects anything that isn't a real Netscape `cookies.txt`
  (`src/routes/api/cookies/+server.ts`), which previously could overwrite a good file.
