# FP-Tracker — Flight Price Tracker

Self-hosted flight price tracking app. Runs as a Docker container on Unraid (port 7002).
Periodically checks Google Flights prices via the `fli`/`flights` library, stores history
in SQLite, and sends Pushover push notifications on any price change.

## Stack

- **Backend:** Python 3.12, Flask, APScheduler
- **Flight data:** `flights` pip package (punitarani/fli — wraps Google Flights, no API key needed)
- **Database:** SQLite at `./data/flights.db` (host) / `/config/flights.db` (container)
- **Frontend:** Bootstrap 5 dark theme, Chart.js, vanilla JS — single-page, no build step
- **Notifications:** Pushover API
- **Deployment:** Docker Compose, port 7002, `./data/` volume for persistence

## Key files

```
main.py                   Entry point — starts Flask on 0.0.0.0:7002
app/__init__.py           App factory — inits DB, registers blueprint, starts scheduler
app/db.py                 All SQLite queries (routes, price_history, settings tables)
app/search.py             fli library wrapper — always searches one-way legs
app/scheduler.py          APScheduler background poller + Pushover alert logic
app/pushover.py           Pushover notification helper
app/api.py                Flask blueprint — all REST endpoints + page route
app/templates/index.html  Full single-page UI (Bootstrap 5)
app/static/js/app.js      Frontend logic — rendering, charts, trip builder
app/static/css/style.css  Dark theme styles
Dockerfile                python:3.12-slim, port 7002
docker-compose.yml        Volume, env vars, restart policy
```

## Database schema

```
routes          id, trip_id, leg_label, origin, destination, departure_date,
                non_stop_only, airlines (JSON), adults, seat_type, active,
                created_at, day_offset (-1/0/+1)

price_history   id, route_id, price, currency, flight_details (JSON), checked_at

settings        key, value  (poll_interval_minutes)
```

## API endpoints

```
GET  /                          Web UI
GET  /api/routes                List routes with latest price, stats, trend
                                ?include_archived=1 to include inactive
POST /api/routes                Add route(s) — creates 3 date variants (-1/0/+1 day)
DELETE /api/routes/<id>         Delete single route
DELETE /api/routes/batch        Delete multiple routes {ids: [...]}
POST /api/routes/archive-past   Set active=0 for all past-date routes
GET  /api/routes/archived-count Count of archived routes
GET  /api/routes/<id>/history   Full price history for one route
POST /api/poll                  Trigger immediate price check (background thread)
POST /api/notify/test           Send Pushover test notification
GET  /api/settings              Get poll_interval_minutes
POST /api/settings              Update poll_interval_minutes
```

## How routes work

Every time a user adds a route, the backend creates **3 route records** sharing a `trip_id`:
- `day_offset = -1` — day before chosen date
- `day_offset = 0`  — chosen date
- `day_offset = +1` — day after chosen date

Round trips create 6 records (3 outbound + 3 return), all under the same `trip_id`.
The scheduler always searches each record as a **one-way leg** regardless of trip type.

## Environment variables (docker-compose.yml)

```
PUSHOVER_TOKEN          Pushover app token (optional — alerts disabled if blank)
PUSHOVER_USER           Pushover user key
POLL_INTERVAL_MINUTES   Default 480 (every 8 hours). Overridden by DB settings table.
TZ                      America/Los_Angeles
DB_PATH                 /config/flights.db
```

## Local dev

```bash
pip install -r requirements.txt
python main.py          # runs on http://localhost:7002
```

Data will be written to `./data/flights.db` (auto-created).

## Docker

```bash
docker compose up -d --build    # build and start
docker logs fp-tracker          # view logs
docker compose down             # stop
```

## Updating (on Unraid)

```bash
cd /mnt/user/appdata/fp-tracker
git pull
docker compose up -d --build
```

Price history in `./data/` is preserved across rebuilds.

## Branch

Active development branch: `claude/flight-price-tracker-app-GxSgz`
