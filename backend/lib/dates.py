"""Server-side date helpers. The pod clock is UTC — anchor "today" here, never in the browser."""

import os
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def app_zone() -> ZoneInfo:
    """Business timezone (toko beroperasi di WIB)."""
    return ZoneInfo(os.environ.get("APP_TZ", "Asia/Jakarta"))


def today_iso(tz: str | None = None) -> str:
    """Today's date as YYYY-MM-DD in `tz` (default: APP_TZ env, else UTC)."""
    zone = ZoneInfo(tz) if tz else app_zone()
    return datetime.now(zone).strftime("%Y-%m-%d")


def now_app() -> datetime:
    return datetime.now(app_zone())


def range_bounds_utc(from_s: str | None, to_s: str | None, default_days: int = 30) -> tuple[datetime, datetime]:
    """Inclusive app-tz date range (YYYY-MM-DD) → aware-UTC [start, end) window for Mongo queries."""
    zone = app_zone()
    today = datetime.now(zone).date()
    d_from = date.fromisoformat(from_s) if from_s else today - timedelta(days=default_days - 1)
    d_to = date.fromisoformat(to_s) if to_s else today
    start = datetime(d_from.year, d_from.month, d_from.day, tzinfo=zone).astimezone(timezone.utc)
    end_day = d_to + timedelta(days=1)
    end = datetime(end_day.year, end_day.month, end_day.day, tzinfo=zone).astimezone(timezone.utc)
    return start, end


def day_start_utc(d: date) -> datetime:
    zone = app_zone()
    return datetime(d.year, d.month, d.day, tzinfo=zone).astimezone(timezone.utc)
