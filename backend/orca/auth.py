"""
auth.py
Authentication primitives for Orca: password hashing, bearer tokens and
Google Identity Services verification. Standard library only — PBKDF2-SHA256
for passwords, secrets.token_urlsafe for bearer tokens.

Google sign-in works without any extra server: the frontend loads Google's
GIS script with the client id advertised by /api/auth/providers, obtains an
ID token (the `credential` JWT), and the backend verifies it against
Google's tokeninfo endpoint, checking audience and email_verified.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
from typing import Any, Dict, Optional
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

log = logging.getLogger(__name__)

PBKDF2_ITERATIONS = 120_000
TOKEN_TTL_S = 60 * 60 * 24 * 30  # 30 days

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def google_client_id() -> str:
    return (os.environ.get("ORCA_GOOGLE_CLIENT_ID") or "").strip()


def google_configured() -> bool:
    return bool(google_client_id())


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: Optional[str]) -> bool:
    if not stored:
        return False
    try:
        scheme, iterations, salt_hex, hash_hex = stored.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


# ---------------------------------------------------------------------------
# Self-contained signed tokens
#
# Vercel serverless instances each get their own ephemeral /tmp SQLite, so a
# token stored only in the instance's DB cannot be resolved by another warm
# instance — /api/auth/me would 401 at random. Issued tokens therefore embed
# the whole user profile plus expiry and are signed with HMAC-SHA256, so any
# instance can verify a session without touching the database. The DB write
# stays as a best-effort revocation aid for /api/auth/logout.
#
# Set ORCA_AUTH_SECRET in production; without it a deployment-derived fallback
# key keeps sessions working (fine for this app's threat model — an Orca
# session only exposes music prefs — but a shared secret is recommended).
# ---------------------------------------------------------------------------

_TOKEN_PREFIX = "o1"
_FALLBACK_SECRET_SEED = "orca.auth.seed.v1"


def auth_secret() -> bytes:
    secret = (os.environ.get("ORCA_AUTH_SECRET") or "").strip()
    if secret:
        return secret.encode("utf-8")
    return hashlib.sha256(_FALLBACK_SECRET_SEED.encode("utf-8")).digest()


def issue_signed_token(user_row: Dict[str, Any]) -> str:
    """Issue a self-contained signed session token for a user row."""
    payload = {
        "uid": int(user_row["id"]),
        "name": user_row.get("name") or "",
        "email": user_row.get("email") or "",
        "avatar": user_row.get("avatar") or "",
        "provider": user_row.get("provider") or "password",
        "exp": int(time.time()) + TOKEN_TTL_S,
    }
    body = (
        base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        .decode("ascii")
        .rstrip("=")
    )
    sig = hmac.new(auth_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{_TOKEN_PREFIX}.{body}.{sig}"


def verify_signed_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify a signed session token, returning the embedded user payload.

    Returns None for foreign, tampered or expired tokens (never raises).
    """
    if not token:
        return None
    try:
        parts = token.split(".")
        if len(parts) != 3 or parts[0] != _TOKEN_PREFIX:
            return None
        body, sig = parts[1], parts[2]
        expected = hmac.new(auth_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        padded = body + "=" * (-len(body) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
        if not isinstance(payload, dict):
            return None
        if float(payload.get("exp", 0)) < time.time():
            return None
        return payload
    except Exception:  # noqa: BLE001 - any malformed token is just rejected
        return None


def valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match(email or ""))


def valid_signup(name: str, email: str, password: str, confirm: str, agreed: bool) -> str:
    """Return an empty string when the signup payload is acceptable, else a
    human-readable reason."""
    if not name or len(name.strip()) < 2:
        return "please tell us your name"
    if not valid_email(email):
        return "that email address doesn't look right"
    if len(password) < 8:
        return "password needs at least 8 characters"
    if password != confirm:
        return "passwords don't match"
    if not agreed:
        return "please agree to the Terms of Service and Privacy Policy"
    return ""


def verify_google_id_token(credential: str) -> Optional[Dict[str, Any]]:
    """Verify a Google ID token against Google's tokeninfo endpoint.

    Returns the token claims when valid for the configured client id and the
    email is verified; returns None otherwise (never raises).
    """
    client_id = google_client_id()
    if not client_id or not credential:
        return None
    try:
        url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + credential
        req = UrlRequest(url, headers={"User-Agent": "orca-auth"})
        with urlopen(req, timeout=10) as resp:  # noqa: S310 - fixed https host
            claims = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        log.warning("google token verification failed: %s", exc)
        return None
    if claims.get("aud") != client_id:
        log.warning("google token audience mismatch")
        return None
    if int(claims.get("exp", 0)) < int(time.time()):
        return None
    if claims.get("email_verified") not in (True, "true"):
        return None
    return claims
