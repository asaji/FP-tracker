# Flight Price Tracker

A self-hosted flight price tracking app that runs perpetually as a Docker container. Add routes you want to monitor, and the app periodically checks prices via Google Flights, plots price history over time, and sends Pushover alerts whenever a price changes.

![Dark theme web UI with route cards showing price history charts](https://img.shields.io/badge/UI-Dark%20Theme-1f6feb) ![Python](https://img.shields.io/badge/Python-3.12-blue) ![Docker](https://img.shields.io/badge/Docker-ready-2496ED)

---

## Features

- **One-way and round-trip tracking** — round-trip legs are tracked independently so you can see outbound and return prices separately
- **Date flexibility** — every route automatically tracks the day before and day after your chosen date so you can compare if shifting by a day saves money
- **Price history charts** — line chart per route showing price trends over time; click any chart to expand it
- **Trip Builder** — select any combination of tracked flights at the bottom of the page to see a combined total cost
- **Pushover alerts** — instant notification on any price change (increase or decrease) with the dollar amount
- **Adjustable poll interval** — defaults to every 8 hours (3× per day), configurable down to 15 minutes
- **Airline & cabin filtering** — optionally restrict tracking to specific airlines (IATA codes) and cabin class
- **Non-stop filter** — optionally track non-stop flights only
- **Persistent storage** — SQLite database; all price history survives container restarts and rebuilds

---

## Quick Start (Docker Compose)

### 1. Clone the repo

```bash
git clone https://github.com/asaji/FP-tracker.git
cd FP-tracker
```

### 2. Configure environment variables

Edit `docker-compose.yml` and fill in your Pushover credentials:

```yaml
environment:
  - PUSHOVER_TOKEN=your_app_token_here
  - PUSHOVER_USER=your_user_key_here
  - POLL_INTERVAL_MINUTES=480   # 480 = every 8 hours (3× per day)
  - TZ=America/Los_Angeles
```

Pushover credentials are optional — the app works without them, you just won't receive alerts.

### 3. Build and start

```bash
docker compose up -d --build
```

### 4. Open the UI

Navigate to `http://localhost:7002` (or your server's IP).

---

## Unraid Deployment

1. SSH into your Unraid server
2. Clone into your appdata share:
   ```bash
   mkdir -p /mnt/user/appdata/fp-tracker
   cd /mnt/user/appdata/fp-tracker
   git clone https://github.com/asaji/FP-tracker.git .
   ```
3. Fill in Pushover credentials in `docker-compose.yml`
4. Start the container:
   ```bash
   docker compose up -d --build
   ```
5. Access at `http://unraid-ip:7002`

For auto-start on array boot, install the **Docker Compose Manager** plugin from Community Applications and point it at `/mnt/user/appdata/fp-tracker`.

---

## Updating

```bash
cd /mnt/user/appdata/fp-tracker
git pull
docker compose up -d --build
```

Your database and price history are stored in `./data/` and are preserved across rebuilds.

---

## Configuration

All configuration is via environment variables in `docker-compose.yml`:

| Variable | Default | Description |
|---|---|---|
| `PUSHOVER_TOKEN` | *(empty)* | Pushover application token |
| `PUSHOVER_USER` | *(empty)* | Pushover user key |
| `POLL_INTERVAL_MINUTES` | `480` | How often to check prices (min 15) |
| `TZ` | `America/Los_Angeles` | Timezone for scheduler and logs |
| `DB_PATH` | `/config/flights.db` | Path to SQLite database inside container |

The poll interval can also be changed live from the Settings (⚙) button in the UI without restarting the container.

---

## How to Use

### Adding a route

1. Click **Add Route**
2. Select **One-way** or **Round-trip**
3. Enter origin and destination as 3-letter IATA airport codes (e.g. `JFK`, `LHR`, `SEA`)
4. Pick your target departure date
5. Optionally filter by cabin class, adults, airlines (comma-separated IATA codes like `AS, DL`), or non-stop only
6. Click **Add Route**

The app will create 3 tracked entries: your chosen date, the day before, and the day after.

### Trip Builder

Check the checkbox on any date sub-card to add it to the Trip Builder bar at the bottom of the page. Select multiple flights (e.g. outbound + return) to see the combined total cost.

### Testing notifications

Go to Settings (⚙) → **Send Test** to verify your Pushover credentials are working before waiting for a real price change.

---

## Architecture

```
Flask (port 7002)          — web UI and REST API
APScheduler                — background price polling
fli / flights library      — Google Flights data (no API key required)
SQLite                     — price history storage
Pushover API               — push notifications
Docker + volume mount      — persistent data at ./data/
```

---

## Data

- Price history is kept forever (never pruned)
- The SQLite database is at `./data/flights.db` on the host
- To back it up: `cp ./data/flights.db ./data/flights.db.bak`

---

## Ports

| Port | Service |
|---|---|
| `7002` | Web UI |
