"""
test_auth.py
Password hashing, signup validation, Google ID-token gate and the auth API.
"""

import pytest
from fastapi.testclient import TestClient

import orca.auth as orca_auth
import orca.server as srv


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ORCA_DATA_DIR", str(tmp_path / "data"))
    srv._storage = None
    srv._catalog = None
    srv._resolver = None
    srv._exporter = None
    app = srv.create_app()
    return TestClient(app)


def test_password_hash_roundtrip():
    stored = orca_auth.hash_password("ocean-deep-2026")
    assert stored.startswith("pbkdf2_sha256$")
    assert orca_auth.verify_password("ocean-deep-2026", stored)
    assert not orca_auth.verify_password("wrong", stored)
    assert not orca_auth.verify_password("anything", None)


def test_signup_validation_rules():
    ok = orca_auth.valid_signup("Nguyen", "n@x.com", "longenough1", "longenough1", True)
    assert ok == ""
    assert orca_auth.valid_signup("N", "n@x.com", "longenough1", "longenough1", True)
    assert orca_auth.valid_signup("Nguyen", "bad-email", "longenough1", "longenough1", True)
    assert orca_auth.valid_signup("Nguyen", "n@x.com", "short", "short", True)
    assert orca_auth.valid_signup("Nguyen", "n@x.com", "longenough1", "different1", True)
    assert orca_auth.valid_signup("Nguyen", "n@x.com", "longenough1", "longenough1", False)


def test_signup_login_me_logout(client):
    r = client.post(
        "/api/auth/signup",
        json={
            "name": "Nguyen Khoi Nguyen",
            "email": "khoi@orca.dev",
            "password": "ocean-deep-2026",
            "confirmPassword": "ocean-deep-2026",
            "agreed": True,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["email"] == "khoi@orca.dev"
    token = body["token"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["user"]["name"] == "Nguyen Khoi Nguyen"

    dup = client.post(
        "/api/auth/signup",
        json={
            "name": "Other",
            "email": "khoi@orca.dev",
            "password": "ocean-deep-2026",
            "confirmPassword": "ocean-deep-2026",
            "agreed": True,
        },
    )
    assert dup.status_code == 409

    bad = client.post("/api/auth/login", json={"email": "khoi@orca.dev", "password": "nope-nope-nope"})
    assert bad.status_code == 401
    good = client.post("/api/auth/login", json={"email": "khoi@orca.dev", "password": "ocean-deep-2026"})
    assert good.status_code == 200
    assert good.json()["token"]

    out = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert out.status_code == 200
    gone = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert gone.status_code == 401


def test_signup_requires_terms_and_match(client):
    r = client.post(
        "/api/auth/signup",
        json={
            "name": "Tester",
            "email": "t@x.dev",
            "password": "ocean-deep-2026",
            "confirmPassword": "different",
            "agreed": True,
        },
    )
    assert r.status_code == 400
    r = client.post(
        "/api/auth/signup",
        json={
            "name": "Tester",
            "email": "t@x.dev",
            "password": "ocean-deep-2026",
            "confirmPassword": "ocean-deep-2026",
            "agreed": False,
        },
    )
    assert r.status_code == 400


def test_google_disabled_without_client_id(client):
    r = client.post("/api/auth/google", json={"credential": "whatever"})
    assert r.status_code == 401
    providers = client.get("/api/auth/providers").json()
    assert providers["google"] is False


def test_google_verify_rejects_bad_tokens(monkeypatch):
    monkeypatch.setenv("ORCA_GOOGLE_CLIENT_ID", "test-client-id")
    assert orca_auth.verify_google_id_token("") is None
    assert orca_auth.verify_google_id_token("not-a-token") is None


def test_signed_token_roundtrip_and_rejection(monkeypatch):
    row = {"id": 7, "name": "Kai", "email": "kai@sea.dev", "avatar": "", "provider": "google"}
    token = orca_auth.issue_signed_token(row)
    claims = orca_auth.verify_signed_token(token)
    assert claims is not None
    assert claims["uid"] == 7
    assert claims["email"] == "kai@sea.dev"
    assert claims["provider"] == "google"

    # Tampered payload / signature / foreign format are all rejected.
    head, body, sig = token.split(".")
    assert orca_auth.verify_signed_token(f"{head}.{body}{'0' if sig[0] != '0' else '1'}{sig[1:]}") is None
    assert orca_auth.verify_signed_token(f"{head}.eyJ1aWQiOjk5fQ.{sig}") is None
    assert orca_auth.verify_signed_token("random-opaque-token") is None
    assert orca_auth.verify_signed_token("") is None


def test_signed_token_expiry(monkeypatch):
    row = {"id": 3, "name": "Fin", "email": "fin@sea.dev", "avatar": "", "provider": "password"}
    token = orca_auth.issue_signed_token(row)
    monkeypatch.setattr(orca_auth, "TOKEN_TTL_S", 0)
    expired = orca_auth.issue_signed_token(row)
    assert orca_auth.verify_signed_token(token) is not None  # unaffected (ttl read at issue)
    assert orca_auth.verify_signed_token(expired) is None


def test_me_works_without_database_token(client):
    """A signed token must resolve even when the DB has no matching row —
    this is what keeps sessions alive across ephemeral serverless instances."""
    r = client.post(
        "/api/auth/signup",
        json={
            "name": "Signed User",
            "email": "signed@test.dev",
            "password": "long-enough-pass",
            "confirmPassword": "long-enough-pass",
            "agreed": True,
        },
    )
    assert r.status_code == 200
    token = r.json()["token"]
    # The signed token must carry everything /api/auth/me needs; no DB row
    # (fresh serverless instance) may be required. Wipe the token tables to
    # prove the session resolves from the token payload alone.
    storage = srv._storage
    if storage is not None:
        with storage._connection() as conn:
            conn.execute("DELETE FROM auth_tokens;")
            conn.execute("DELETE FROM users;")
            conn.commit()
    r2 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    assert r2.json()["user"]["email"] == "signed@test.dev"
