from __future__ import annotations

import math
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, List

import duckdb
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from cell_culture_import.dashboard_parameter_layout import display_label, is_dashboard_hidden, layout, offline_allowlist

SOURCE_KINDS = {"inline", "offline_raw", "offline_interpolated"}
MAX_COMPARE_COMBINATIONS = 60
STATIC_DIR = Path(__file__).parent / "static"

# This is a dashboard projection, not catalog metadata.  Keep both the API order
# and the permitted values explicit so that adding a newly observed value cannot
# silently change the dashboard's filter vocabulary.
DASHBOARD_FILTER_DIMENSIONS = {
    "CHO": (
        {"id": "process_mode", "label": "CHO Process Mode", "kind": "process_mode", "values": (("batch", "Batch", "batch"), ("fed_batch", "Fed-batch", "fed_batch"))},
        {"id": "culture_medium", "label": "Culture Medium", "parameter_id": "culture_medium", "values": (("tc_42", "TC-42", 0), ("tcx6d", "TCX6D", 1))},
    ),
    "yeast": (
        {"id": "yeast_strain", "label": "Yeast Strain", "kind": "strain", "values": (("w_68", "W-68", "W-68"), ("w_34_70", "W-34/70", "W-3470"))},
        {"id": "wort_concentration", "label": "Wort Concentration", "parameter_id": "wort_concentration_plato", "values": (("12", "12 °Plato", 12), ("24", "24 °Plato", 24))},
        {"id": "pre_culture_duration", "label": "Pre-culture Duration", "parameter_id": "duration_pre_culture_h", "values": (("3", "3 h", 3), ("24", "24 h", 24))},
        {"id": "scale", "label": "Scale", "kind": "curated_scale", "values": (
            ("small_scale", "Small scale", frozenset({"EXP001", "EXP002", "EXP003", "EXP004", "EXP005", "EXP006", "EXP007", "EXP008", "EXP009", "EXP010", "EXP011", "EXP012"})),
            ("pilot_scale", "Pilot scale", frozenset({"EXP013", "EXP014", "EXP015", "EXP016"})),
        )},
    ),
}


def _default_data_lake() -> Path:
    return Path(__file__).resolve().parents[3] / "data_lake"


CATALOG_TABLES = ("experiments", "culture_runs", "source_series", "parameters")


@contextmanager
def _connection(data_lake: Path) -> Iterator[duckdb.DuckDBPyConnection]:
    connection = duckdb.connect()
    try:
        for table in CATALOG_TABLES:
            path = (data_lake / "catalog" / f"{table}.parquet").as_posix().replace("'", "''")
            connection.execute(f"CREATE VIEW {table} AS SELECT * FROM read_parquet('{path}')")
        yield connection
    finally:
        connection.close()


def _rows(connection: duckdb.DuckDBPyConnection, sql: str, parameters: list | None = None) -> list[dict]:
    result = connection.execute(sql, parameters or [])
    names = [item[0] for item in result.description]
    return [dict(zip(names, row)) for row in result.fetchall()]


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _finite_json_value(value: object, field: str) -> float | str | bool | None:
    if value is None:
        return None
    if isinstance(value, float):
        if not math.isfinite(value):
            raise HTTPException(status_code=500, detail=f"Data integrity error: non-finite {field}")
        return value
    # numpy scalar values implement float conversion; strings and booleans must remain intact.
    if hasattr(value, "item"):
        return _finite_json_value(value.item(), field)
    return value  # type: ignore[return-value]


def _safe_series_path(data_lake_path: Path, stored_path: str) -> Path:
    root = data_lake_path.resolve()
    resolved = (root / stored_path).resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="Data integrity error: catalog path is outside data_lake") from exc
    if not resolved.is_file():
        raise HTTPException(status_code=500, detail="Data integrity error: catalog parquet file is unavailable")
    return resolved


def _available_columns(connection: duckdb.DuckDBPyConnection, path: Path) -> list[str]:
    result = connection.execute("SELECT * FROM read_parquet(?) LIMIT 0", [str(path)])
    return [entry[0] for entry in result.description]


def _deduplicate(ids: list[str]) -> list[str]:
    return list(dict.fromkeys(ids))


def _run_records(connection: duckdb.DuckDBPyConnection, culture_run_ids: List[str]) -> list[dict]:
    placeholders = ", ".join("?" for _ in culture_run_ids)
    records = _rows(connection, f"SELECT culture_run_id, reactor_id FROM culture_runs WHERE culture_run_id IN ({placeholders})", culture_run_ids)
    by_id = {record["culture_run_id"]: record for record in records}
    unknown = [identifier for identifier in culture_run_ids if identifier not in by_id]
    if unknown:
        raise HTTPException(status_code=404, detail={"unknown_culture_run_ids": unknown})
    return [by_id[identifier] for identifier in culture_run_ids]


def _source_records(connection: duckdb.DuckDBPyConnection, culture_run_ids: List[str], source_kinds: List[str]) -> dict[tuple[str, str], dict]:
    placeholders_runs = ", ".join("?" for _ in culture_run_ids)
    placeholders_kinds = ", ".join("?" for _ in source_kinds)
    rows = _rows(connection, f"SELECT culture_run_id, source_kind, source_series_id, parquet_path FROM source_series WHERE culture_run_id IN ({placeholders_runs}) AND source_kind IN ({placeholders_kinds})", [*culture_run_ids, *source_kinds])
    return {(row["culture_run_id"], row["source_kind"]): row for row in rows}


def _integrity_error(experiment_id: str, field: str, message: str) -> None:
    raise HTTPException(status_code=500, detail=f"Data integrity error: experiment {experiment_id}, field {field}: {message}")


def _inline_values(connection: duckdb.DuckDBPyConnection, data_lake: Path, runs: list[dict], parameter_id: str, experiment_id: str) -> list[object]:
    """Return all non-null observations from validated Inline source files."""
    values: list[object] = []
    for run in runs:
        path = _safe_series_path(data_lake, run["parquet_path"])
        if parameter_id not in _available_columns(connection, path):
            _integrity_error(experiment_id, parameter_id, "Inline parquet is missing the configured column")
        values.extend(row[parameter_id] for row in _rows(
            connection,
            f"SELECT {_quote_identifier(parameter_id)} FROM read_parquet(?) WHERE {_quote_identifier(parameter_id)} IS NOT NULL",
            [str(path)],
        ))
    return values


def _static_filter_value(connection: duckdb.DuckDBPyConnection, data_lake: Path, runs: list[dict], parameter_id: str, experiment_id: str) -> object:
    values = _inline_values(connection, data_lake, runs, parameter_id, experiment_id)
    distinct = list(dict.fromkeys(values))
    if not distinct:
        _integrity_error(experiment_id, parameter_id, "no non-null configured value")
    if len(distinct) != 1:
        _integrity_error(experiment_id, parameter_id, f"conflicting values {distinct!r}")
    return distinct[0]


def _process_mode(connection: duckdb.DuckDBPyConnection, data_lake: Path, runs: list[dict], experiment_id: str) -> str:
    classifications: list[str] = []
    for run in runs:
        observations = _inline_values(connection, data_lake, [run], "cumulative_feed_weight_g", experiment_id)
        values: list[float] = []
        for observation in observations:
            try:
                value = float(observation)
            except (TypeError, ValueError):
                continue
            if math.isfinite(value):
                values.append(value)
        if not values:
            _integrity_error(experiment_id, "process_mode", f"no usable feed observations for reactor {run['reactor_id']}")
        classifications.append("fed_batch" if any(value > 0 for value in values) else "batch")
    distinct = list(dict.fromkeys(classifications))
    if len(distinct) != 1:
        _integrity_error(experiment_id, "process_mode", f"conflicting reactor classifications {distinct!r}")
    return distinct[0]


def _dashboard_filter_dimensions(connection: duckdb.DuckDBPyConnection, data_lake: Path, cell_type: str, experiments: list[dict]) -> list[dict]:
    configuration = DASHBOARD_FILTER_DIMENSIONS.get(cell_type, ())
    if not configuration:
        return []
    inline_runs = _rows(connection, "SELECT r.culture_run_id, r.reactor_id, r.experiment_id, r.dataset_id, s.parquet_path FROM culture_runs r JOIN experiments e USING(dataset_id, experiment_id) JOIN source_series s USING(culture_run_id) WHERE e.cell_type = ? AND s.source_kind = 'inline' ORDER BY r.experiment_id, r.reactor_id", [cell_type])
    runs_by_experiment: dict[str, list[dict]] = {}
    for run in inline_runs:
        runs_by_experiment.setdefault(run["experiment_id"], []).append(run)
    values_by_dimension: dict[str, dict[str, list[str]]] = {item["id"]: {value[0]: [] for value in item["values"]} for item in configuration}
    for experiment in experiments:
        experiment_id = experiment["experiment_id"]
        runs = runs_by_experiment.get(experiment_id, [])
        if not runs:
            _integrity_error(experiment_id, "inline", "no Inline culture runs available")
        for dimension in configuration:
            if dimension.get("kind") == "process_mode":
                observed = _process_mode(connection, data_lake, runs, experiment_id)
            elif dimension.get("kind") == "strain":
                observed = experiment["strain"]
            elif dimension.get("kind") == "curated_scale":
                observed = experiment_id
            else:
                observed = _static_filter_value(connection, data_lake, runs, dimension["parameter_id"], experiment_id)
            matched = [value[0] for value in dimension["values"] if (observed in value[2] if dimension.get("kind") == "curated_scale" else value[2] == observed)]
            if len(matched) != 1:
                _integrity_error(experiment_id, dimension["id"], f"unsupported configured value {observed!r}")
            values_by_dimension[dimension["id"]][matched[0]].append(experiment_id)
    return [{"id": dimension["id"], "label": dimension["label"], "values": [{"id": value_id, "label": label, "experiment_ids": values_by_dimension[dimension["id"]][value_id]} for value_id, label, _ in dimension["values"]]} for dimension in configuration]


def create_app(data_lake_path: Path | None = None) -> FastAPI:
    data_lake = (data_lake_path or _default_data_lake()).resolve()
    app = FastAPI(title="Cell Culture Data API", version="0.1.0")
    # Allows the exported dashboard HTML to request this read-only local API
    # when it is opened directly with a file:// URL (which has origin "null").
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/dashboard-overview")
    def dashboard_overview(cell_type: str, source_kind: str) -> dict:
        if source_kind not in SOURCE_KINDS:
            raise HTTPException(status_code=422, detail="Invalid source_kind")
        with _connection(data_lake) as con:
            experiments = _rows(con, "SELECT dataset_id, experiment_id, strain FROM experiments WHERE cell_type = ? ORDER BY experiment_id, dataset_id", [cell_type])
            filter_dimensions = _dashboard_filter_dimensions(con, data_lake, cell_type, experiments)
            runs = _rows(con, "SELECT r.culture_run_id, r.reactor_id, r.experiment_id, r.dataset_id FROM culture_runs r JOIN experiments e USING(dataset_id, experiment_id) WHERE e.cell_type = ? ORDER BY r.experiment_id, r.reactor_id, r.dataset_id", [cell_type])
            source_rows = _rows(con, "SELECT s.culture_run_id, s.parquet_path FROM source_series s JOIN culture_runs r USING(culture_run_id) JOIN experiments e USING(dataset_id, experiment_id) WHERE e.cell_type = ? AND s.source_kind = ?", [cell_type, source_kind])
            paths = {row["culture_run_id"]: row["parquet_path"] for row in source_rows}
            available: dict[str, list[str]] = {}
            for run in runs:
                stored = paths.get(run["culture_run_id"])
                if stored is None:
                    continue
                for column in set(_available_columns(con, _safe_series_path(data_lake, stored))) - {"time_hours"}:
                    available.setdefault(column, []).append(run["culture_run_id"])
            if not available:
                return {"cell_type": cell_type, "source_kind": source_kind, "experiments": experiments, "culture_runs": runs, "parameters": [], "filter_dimensions": filter_dimensions, "max_compare_combinations": MAX_COMPARE_COMBINATIONS}
            placeholders = ", ".join("?" for _ in available)
            parameters = _rows(con, f"SELECT parameter_id, display_name, unit FROM parameters WHERE parameter_id IN ({placeholders}) ORDER BY display_name, parameter_id", sorted(available))
            parameters = [
                parameter
                for parameter in parameters
                if not is_dashboard_hidden(parameter["parameter_id"], cell_type, source_kind)
            ]
            for parameter in parameters:
                parameter["culture_run_ids"] = available[parameter["parameter_id"]]
                parameter["available_in_count"] = len(parameter["culture_run_ids"])
                parameter["total_culture_runs"] = len(runs)
                parameter.update(layout(parameter["parameter_id"], cell_type, source_kind))
                parameter["display_label"] = display_label(parameter["display_name"], parameter["unit"])
            if source_kind != "inline":
                allowed = offline_allowlist(cell_type)
                parameters = [next(p for p in parameters if p["parameter_id"] == pid) for pid in allowed if any(x["parameter_id"] == pid for x in parameters)]
            elif cell_type == "CHO":
                parameters.append({"parameter_id":"cumulative_naoh_amount_mmol","display_name":"Cumulative NaOH amount (mmol)","display_label":"Cumulative NaOH amount (mmol)","unit":"mmol","culture_run_ids":[r["culture_run_id"] for r in runs],"available_in_count":len(runs),"total_culture_runs":len(runs),"section":"Dynamic Sensor Data","subgroup":"Base Addition","order":80,"advanced":False,"default_visible":True,"help_text":"Derived from NaOH solution mass and run-specific concentration; density assumption: 1.0 g/mL."})
            parameters.sort(key=lambda p:(p["section"],p["order"],p["display_name"],p["parameter_id"]))
            return {"cell_type": cell_type, "source_kind": source_kind, "experiments": experiments, "culture_runs": runs, "parameters": parameters, "filter_dimensions": filter_dimensions, "max_compare_combinations": MAX_COMPARE_COMBINATIONS}

    @app.get("/api/series/compare")
    def compare_series(culture_run_id: List[str] = Query(...), source_kind: List[str] = Query(...), parameter_id: List[str] = Query(...)) -> dict:
        culture_run_ids, source_kinds, parameter_ids = _deduplicate(culture_run_id), _deduplicate(source_kind), _deduplicate(parameter_id)
        if any(kind not in SOURCE_KINDS for kind in source_kinds):
            raise HTTPException(status_code=422, detail="Invalid source_kind")
        combination_count = len(culture_run_ids) * len(source_kinds) * len(parameter_ids)
        if combination_count > MAX_COMPARE_COMBINATIONS:
            raise HTTPException(status_code=422, detail={"error": "comparison_limit_exceeded", "max_combinations": MAX_COMPARE_COMBINATIONS, "requested_combinations": combination_count})
        with _connection(data_lake) as con:
            runs = _run_records(con, culture_run_ids)
            placeholders = ", ".join("?" for _ in parameter_ids)
            parameter_rows = _rows(con, f"SELECT parameter_id, display_name, unit FROM parameters WHERE parameter_id IN ({placeholders})", parameter_ids)
            labels = {row["parameter_id"]: row for row in parameter_rows}
            if "cumulative_naoh_amount_mmol" in parameter_ids:
                labels["cumulative_naoh_amount_mmol"]={"parameter_id":"cumulative_naoh_amount_mmol","display_name":"Cumulative NaOH amount (mmol)","unit":"mmol"}
            unknown_parameters = [identifier for identifier in parameter_ids if identifier not in labels]
            if unknown_parameters:
                raise HTTPException(status_code=422, detail={"unknown_parameter_ids": unknown_parameters})
            sources = _source_records(con, culture_run_ids, source_kinds)
            traces, skipped = [], []
            columns_by_source: dict[tuple[str, str], set[str]] = {}
            for parameter in parameter_ids:
                for run in runs:
                    for kind in source_kinds:
                        base = {"culture_run_id": run["culture_run_id"], "reactor_id": run["reactor_id"], "source_kind": kind, "parameter_id": parameter}
                        source = sources.get((run["culture_run_id"], kind))
                        if source is None:
                            skipped.append({**base, "reason": "source_series_not_available"})
                            continue
                        path = _safe_series_path(data_lake, source["parquet_path"])
                        key = (run["culture_run_id"], kind)
                        if key not in columns_by_source:
                            columns_by_source[key] = set(_available_columns(con, path))
                        derived = parameter == "cumulative_naoh_amount_mmol" and run["culture_run_id"].startswith("cho_") and kind == "inline"
                        if not derived and parameter not in columns_by_source[key]:
                            skipped.append({**base, "reason": "parameter_not_available"})
                            continue
                        if derived:
                            rows = _rows(con, "SELECT time_hours, cumulative_naoh_weight_g * naoh_concentration_m AS cumulative_naoh_amount_mmol FROM read_parquet(?) ORDER BY time_hours", [str(path)])
                        else: rows = _rows(con, f"SELECT time_hours, {_quote_identifier(parameter)} FROM read_parquet(?) ORDER BY time_hours", [str(path)])
                        traces.append({**base, "display_name": labels[parameter]["display_name"], "unit": labels[parameter]["unit"], "time_hours": [_finite_json_value(row["time_hours"], "time_hours") for row in rows], "values": [_finite_json_value(row[parameter], parameter) for row in rows]})
        return {"traces": traces, "skipped_combinations": skipped, "max_combinations": MAX_COMPARE_COMBINATIONS}

    return app
