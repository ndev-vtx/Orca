import os
from pathlib import Path

from orca.stream import _cookie_options


def _clear_env(monkeypatch):
    monkeypatch.delenv("ORCA_YT_COOKIE", raising=False)
    monkeypatch.delenv("ORCA_YT_COOKIE_FILE", raising=False)


def test_no_cookie_configuration_is_empty(monkeypatch):
    _clear_env(monkeypatch)
    assert _cookie_options() == {}


def test_cookie_file_env_points_at_existing_file(monkeypatch, tmp_path):
    _clear_env(monkeypatch)
    cookie_file = tmp_path / "youtube.txt"
    cookie_file.write_text("# Netscape HTTP Cookie File\n", encoding="utf-8")
    monkeypatch.setenv("ORCA_YT_COOKIE_FILE", str(cookie_file))
    options = _cookie_options()
    assert options == {"cookiefile": str(cookie_file)}


def test_missing_cookie_file_env_is_ignored(monkeypatch, tmp_path):
    _clear_env(monkeypatch)
    monkeypatch.setenv("ORCA_YT_COOKIE_FILE", str(tmp_path / "absent.txt"))
    assert _cookie_options() == {}


def test_inline_cookie_materializes_netscape_file(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv(
        "ORCA_YT_COOKIE",
        ".youtube.com\tTRUE\t/\tTRUE\t0\tVISITOR_INFO1_LIVE\tvalue",
    )
    options = _cookie_options()
    assert "cookiefile" in options
    written = Path(options["cookiefile"]).read_text(encoding="utf-8")
    assert written.startswith("# Netscape HTTP Cookie File\n")
    assert "\tVISITOR_INFO1_LIVE\tvalue" in written
    os.remove(options["cookiefile"])


def test_inline_cookie_accepts_escaped_newlines(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv(
        "ORCA_YT_COOKIE",
        "# Netscape HTTP Cookie File\\n.youtube.com\\tTRUE\\t/\\tTRUE\\t0\tSID\ts3cret",
    )
    options = _cookie_options()
    written = Path(options["cookiefile"]).read_text(encoding="utf-8")
    assert "\n" in written.replace("\\n", "")
    assert "\\n" not in written
    os.remove(options["cookiefile"])


def test_pot_provider_env_unconfigured_is_empty(monkeypatch):
    import orca.stream as stream_mod

    monkeypatch.delenv("ORCA_POT_BASE_URL", raising=False)
    assert stream_mod._pot_options() == {}


def test_pot_provider_env_maps_to_extractor_args(monkeypatch):
    import orca.stream as stream_mod

    monkeypatch.setenv("ORCA_POT_BASE_URL", "https://pot.example.vercel.app/")
    opts = stream_mod._pot_options()
    assert opts["extractor_args"]["youtubepot-bgutilhttp"]["base_url"] == [
        "https://pot.example.vercel.app"
    ]


def test_probe_keeps_provider_args_across_profile_overrides(monkeypatch):
    """The bgutil base_url must survive _probe's per-profile extractor_args."""
    import orca.stream as stream_mod

    monkeypatch.setenv("ORCA_POT_BASE_URL", "https://pot.example.vercel.app")
    resolver = stream_mod.StreamResolver()
    assert (
        resolver.options["extractor_args"]["youtubepot-bgutilhttp"]["base_url"]
        == ["https://pot.example.vercel.app"]
    )
    args = {k: dict(v) for k, v in (resolver.options.get("extractor_args") or {}).items()}
    args["youtube"] = {"player_client": ["mweb"], "player_skip": ["webpage"]}
    assert "youtubepot-bgutilhttp" in args
