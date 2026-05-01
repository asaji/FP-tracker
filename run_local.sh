#!/bin/bash
export DB_PATH=/tmp/fp-tracker/flights.db
export TZ=America/Los_Angeles
export POLL_INTERVAL_MINUTES=480

mkdir -p /tmp/fp-tracker

exec .venv/bin/python main.py
