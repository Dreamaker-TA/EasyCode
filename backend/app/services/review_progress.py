"""In-process review progress registry for SSE replay.

The review pipeline runs in Starlette's threadpool while SSE endpoints run on
the event loop, so this module uses a plain ``threading.Lock`` around a small
dict/list registry. It is intentionally process-local; multi-instance pub/sub is
out of scope for the current single-user deployment.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from threading import Lock

RETAIN_DONE_FOR = timedelta(minutes=10)


@dataclass
class _StreamState:
    events: list[dict] = field(default_factory=list)
    done_at: datetime | None = None


_lock = Lock()
_streams: dict[str, _StreamState] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_utc(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _sweep_expired_locked(now: datetime) -> int:
    expired = [
        submission_id
        for submission_id, state in _streams.items()
        if state.done_at is not None and state.done_at <= now - RETAIN_DONE_FOR
    ]
    for submission_id in expired:
        _streams.pop(submission_id, None)
    return len(expired)


def sweep_expired(now: datetime | None = None) -> int:
    """Drop terminal streams whose retention window has elapsed."""

    ts = now or _now()
    with _lock:
        return _sweep_expired_locked(ts)


def publish(
    submission_id: str,
    stage: str,
    detail: dict | None = None,
    *,
    reset: bool = False,
    now: datetime | None = None,
) -> dict:
    """Append one progress event and return the event payload."""

    ts = now or _now()
    event = {"stage": stage, "detail": detail, "ts": _iso_utc(ts)}
    with _lock:
        _sweep_expired_locked(ts)
        if reset:
            _streams[submission_id] = _StreamState()
        state = _streams.setdefault(submission_id, _StreamState())
        state.events.append(event)
        if stage == "done":
            state.done_at = ts
    return dict(event)


def replay(
    submission_id: str,
    since_index: int = 0,
    *,
    now: datetime | None = None,
) -> list[dict]:
    """Return a snapshot of events from ``since_index`` onward."""

    with _lock:
        _sweep_expired_locked(now or _now())
        state = _streams.get(submission_id)
        if state is None:
            return []
        return [dict(event) for event in state.events[since_index:]]


def has_stream(submission_id: str, *, now: datetime | None = None) -> bool:
    with _lock:
        _sweep_expired_locked(now or _now())
        return submission_id in _streams


async def subscribe(
    submission_id: str,
    *,
    close_if_empty: bool = False,
    poll_interval: float = 0.3,
    heartbeat_interval: float = 15.0,
) -> AsyncIterator[dict | None]:
    """Yield progress events, using ``None`` as a keepalive sentinel."""

    cursor = 0
    last_heartbeat = time.monotonic()
    while True:
        events = replay(submission_id, cursor)
        if events:
            cursor += len(events)
            for event in events:
                yield event
                if event.get("stage") == "done":
                    return
            continue

        if close_if_empty and cursor == 0 and not has_stream(submission_id):
            return

        now = time.monotonic()
        if now - last_heartbeat >= heartbeat_interval:
            last_heartbeat = now
            yield None
            continue

        await asyncio.sleep(poll_interval)


def _clear_for_tests() -> None:
    with _lock:
        _streams.clear()
