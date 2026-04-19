import os
import logging
import requests

logger = logging.getLogger(__name__)
PUSHOVER_URL = 'https://api.pushover.net/1/messages.json'


def send_pushover(message: str, title: str = 'Flight Price Alert') -> bool:
    token = os.environ.get('PUSHOVER_TOKEN', '').strip()
    user = os.environ.get('PUSHOVER_USER', '').strip()
    if not token or not user:
        logger.debug("Pushover not configured, skipping notification")
        return False
    try:
        resp = requests.post(PUSHOVER_URL, data={
            'token': token,
            'user': user,
            'message': message,
            'title': title,
        }, timeout=10)
        if resp.status_code != 200:
            logger.error("Pushover error %s: %s", resp.status_code, resp.text)
        return resp.status_code == 200
    except Exception as e:
        logger.error("Pushover request failed: %s", e)
        return False
