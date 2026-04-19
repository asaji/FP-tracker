import json
import logging
import os

from apscheduler.schedulers.background import BackgroundScheduler

logger = logging.getLogger(__name__)
_scheduler: BackgroundScheduler | None = None
JOB_ID = 'poll_flights'


def start_scheduler(app):
    global _scheduler
    if _scheduler is not None:
        return

    db_path = app.config['DB_PATH']

    from .db import get_setting, set_setting
    default_interval = os.environ.get('POLL_INTERVAL_MINUTES', '480')
    interval = int(get_setting(db_path, 'poll_interval_minutes', default_interval))
    set_setting(db_path, 'poll_interval_minutes', str(interval))

    _scheduler = BackgroundScheduler(timezone='America/Los_Angeles')
    _scheduler.add_job(
        check_all_routes,
        trigger='interval',
        minutes=interval,
        args=[db_path],
        id=JOB_ID,
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("Scheduler started; polling every %d minutes", interval)


def reschedule(db_path: str, interval_minutes: int):
    global _scheduler
    if _scheduler and _scheduler.get_job(JOB_ID):
        _scheduler.reschedule_job(JOB_ID, trigger='interval', minutes=interval_minutes)
        logger.info("Rescheduled to every %d minutes", interval_minutes)


def check_all_routes(db_path: str):
    from .db import get_active_routes, save_price_history, get_last_price
    from .search import search_route
    from .pushover import send_pushover

    routes = get_active_routes(db_path)
    if not routes:
        return

    logger.info("Polling prices for %d routes", len(routes))
    for route in routes:
        try:
            airlines = json.loads(route['airlines']) if route['airlines'] else None
            result = search_route(
                origin=route['origin'],
                destination=route['destination'],
                departure_date=route['departure_date'],
                adults=route['adults'],
                non_stop_only=bool(route['non_stop_only']),
                airlines=airlines,
                seat_type=route['seat_type'],
            )

            last_price = get_last_price(db_path, route['id'])

            if result:
                price = result['price']
                details = json.dumps({
                    'duration': result.get('duration'),
                    'stops': result.get('stops'),
                    'legs': result.get('legs', []),
                })
                save_price_history(db_path, route['id'], price, 'USD', details)

                if last_price is not None and price != last_price:
                    diff = price - last_price
                    airlines_str = ', '.join(airlines) if airlines else 'any airline'
                    direction = 'dropped' if diff < 0 else 'increased'
                    msg = (
                        f"{route['origin']} → {route['destination']}  |  {route['departure_date']}\n"
                        f"Price {direction} by ${abs(diff):.0f}  "
                        f"(was ${last_price:.0f}, now ${price:.0f})\n"
                        f"{route['seat_type'].title()} · {airlines_str}"
                    )
                    icon = '📉' if diff < 0 else '📈'
                    send_pushover(msg, title=f"{icon} Flight Price {direction.title()}")
            else:
                save_price_history(db_path, route['id'], None, 'USD', None)

        except Exception:
            logger.exception("Error checking route id=%s", route['id'])
