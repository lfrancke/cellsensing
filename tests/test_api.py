import hashlib
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from cell_culture_import.api.app import _finite_json_value, create_app
from conftest import lake_with_source_series


ROOT = Path(__file__).resolve().parents[1]
LAKE = ROOT / "data_lake"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture()
def client():
    return TestClient(create_app(LAKE))


def test_api_errors_and_static_frontend(client):
    compare = "/api/series/compare"
    assert client.get(compare, params={"culture_run_id": "unknown", "source_kind": "inline", "parameter_id": "ph"}).status_code == 404
    assert client.get(compare, params={"culture_run_id": "cho_20260711_60s:EXP001:R01", "source_kind": "bad", "parameter_id": "ph"}).status_code == 422
    assert client.get(compare, params={"culture_run_id": "cho_20260711_60s:EXP001:R01", "source_kind": "inline", "parameter_id": "not_a_parameter"}).status_code == 422
    assert client.get("/").status_code == 200
    assert client.get("static/style.css").status_code == 200


def test_subproject_images_are_available_from_the_browser_facing_static_urls(client):
    for path in (
        "static/images/subprojects/cho_subproject.png",
        "static/images/subprojects/yeast_subproject.png",
    ):
        response = client.get(path)
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert response.content


def test_api_is_read_only_for_catalog_and_parquet(client):
    series_path = LAKE / "timeseries/dataset_id=cho_20260711_60s/experiment_id=EXP001/reactor_id=R01/source_kind=inline.parquet"
    catalog = sorted((LAKE / "catalog").glob("*.parquet"))
    before = [digest(path) for path in (*catalog, series_path)]
    assert client.get("/api/dashboard-overview", params={"cell_type": "CHO", "source_kind": "inline"}).status_code == 200
    assert client.get("/api/series/compare", params={"culture_run_id": "cho_20260711_60s:EXP001:R01", "source_kind": "inline", "parameter_id": "ph"}).status_code == 200
    assert [digest(path) for path in (*catalog, series_path)] == before


def test_catalog_path_outside_data_lake_is_rejected(tmp_path):
    lake = lake_with_source_series(tmp_path, "SELECT * REPLACE ('../outside.parquet' AS parquet_path) FROM {source}")
    client = TestClient(create_app(lake))
    response = client.get("/api/series/compare", params={"culture_run_id": "cho_20260711_60s:EXP001:R01", "source_kind": "inline", "parameter_id": "ph"})
    assert response.status_code == 500


def test_nonfinite_values_are_not_json_serialized():
    with pytest.raises(HTTPException) as raised:
        _finite_json_value(float("nan"), "time_hours")
    assert raised.value.status_code == 500
