"""
turso.py
A tiny standard-library client for Turso (libSQL) over its HTTP v2 pipeline
API. When ORCA_TURSO_DATABASE_URL (and ORCA_TURSO_AUTH_TOKEN) are set, the
storage layer runs on Turso instead of the ephemeral per-instance /tmp
SQLite — one shared database across every Vercel serverless instance, so
accounts, tokens, favorites and playlists survive across instances and
cold starts.

The adapter mimics the small sqlite3 surface OrcaStorage actually uses:
context-manager connections, execute(sql, params) cursors with
fetchone()/fetchall()/lastrowid/rowcount, executemany(), commit(), and
Row objects addressable by column name or index.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

log = logging.getLogger(__name__)

TURSO_URL_ENV = "ORCA_TURSO_DATABASE_URL"
TURSO_TOKEN_ENV = "ORCA_TURSO_AUTH_TOKEN"

_HTTP_TIMEOUT_S = 15.0
_ATTEMPTS = 2


def turso_config() -> Optional[Tuple[str, str]]:
    """Return (url, token) when Turso is configured, else None."""
    url = (os.environ.get(TURSO_URL_ENV) or "").strip()
    token = (os.environ.get(TURSO_TOKEN_ENV) or "").strip()
    if url:
        return url, token
    return None


def _arg(value: Any) -> Dict[str, Any]:
    """Encode a Python parameter as a Turso pipeline argument."""
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "integer", "value": "1" if value else "0"}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        return {"type": "float", "value": repr(value)}
    if isinstance(value, (bytes, bytearray)):
        return {"type": "blob", "value": base64.b64encode(bytes(value)).decode("ascii")}
    return {"type": "str", "value": str(value)}


class TursoRow(dict):
    """A result row addressable by column name or positional index."""

    def __init__(self, columns: Sequence[str], values: Sequence[Any]) -> None:
        super().__init__(zip(columns, values))
        self._values = list(values)

    def __getitem__(self, key: Any) -> Any:  # type: ignore[override]
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)

    def get(self, key: str, default: Any = None) -> Any:
        return super().get(key, default)


class TursoCursor:
    """Mimics the sqlite3 cursor members OrcaStorage touches."""

    def __init__(self, rows: List[TursoRow], lastrowid: int, rowcount: int) -> None:
        self._rows = rows
        self._index = 0
        self.lastrowid = lastrowid
        self.rowcount = rowcount

    def fetchone(self) -> Optional[TursoRow]:
        if self._index >= len(self._rows):
            return None
        row = self._rows[self._index]
        self._index += 1
        return row

    def fetchall(self) -> List[TursoRow]:
        remaining = self._rows[self._index :]
        self._index = len(self._rows)
        return remaining


class TursoConnection:
    """Single-use connection object speaking Turso's v2 pipeline API."""

    def __init__(self, url: str, token: str) -> None:
        self._url = url.rstrip("/") + "/v2/pipeline"
        self._token = token

    # -- context manager (transactions are per-request; commit is a no-op) ----
    def __enter__(self) -> "TursoConnection":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        return False

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def close(self) -> None:
        pass

    # -- internals -----------------------------------------------------------
    def _post(self, statements: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        payload = json.dumps({"requests": statements}).encode("utf-8")
        last_exc: Optional[Exception] = None
        for attempt in range(1, _ATTEMPTS + 1):
            try:
                req = UrlRequest(
                    self._url,
                    data=payload,
                    headers={
                        "Authorization": f"Bearer {self._token}",
                        "Content-Type": "application/json",
                    },
                    method="POST",
                )
                with urlopen(req, timeout=_HTTP_TIMEOUT_S) as resp:  # noqa: S310 - https API
                    body = json.loads(resp.read().decode("utf-8"))
                break
            except Exception as exc:  # noqa: BLE001 - retried once below
                last_exc = exc
                if attempt < _ATTEMPTS:
                    time.sleep(0.3 * attempt)
        else:
            raise ConnectionError(f"turso request failed: {last_exc}")

        results = body.get("results") or []
        out: List[Dict[str, Any]] = []
        for result in results:
            if result.get("type") == "error":
                message = (result.get("error") or {}).get("message", "unknown turso error")
                raise RuntimeError(f"turso statement failed: {message}")
            response = result.get("response") or {}
            out.append(response.get("result") or {})
        return out

    # -- sqlite3-compatible surface -------------------------------------------
    def execute(self, sql: str, params: Sequence[Any] = ()) -> TursoCursor:
        text = (sql or "").strip()
        upper = text.upper()

        # WAL/diagnostic pragmas make no sense over the HTTP API.
        if upper.startswith("PRAGMA JOURNAL_MODE"):
            return TursoCursor([TursoRow(["journal_mode"], ["wal"])], 0, 0)

        statements = [
            {
                "type": "execute",
                "stmt": {"sql": text, "args": [_arg(p) for p in params]},
            }
        ]

        # INSERT/UPDATE/DELETE without RETURNING: piggyback lastrowid/changes
        # as a second statement inside the same pipeline (atomic batch).
        wants_meta = upper.startswith(("INSERT", "UPDATE", "DELETE", "REPLACE")) and (
            "RETURNING" not in upper
        )
        if wants_meta:
            statements.append(
                {
                    "type": "execute",
                    "stmt": {
                        "sql": "SELECT last_insert_rowid() AS lastrowid, changes() AS rowcount",
                        "args": [],
                    },
                }
            )

        results = self._post(statements)

        rows: List[TursoRow] = []
        lastrowid = 0
        rowcount = 0
        if results:
            first = results[0]
            columns = [c.get("name", "") for c in first.get("cols") or []]
            rows = [TursoRow(columns, values) for values in first.get("rows") or []]
        if wants_meta and len(results) > 1:
            meta = results[1]
            meta_cols = [c.get("name", "") for c in meta.get("cols") or []]
            meta_rows = meta.get("rows") or []
            if meta_rows:
                lookup = dict(zip(meta_cols, meta_rows[0]))
                try:
                    lastrowid = int(lookup.get("lastrowid") or 0)
                except (TypeError, ValueError):
                    lastrowid = 0
                try:
                    rowcount = int(lookup.get("rowcount") or 0)
                except (TypeError, ValueError):
                    rowcount = 0
        return TursoCursor(rows, lastrowid, rowcount)

    def executemany(self, sql: str, seq: Sequence[Sequence[Any]]) -> TursoCursor:
        cursor = TursoCursor([], 0, 0)
        for params in seq:
            cursor = self.execute(sql, params)
        return cursor
