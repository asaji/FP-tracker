import json
import threading
from datetime import datetime, timedelta
from flask import Blueprint, current_app, jsonify, render_template, request

from .db import (
    add_route, archive_past_routes, count_archived_routes,
    create_named_trip, delete_named_trip, delete_route, delete_routes_batch,
    get_all_routes, get_best_combo, get_latest_price_for_routes,
    get_named_trips, get_previous_price_for_routes,
    get_price_history, get_price_stats_for_routes,
    get_setting, next_trip_id, set_setting, update_named_trip,
)
from .pushover import send_pushover
from .scheduler import check_all_routes, reschedule

bp = Blueprint('api', __name__)

_TODAY = lambda: datetime.now().strftime('%Y-%m-%d')


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
    include_archived = request.args.get('include_archived', '0') == '1'
    routes = get_all_routes(_db(), include_archived=include_archived)
    ids = [r['id'] for r in routes]
    latest = get_latest_price_for_routes(_db(), ids)
    prev   = get_previous_price_for_routes(_db(), ids)
    stats  = get_price_stats_for_routes(_db(), ids)
    today  = _TODAY()

    result = []
    for r in routes:
        rid = r['id']
        lp  = latest.get(rid)
        entry = dict(r)
        entry['airlines'] = json.loads(r['airlines']) if r['airlines'] else []
        entry['is_past']  = r['departure_date'] < today
        if lp:
            entry['current_price']  = lp['price']
            entry['last_checked']   = lp['checked_at']
            entry['flight_details'] = json.loads(lp['flight_details']) if lp['flight_details'] else None
        else:
            entry['current_price']  = None
            entry['last_checked']   = None
            entry['flight_details'] = None
        entry['prev_price'] = prev.get(rid)
        s = stats.get(rid, {})
        entry['price_min']   = s.get('price_min')
        entry['price_max']   = s.get('price_max')
        entry['price_avg']   = s.get('price_avg')
        entry['price_count'] = s.get('price_count', 0)
        entry['trend']       = s.get('trend', 'unknown')
        result.append(entry)

    return jsonify(result)


@bp.route('/api/routes', methods=['POST'])
def create_routes():
    data = request.get_json(force=True)
    trip_type     = data.get('trip_type', 'one_way')
    adults        = int(data.get('adults', 1))
    seat_type     = data.get('seat_type', 'ECONOMY').upper()
    non_stop      = bool(data.get('non_stop_only', False))
    airlines      = [a.strip().upper() for a in data.get('airlines', []) if a.strip()] or None
    named_trip_id = data.get('named_trip_id') or None
    if named_trip_id is not None:
        named_trip_id = int(named_trip_id)

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
                named_trip_id=named_trip_id,
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


@bp.route('/api/routes/archive-past', methods=['POST'])
def archive_past():
    count = archive_past_routes(_db())
    return jsonify({'archived': count})


@bp.route('/api/routes/archived-count', methods=['GET'])
def archived_count():
    return jsonify({'count': count_archived_routes(_db())})


# ── Price history ──────────────────────────────────────────────────────────

@bp.route('/api/routes/<int:route_id>/history', methods=['GET'])
def route_history(route_id: int):
    history = get_price_history(_db(), route_id)
    for h in history:
        h['flight_details'] = json.loads(h['flight_details']) if h['flight_details'] else None
    return jsonify(history)


# ── Named Trips ────────────────────────────────────────────────────────────

@bp.route('/api/named-trips', methods=['GET'])
def list_named_trips():
    trips = get_named_trips(_db())
    result = []
    for t in trips:
        entry = dict(t)
        combo = get_best_combo(_db(), t['id'])
        entry['best_combo'] = combo
        if t['budget'] and combo['has_prices']:
            entry['budget_remaining'] = round(t['budget'] - combo['total'], 2)
        else:
            entry['budget_remaining'] = None
        result.append(entry)
    return jsonify(result)


@bp.route('/api/named-trips', methods=['POST'])
def create_trip():
    data = request.get_json(force=True)
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    budget = data.get('budget')
    if budget is not None:
        budget = float(budget)
    trip_id = create_named_trip(
        _db(), name,
        notes=data.get('notes') or None,
        budget=budget,
        color=data.get('color', '#00cfe0'),
    )
    return jsonify({'id': trip_id}), 201


@bp.route('/api/named-trips/<int:trip_id>', methods=['PUT'])
def update_trip(trip_id: int):
    data = request.get_json(force=True)
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    budget = data.get('budget')
    if budget is not None:
        budget = float(budget)
    update_named_trip(
        _db(), trip_id, name,
        notes=data.get('notes') or None,
        budget=budget,
        color=data.get('color', '#00cfe0'),
    )
    return jsonify({'ok': True})


@bp.route('/api/named-trips/<int:trip_id>', methods=['DELETE'])
def remove_trip(trip_id: int):
    delete_named_trip(_db(), trip_id)
    return jsonify({'ok': True})


@bp.route('/api/named-trips/<int:trip_id>/combo', methods=['GET'])
def trip_combo(trip_id: int):
    combo = get_best_combo(_db(), trip_id)
    return jsonify(combo)


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
