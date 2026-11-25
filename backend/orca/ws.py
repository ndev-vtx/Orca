"""
ws.py
WebSocket fan-out for Orca.

One channel, one message shape: every push is a JSON object with a `type` and a
`payload`. The frontend subscribes for library mutations and playback notices so
multiple tabs stay in sync without polling.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional, Set

from fastapi import WebSocket

log = logging.getLogger(__name__)


class ConnectionManager:
    """Tracks live sockets and broadcasts from both async and worker threads."""

    def __init__(self) -> None:
        self._clients: Set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def capture_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Called once at app startup so sync endpoints can push events."""
        self._loop = loop

    @property
    def count(self) -> int:
        return len(self._clients)

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._clients.add(websocket)
        log.debug("ws client connected (%d live)", self.count)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(websocket)
        log.debug("ws client disconnected (%d live)", self.count)

    async def broadcast(self, message: Dict[str, Any]) -> None:
        """Send one JSON message to every live client; dead sockets are dropped."""
        async with self._lock:
            targets = list(self._clients)
        if not targets:
            return
        dead = []
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:  # noqa: BLE001 - a dead socket must not break the rest
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)

    def broadcast_threadsafe(self, message: Dict[str, Any]) -> None:
        """Fire-and-forget broadcast from a sync (threadpool) endpoint."""
        if self._loop is None or self._loop.is_closed():
            log.debug("no running loop; dropping ws broadcast %s", message.get("type"))
            return
        try:
            asyncio.run_coroutine_threadsafe(self.broadcast(message), self._loop)
        except RuntimeError as exc:
            log.debug("broadcast could not be scheduled: %s", exc)


manager = ConnectionManager()
