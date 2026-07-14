"""Health check and static-file serving."""

from __future__ import annotations

from pathlib import Path

from app.main import STATIC_DIR_ENV_VAR, resolve_static_dir


def test_health_returns_ok(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unknown_api_route_returns_error_body(client):
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert "error" in response.json()


class TestStaticDirResolution:
    def test_env_var_wins_when_index_present(self, tmp_path: Path, monkeypatch):
        (tmp_path / "index.html").write_text("<html></html>", encoding="utf-8")
        monkeypatch.setenv(STATIC_DIR_ENV_VAR, str(tmp_path))
        assert resolve_static_dir() == tmp_path

    def test_missing_build_degrades_to_none(self, tmp_path: Path, monkeypatch):
        monkeypatch.setenv(STATIC_DIR_ENV_VAR, str(tmp_path / "absent"))
        assert resolve_static_dir() is None
