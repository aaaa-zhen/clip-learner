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

## Daily Workflow

### 1. Make changes locally

Edit files in `/Users/meizu/Downloads/clip-learner-main/`

### 2. Push to GitHub

```bash
cd /Users/meizu/Downloads/clip-learner-main
git add <files>
git commit -m "describe your change"
git push
```

### 3. Deploy to VPS

```bash
ssh -i my.pem ubuntu@43.134.87.27
cd /home/ubuntu/clip-learner
git pull
npm install
npm run build
pm2 restart clip-learner
```

---

## SSH into VPS

```bash
ssh -i /Users/meizu/Downloads/clip-learner-main/my.pem ubuntu@43.134.87.27
```

---

## Useful PM2 Commands (run on VPS)

```bash
pm2 list                        # Check app status
pm2 logs clip-learner           # Live logs
pm2 logs clip-learner --lines 50 --nostream  # Last 50 log lines
pm2 restart clip-learner        # Restart app
pm2 stop clip-learner           # Stop app
```

---

## Check nginx

```bash
sudo systemctl status nginx
sudo nginx -t                   # Test config
sudo systemctl reload nginx     # Reload after config changes
```

---

## Data

- SQLite database is stored on the VPS only — it is NOT in GitHub
- User accounts, API keys, episodes, and vocab are all in `data/app.db`
- Logging out does NOT delete your API key — it stays saved until you change it
