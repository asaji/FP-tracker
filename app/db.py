import sqlite3
import json
from datetime import datetime, timezone


def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: str):
    _migrate(db_path)
    with _connect(db_path) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS routes (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                trip_id       INTEGER,
                leg_label     TEXT    NOT NULL DEFAULT 'outbound',
                origin        TEXT    NOT NULL,
                destination   TEXT    NOT NULL,
                departure_date TEXT   NOT NULL,
                non_stop_only INTEGER NOT NULL DEFAULT 0,
                airlines      TEXT,
                adults        INTEGER NOT NULL DEFAULT 1,
                seat_type     TEXT    NOT NULL DEFAULT 'ECONOMY',
                active        INTEGER NOT NULL DEFAULT 1,
                created_at    TEXT    NOT NULL,
                day_offset    INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS price_history (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                route_id       INTEGER NOT NULL,
                price          REAL,
                currency       TEXT    NOT NULL DEFAULT 'USD',
                flight_details TEXT,
                checked_at     TEXT    NOT NULL,
                FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)


def _migrate(db_path: str):
    with _connect(db_path) as conn:
        for stmt in [
            "ALTER TABLE routes ADD COLUMN day_offset INTEGER NOT NULL DEFAULT 0",
        ]:
            try:
                conn.execute(stmt)
            except Exception:
                pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Routes ─────────────────────────────────────────────────────────────────

def get_active_routes(db_path: str) -> list[dict]:
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM routes WHERE active = 1 ORDER BY trip_id, leg_label, id"
        ).fetchall()
    return [dict(r) for r in rows]


def get_all_routes(db_path: str, include_archived: bool = False) -> list[dict]:
    where = "" if include_archived else "WHERE active = 1"
    with _connect(db_path) as conn:
        rows = conn.execute(
            f"SELECT * FROM routes {where} ORDER BY trip_id, leg_label, id"
        ).fetchall()
    return [dict(r) for r in rows]


def archive_past_routes(db_path: str) -> int:
    today = datetime.now().strftime('%Y-%m-%d')
    with _connect(db_path) as conn:
        cur = conn.execute(
            "UPDATE routes SET active = 0 WHERE departure_date < ? AND active = 1",
            (today,)
        )
    return cur.rowcount


def count_archived_routes(db_path: str) -> int:
    with _connect(db_path) as conn:
        row = conn.execute("SELECT COUNT(*) FROM routes WHERE active = 0").fetchone()
    return row[0]


def add_route(db_path: str, trip_id: int | None, leg_label: str, origin: str,
              destination: str, departure_date: str, non_stop_only: bool,
              airlines: list | None, adults: int, seat_type: str,
              day_offset: int = 0) -> int:
    with _connect(db_path) as conn:
        cur = conn.execute(
            """INSERT INTO routes
               (trip_id, leg_label, origin, destination, departure_date,
                non_stop_only, airlines, adults, seat_type, active, created_at, day_offset)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)""",
            (trip_id, leg_label, origin.upper(), destination.upper(),
             departure_date, int(non_stop_only),
             json.dumps(airlines) if airlines else None,
             adults, seat_type, _now(), day_offset)
        )
    return cur.lastrowid


def delete_routes_batch(db_path: str, route_ids: list[int]):
    if not route_ids:
        return
    placeholders = ','.join('?' * len(route_ids))
    with _connect(db_path) as conn:
        conn.execute(f"DELETE FROM routes WHERE id IN ({placeholders})", route_ids)


def next_trip_id(db_path: str) -> int:
    with _connect(db_path) as conn:
        row = conn.execute("SELECT MAX(trip_id) FROM routes").fetchone()
    return (row[0] or 0) + 1


def delete_route(db_path: str, route_id: int):
    with _connect(db_path) as conn:
        conn.execute("DELETE FROM routes WHERE id = ?", (route_id,))


# ── Price history ──────────────────────────────────────────────────────────

def save_price_history(db_path: str, route_id: int, price: float | None,
                       currency: str, flight_details: str | None):
    with _connect(db_path) as conn:
        conn.execute(
            """INSERT INTO price_history (route_id, price, currency, flight_details, checked_at)
               VALUES (?, ?, ?, ?, ?)""",
            (route_id, price, currency, flight_details, _now())
        )


def get_last_price(db_path: str, route_id: int) -> float | None:
    with _connect(db_path) as conn:
        row = conn.execute(
            """SELECT price FROM price_history
               WHERE route_id = ? AND price IS NOT NULL
               ORDER BY checked_at DESC LIMIT 1""",
            (route_id,)
        ).fetchone()
    return row['price'] if row else None


def get_price_history(db_path: str, route_id: int) -> list[dict]:
    with _connect(db_path) as conn:
        rows = conn.execute(
            """SELECT price, currency, flight_details, checked_at
               FROM price_history
               WHERE route_id = ?
               ORDER BY checked_at ASC""",
            (route_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_latest_price_for_routes(db_path: str, route_ids: list[int]) -> dict[int, dict]:
    if not route_ids:
        return {}
    placeholders = ','.join('?' * len(route_ids))
    with _connect(db_path) as conn:
        rows = conn.execute(
            f"""SELECT ph.route_id, ph.price, ph.currency, ph.flight_details, ph.checked_at
                FROM price_history ph
                INNER JOIN (
                    SELECT route_id, MAX(checked_at) AS max_checked
                    FROM price_history
                    GROUP BY route_id
                ) latest ON ph.route_id = latest.route_id AND ph.checked_at = latest.max_checked
                WHERE ph.route_id IN ({placeholders})""",
            route_ids
        ).fetchall()
    return {r['route_id']: dict(r) for r in rows}


def get_previous_price_for_routes(db_path: str, route_ids: list[int]) -> dict[int, float | None]:
    """Returns the second-to-last price per route for change indicators."""
    if not route_ids:
        return {}
    result = {}
    with _connect(db_path) as conn:
        for rid in route_ids:
            rows = conn.execute(
                """SELECT price FROM price_history
                   WHERE route_id = ? AND price IS NOT NULL
                   ORDER BY checked_at DESC LIMIT 2""",
                (rid,)
            ).fetchall()
            result[rid] = rows[1]['price'] if len(rows) >= 2 else None
    return result


def get_price_stats_for_routes(db_path: str, route_ids: list[int]) -> dict[int, dict]:
    if not route_ids:
        return {}
    placeholders = ','.join('?' * len(route_ids))
    with _connect(db_path) as conn:
        stats_rows = conn.execute(
            f"""SELECT route_id,
                       MIN(price)          AS price_min,
                       MAX(price)          AS price_max,
                       ROUND(AVG(price),0) AS price_avg,
                       COUNT(price)        AS price_count
                FROM price_history
                WHERE route_id IN ({placeholders}) AND price IS NOT NULL
                GROUP BY route_id""",
            route_ids,
        ).fetchall()

        recent_rows = conn.execute(
            f"""SELECT route_id, price
                FROM price_history
                WHERE route_id IN ({placeholders}) AND price IS NOT NULL
                ORDER BY route_id, checked_at DESC""",
            route_ids,
        ).fetchall()

    stats = {r['route_id']: dict(r) for r in stats_rows}

    recent: dict[int, list[float]] = {}
    for row in recent_rows:
        rid = row['route_id']
        if rid not in recent:
            recent[rid] = []
        if len(recent[rid]) < 5:
            recent[rid].append(row['price'])

    result = {}
    for rid in route_ids:
        s = stats.get(rid, {})
        result[rid] = {
            'price_min':   s.get('price_min'),
            'price_max':   s.get('price_max'),
            'price_avg':   s.get('price_avg'),
            'price_count': s.get('price_count', 0),
            'trend':       _compute_trend(recent.get(rid, [])),
        }
    return result


def _compute_trend(prices: list[float]) -> str:
    if len(prices) < 3:
        return 'unknown'
    newest, oldest = prices[0], prices[-1]
    if oldest == 0:
        return 'unknown'
    pct = (newest - oldest) / oldest * 100
    if pct > 2:
        return 'rising'
    if pct < -2:
        return 'falling'
    return 'stable'


# ── Settings ───────────────────────────────────────────────────────────────

def get_setting(db_path: str, key: str, default: str) -> str:
    with _connect(db_path) as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row['value'] if row else default


def set_setting(db_path: str, key: str, value: str):
    with _connect(db_path) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value)
        )
