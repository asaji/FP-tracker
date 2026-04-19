import os
from flask import Flask
from .db import init_db
from .scheduler import start_scheduler


def create_app():
    app = Flask(__name__, template_folder='templates', static_folder='static')

    db_path = os.environ.get('DB_PATH', 'data/flights.db')
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    app.config['DB_PATH'] = db_path

    init_db(db_path)

    from .api import bp as api_bp
    app.register_blueprint(api_bp)

    start_scheduler(app)

    return app
