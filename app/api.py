import json
import threading
from datetime import datetime, timedelta
from flask import Blueprint, current_app, jsonify, render_template, request

from .db import (
    add_route, delete_route, delete_routes_batch, get_all_routes,
    get_latest_price_for_routes, get_previous_price_for_routes,
    get_price_history, get_setting, next_trip_id, set_setting,
)
from .pushover import send_pushover
from .scheduler import check_all_routes, reschedule

bp = Blueprint('api', __name__)


def _db():
    return current_app.config['DB_PATH']


def _date_variants(date_str: str) -> list[tuple[str, int]]:
    base = datetime.strptime(date_str, '%Y-%m-%d')
    return [
        ((base + timedelta(days=offset)).strftime('%Y-%m-%d'), offset)
        for offset in (-1, 0, 1)
    ]


# ── Pages ──────────────────────────────────────────────────────────────────

@bp.route('/')
def index():
    return render_template('index.html')


# ── Routes ─────────────────────────────────────────────────────────────────

@bp.route('/api/routes', methods=['GET'])
def list_routes():
    routes = get_all_routes(_db())
    ids = [r['id'] for r in routes]
    latest = get_latest_price_for_routes(_db(), ids)
    prev = get_previous_price_for_routes(_db(), ids)

    result = []
    for r in routes:
        rid = r['id']
        lp = latest.get(rid)
        entry = dict(r)
        entry['airlines'] = json.loads(r['airlines']) if r['airlines'] else []
        if lp:
            entry['current_price'] = lp['price']
            entry['last_checked'] = lp['checked_at']
            entry['flight_details'] = json.loads(lp['flight_details']) if lp['flight_details'] else None
        else:
            entry['current_price'] = None
            entry['last_checked'] = None
            entry['flight_details'] = None
        entry['prev_price'] = prev.get(rid)
        result.append(entry)

    return jsonify(result)


@bp.route('/api/routes', methods=['POST'])
def create_routes():
    data = request.get_json(force=True)
    trip_type = data.get('trip_type', 'one_way')
    adults = int(data.get('adults', 1))
    seat_type = data.get('seat_type', 'ECONOMY').upper()
    non_stop = bool(data.get('non_stop_only', False))
    airlines = [a.strip().upper() for a in data.get('airlines', []) if a.strip()] or None

    created = []
    tid = next_trip_id(_db())

    legs = [('outbound', data.get('outbound', data))]
    if trip_type == 'round_trip' and data.get('return'):
        legs.append(('return', data['return']))

    for leg_label, seg in legs:
        for date_str, offset in _date_variants(seg['departure_date']):
            rid = add_route(
                _db(), tid, leg_label,
                seg['origin'], seg['destination'], date_str,
                non_stop, airlines, adults, seat_type, offset,
            )
            created.append(rid)

    return jsonify({'created': created}), 201


@bp.route('/api/routes/<int:route_id>', methods=['DELETE'])
def remove_route(route_id: int):
    delete_route(_db(), route_id)
    return jsonify({'deleted': route_id})


@bp.route('/api/routes/batch', methods=['DELETE'])
def remove_routes_batch():
    data = request.get_json(force=True)
    ids = [int(i) for i in data.get('ids', [])]
    delete_routes_batch(_db(), ids)
    return jsonify({'deleted': ids})


# ── Price history ──────────────────────────────────────────────────────────

@bp.route('/api/routes/<int:route_id>/history', methods=['GET'])
def route_history(route_id: int):
    history = get_price_history(_db(), route_id)
    for h in history:
        h['flight_details'] = json.loads(h['flight_details']) if h['flight_details'] else None
    return jsonify(history)


# ── Manual poll ────────────────────────────────────────────────────────────

@bp.route('/api/poll', methods=['POST'])
def manual_poll():
    db = _db()
    threading.Thread(target=check_all_routes, args=(db,), daemon=True).start()
    return jsonify({'status': 'started'})


# ── Notifications ──────────────────────────────────────────────────────────

@bp.route('/api/notify/test', methods=['POST'])
def test_notification():
    ok = send_pushover(
        'Your Flight Price Tracker notifications are working correctly.',
        title='✈ Test Notification'
    )
    if ok:
        return jsonify({'status': 'sent'})
    return jsonify({'status': 'error', 'detail': 'Pushover not configured or request failed'}), 400


# ── Settings ───────────────────────────────────────────────────────────────

@bp.route('/api/settings', methods=['GET'])
def get_settings():
    interval = int(get_setting(_db(), 'poll_interval_minutes', '480'))
    return jsonify({'poll_interval_minutes': interval})


@bp.route('/api/settings', methods=['POST'])
def update_settings():
    data = request.get_json(force=True)
    interval = int(data.get('poll_interval_minutes', 480))
    interval = max(15, min(interval, 10080))
    set_setting(_db(), 'poll_interval_minutes', str(interval))
    reschedule(_db(), interval)
    return jsonify({'poll_interval_minutes': interval})
