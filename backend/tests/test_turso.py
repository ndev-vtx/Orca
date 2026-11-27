"""
test_turso.py
The Turso (libSQL) HTTP adapter: schema creation, query roundtrips,
lastrowid/rowcount piggybacking, and OrcaStorage running end-to-end on a
fake Turso backend instead of SQLite.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

import orca.storage as storage_mod
from orca.storage import OrcaStorage
from orca.turso import TursoConnection


class _FakeTurso:
    """A thread-local fake Turso HTTP server backed by a real SQLite file."""

    def __init__(self) -> None:
        import sqlite3
        import tempfile
        from pathlib import Path

        self.db = sqlite3.connect(":memory:", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        db = self.db  # closure reference for the request handler

        def _decode(arg):
            kind = arg.get("type")
            if kind == "null":
                return None
            if kind == "integer":
                return int(arg["value"])
            if kind == "float":
                return float(arg["value"])
            return arg["value"]

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                results = []
                for request in body.get("requests") or []:
                    if request.get("type") != "execute":
                        results.append({"type": "error", "error": {"message": "unsupported"}})
                        continue
                    stmt = request.get("stmt") or {}
                    sql = stmt.get("sql", "")
                    args = stmt.get("args") or []
                    try:
                        cursor = db.execute(sql, [_decode(a) for a in args])
                        cols = [d[0] for d in cursor.description] if cursor.description else []
                        rows = [list(r) for r in cursor.fetchall()]
                        results.append(
                            {
                                "type": "ok",
                                "response": {
                                    "result": {
                                        "cols": [{"name": c, "decltype": ""} for c in cols],
                                        "rows": rows,
                                        "rows_read": len(rows),
                                        "rows_written": 0,
                                    }
                                },
                            }
                        )
                    except Exception as exc:  # noqa: BLE001
                        results.append({"type": "error", "error": {"message": str(exc)}})
                payload = json.dumps({"results": results}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):  # silence
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}/v2/pipeline"

    def shutdown(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture()
def fake_turso():
    server = _FakeTurso()
    yield server
    server.shutdown()


def test_turso_connection_roundtrip(fake_turso):
    conn = TursoConnection(fake_turso.url, "test-token")
    with conn as c:
        c.execute(
            "CREATE TABLE IF NOT EXISTS demo (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);"
        )
        cur = c.execute("INSERT INTO demo (name) VALUES (?);", ("orca",))
        assert cur.lastrowid >= 1
        cur = c.execute("SELECT name FROM demo WHERE id = ?;", (cur.lastrowid,))
        row = cur.fetchone()
        assert row is not None
        assert row["name"] == "orca"
        assert row[0] == "orca"  # positional access works too
        assert dict(row)["name"] == "orca"
        upd = c.execute("UPDATE demo SET name = ? WHERE id = ?;", ("whale", 1))
        assert upd.rowcount == 1
    conn.close()


def test_turso_rejects_error_statements(fake_turso):
    conn = TursoConnection(fake_turso.url, "test-token")
    with pytest.raises(RuntimeError):
        conn.execute("SELECT * FROM missing_table;")


def test_storage_runs_end_to_end_on_turso(fake_turso, monkeypatch):
    monkeypatch.setenv("ORCA_TURSO_DATABASE_URL", fake_turso.url)
    monkeypatch.setenv("ORCA_TURSO_AUTH_TOKEN", "test-token")
    try:
        storage = OrcaStorage("/tmp/unused-turso.db")
        assert storage._backend == "turso"

        from orca.models import Song

        song = Song(
            video_id="abc123",
            title="Ocean Drive",
            artist="Dolphin",
            duration="3:30",
            artwork_url="",
        )
        storage.add_favorite(song)
        assert storage.is_favorite("abc123") is True
        favs = storage.get_favorites()
        assert len(favs) == 1 and favs[0].title == "Ocean Drive"

        pid = storage.create_playlist("Deep Focus")
        assert pid >= 1
        storage.add_tracks_to_playlist(pid, [song])
        tracks = storage.get_playlist_tracks(pid)
        assert len(tracks) == 1 and tracks[0].video_id == "abc123"

        # Users + tokens
        created = storage.create_user("Kai", "kai@sea.dev", password_hash="hash")
        assert created is not None and created["email"] == "kai@sea.dev"
        assert storage.create_user("Kai", "kai@sea.dev") is None  # duplicate
        storage.save_token("tok123", created["id"])
        assert storage.user_id_for_token("tok123") == created["id"]
        storage.revoke_token("tok123")
        assert storage.is_token_revoked("tok123") is True
        storage.record_history(song)
        assert storage.get_history(5)[0].video_id == "abc123"
        storage.clear_history()
        assert storage.get_history(5) == []
    finally:
        monkeypatch.delenv("ORCA_TURSO_DATABASE_URL", raising=False)
        monkeypatch.delenv("ORCA_TURSO_AUTH_TOKEN", raising=False)


def test_storage_falls_back_to_sqlite_without_env(monkeypatch, tmp_path):
    monkeypatch.delenv("ORCA_TURSO_DATABASE_URL", raising=False)
    storage = OrcaStorage(tmp_path / "local.db")
    assert storage._backend == "sqlite"
