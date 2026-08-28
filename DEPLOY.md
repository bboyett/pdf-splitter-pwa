# Deploying PDF Splitter to Render + GitHub Pages (free)

## How this is put together

Two separate free services, one repo:

- **Render** (`Dockerfile`, `app.py`, `templates/`, `static/`) — runs the actual
  Flask app. Free web services on Render **spin down after ~15 min of no
  traffic** and take 30-60s to spin back up on the next request. That's fine
  for your usage (a couple people, a few times a week) — you're well inside
  the free tier's 750 hours/month, you just accept the occasional cold start.
- **GitHub Pages** (`docs/`) — a tiny static "launcher" page. GitHub Pages
  never sleeps, so it opens instantly. It's what you actually add to your
  iPad home screen. On open, it pings Render's `/health` endpoint in a loop,
  shows a spinner + "waking up" message while Render boots, then redirects
  you into the real app once it responds.

You need both pieces because once the Render app is asleep, there's no way
for *it* to show you a spinner — it can't respond with anything, including a
loading page, until it's already awake. The launcher lives somewhere that's
always instantly available instead.

---

## 1. Push this project to GitHub

From `c:\Users\benbo\pdf-Splitter`:

```bash
git init
git add .
git commit -m "Initial commit"
```

Create a new **empty** repo on GitHub (github.com → New repository — don't
add a README/gitignore, you already have one). Then, using the URL it gives
you:

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

(If you'd rather use SSH, use the `git@github.com:...` URL instead — same
idea.)

---

## 2. Turn on GitHub Pages (the launcher)

1. On the repo's GitHub page: **Settings → Pages**.
2. Under "Build and deployment" → Source: **Deploy from a branch**.
3. Branch: **main**, folder: **/docs**. Save.
4. GitHub will give you a URL like:
   `https://<your-username>.github.io/<repo-name>/`
   It can take a minute or two to go live the first time.

Leave this tab open — you'll need this URL for the iPad step later.

---

## 3. Deploy the Flask app on Render

1. Go to [render.com](https://render.com) and sign up / log in (GitHub login
   is easiest since it can read your repos directly).
2. **New → Web Service.**
3. Connect your GitHub account if prompted, then pick this repo.
4. Render should auto-detect the `Dockerfile` and set **Environment: Docker**.
   If it instead offers a "Runtime" dropdown, explicitly choose **Docker**.
5. Settings:
   - **Name**: anything, e.g. `pdf-splitter`
   - **Instance Type**: **Free**
   - **Health Check Path**: `/health`
   - Leave Build/Start commands blank — the `Dockerfile` handles both.
6. Click **Create Web Service**. First build takes a few minutes (installs
   Poppler + Python deps in the container).
7. Once it's live, copy the URL Render gives you, e.g.
   `https://pdf-splitter-xxxx.onrender.com`.

---

## 4. Point the launcher at your Render URL

Open [docs/index.html](docs/index.html), find this near the top of the
`<script>` block:

```js
const APP_URL = "REPLACE_WITH_RENDER_URL";
```

Replace it with your actual Render URL from step 3 (no trailing slash), e.g.:

```js
const APP_URL = "https://pdf-splitter-xxxx.onrender.com";
```

Save, then push:

```bash
git add docs/index.html
git commit -m "Point launcher at Render URL"
git push
```

GitHub Pages redeploys automatically in under a minute.

---

## 5. Add it to your iPad home screen

1. On the iPad, open **Safari** (must be Safari, not Chrome — "Add to Home
   Screen" as a standalone app only works from Safari on iOS).
2. Go to your GitHub Pages URL from step 2:
   `https://<your-username>.github.io/<repo-name>/`
3. Tap the **Share** icon (square with an arrow) → **Add to Home Screen**.
4. Confirm the name ("PDF Splitter") → **Add**.

You now have an app icon. Tapping it opens full-screen (no Safari address
bar), shows the spinner while Render wakes up, then drops you straight into
the app.

---

## 6. Using it day to day

- Tap the icon. If the server was idle, you'll see "Waking up the server…"
  for up to ~60s, then it opens automatically — no action needed from you.
- If it's already awake (used recently), it opens in a couple seconds.
- Everything else (upload, cut lines, split, save-as) works exactly like it
  did locally — nothing about the app itself changed, just where it's hosted.

## Troubleshooting

- **Launcher stuck on "Connecting…" forever**: double check `APP_URL` in
  `docs/index.html` has no typo and matches the Render URL exactly (and that
  you pushed the change — check the file on github.com).
- **"Open manually" link shows up and using it works, but the launcher never
  redirects itself**: your Render service is probably crashing on boot —
  check the **Logs** tab on the Render dashboard.
- **Upload fails after the app opens**: check Render logs for a Poppler
  error — confirms the Dockerfile's `apt-get install poppler-utils` step
  actually ran; a fresh deploy should always include it.
- **Want to skip the cold start most of the time**: you can point a free
  uptime pinger (e.g. UptimeRobot) at `https://your-app.onrender.com/health`
  every 10 minutes to keep it awake. Optional — with 750 free hours/month
  and only one free service, this stays within the free tier even running
  ~24/7. Not necessary for 2-3 uses a week, just a convenience if cold starts
  bother you.
