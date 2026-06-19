# FP Tracker — Unraid Setup Guide

This guide walks through getting FP Tracker running on Unraid from scratch using the **Docker Compose Plus** plugin. The app runs as a single container on port 7002 and builds its own Docker image from source, so there is no Docker Hub image to pull.

---

## Prerequisites

- Unraid 6.12 or later
- **Docker Compose Plus** plugin installed
  - Install via Apps → search "Docker Compose Plus" → Install
- Internet access from your Unraid server (to pull from GitHub and download the base Python image)

---

## Step 1 — Get the code onto Unraid

Open the Unraid terminal: **Tools → Terminal** (the `>_` icon in the top-right navbar).

```bash
# Create the app directory
mkdir -p /mnt/user/appdata/fp-tracker

# Clone the repo into it
git clone https://github.com/asaji/FP-tracker.git /mnt/user/appdata/fp-tracker

# Move into the directory
cd /mnt/user/appdata/fp-tracker
```

The data directory (where the SQLite database lives) is created automatically on first run.

---

## Step 2 — Configure environment variables

Open the `docker-compose.yml` file in the app directory:

```bash
nano /mnt/user/appdata/fp-tracker/docker-compose.yml
```

Fill in your values:

```yaml
services:
  fp-tracker:
    build: .
    container_name: fp-tracker
    ports:
      - "7002:7002"
    volumes:
      - ./data:/config
    environment:
      - TZ=America/Los_Angeles        # Change to your timezone
      - DB_PATH=/config/flights.db
      - PUSHOVER_TOKEN=               # Optional — see Step 3
      - PUSHOVER_USER=                # Optional — see Step 3
      - POLL_INTERVAL_MINUTES=480     # How often to check prices (minutes). 480 = every 8 hours
    restart: unless-stopped
```

Save with `Ctrl+O`, exit with `Ctrl+X`.

**Timezone values:** Use standard tz database names, e.g. `America/New_York`, `America/Chicago`, `Europe/London`, `Asia/Tokyo`. Full list at [en.wikipedia.org/wiki/List_of_tz_database_time_zones](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

---

## Step 3 — Pushover notifications (optional)

FP Tracker sends a push notification whenever a tracked flight price changes. This requires a free [Pushover](https://pushover.net) account.

1. Sign up at pushover.net
2. Create an application — name it "FP Tracker", any icon
3. Copy the **API Token/Key** → paste into `PUSHOVER_TOKEN`
4. Copy your **User Key** (on your dashboard) → paste into `PUSHOVER_USER`

If you leave both blank, the app still works — it just won't send alerts.

---

## Step 4 — Add as a Compose stack

1. In the Unraid web UI, go to **Docker → Compose** section (scroll down below the regular containers)
2. Click **Add New Stack**
3. Fill in:
   - **Name:** `fp-tracker`
   - **Compose file path:** `/mnt/user/appdata/fp-tracker/docker-compose.yml`
4. Click **Save**

---

## Step 5 — Build and start

The first build downloads the Python base image and installs dependencies — this takes **2–5 minutes** depending on your internet speed.

In the Compose section, click the fp-tracker row to expand it, then click **Compose Up**.

Or right-click the fp-tracker stack → **Compose Up**.

You'll see build output scrolling by. When you see:

```
✔ Container fp-tracker  Started
✔ Stack fp-tracker updated successfully
```

it's running.

---

## Step 6 — Access the app

Open a browser and go to:

```
http://<your-unraid-ip>:7002
```

Your Unraid IP is shown in the top-right of the Unraid web UI. Example: `http://192.168.1.35:7002`

---

## Updating to a new version

When a new version is available, run these two steps:

**1. Pull the latest code** — in the Unraid terminal:

```bash
cd /mnt/user/appdata/fp-tracker
git pull
```

**2. Rebuild the container** — in the Compose UI:

Right-click the fp-tracker stack → **Force Update & Rebuild**

This rebuilds the Docker image with the new code and restarts the container. Your price history and settings in `./data/` are preserved across every rebuild.

---

## Troubleshooting

**The container starts then immediately stops**

Check the logs: right-click fp-tracker → **View Logs**. Look for Python errors at the bottom.

**Port 7002 is already in use**

Another container is using that port. Change the left side of the port mapping in `docker-compose.yml`:
```yaml
ports:
  - "7003:7002"   # now accessible on port 7003
```
Then do a Force Update & Rebuild.

**`git clone` fails with "Permission denied"**

Make sure the `/mnt/user/appdata/` directory exists and is writable. This is standard on all Unraid installs — if it's missing, your cache drive may not be mounted.

**Prices show "—" and never update**

The app polls on a schedule (default every 8 hours). Hit **Refresh** (the circular arrow button) in the UI to trigger an immediate check. If it still shows "—" after a few minutes, check the logs for flight search errors.

**I changed `docker-compose.yml` but nothing changed**

The Compose Up button doesn't rebuild the image. Use **Force Update & Rebuild** instead whenever you change environment variables or update the code.

---

## File locations on Unraid

| Path | Contents |
|---|---|
| `/mnt/user/appdata/fp-tracker/` | App source code, Dockerfile, docker-compose.yml |
| `/mnt/user/appdata/fp-tracker/data/flights.db` | SQLite database — all your routes and price history |

Back up the `data/` folder to preserve your price history.
