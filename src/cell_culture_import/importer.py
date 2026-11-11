"""Turn the lab's CSV exports into data_lake/: four catalog tables and one Parquet file per series."""

from __future__ import annotations

import hashlib
from collections import Counter
from pathlib import Path

import pandas as pd

from .discovery import discover
from .mapping import map_header
from .quality import check_duplicate_source_ids, check_source_completeness


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _resolution(time: pd.Series) -> float | None:
    values = pd.to_numeric(time, errors="coerce").dropna()
    diffs = values.diff().dropna()
    return float(diffs.median()) if not diffs.empty else None


def _read_series(path: Path) -> pd.DataFrame:
    # Object parsing ensures True/False values and empty cells are never silently coerced.
    frame = pd.read_csv(path, dtype=object, keep_default_na=False)
    frame = frame.replace("", pd.NA)
    renamed = {"Time (h)": "time_hours"}
    for column in frame.columns:
        if column != "Time (h)":
            renamed[column] = map_header(column).parameter_id
    frame = frame.rename(columns=renamed)
    frame["time_hours"] = pd.to_numeric(frame["time_hours"], errors="coerce")
    for column in frame.columns:
        if column == "time_hours":
            continue
        # A column stays text when any value is not a number, such as the antifoam True/False flags.
        numeric = pd.to_numeric(frame[column], errors="coerce")
        if numeric.notna().sum() == frame[column].notna().sum():
            frame[column] = numeric
    return frame


def import_all(raw_root: Path, output_root: Path) -> dict:
    """Writes a complete data lake into output_root, which must not exist yet, and returns a report."""
    raw_root, output_root = raw_root.resolve(), output_root.resolve()
    (output_root / "catalog").mkdir(parents=True)
    (output_root / "timeseries").mkdir()

    sources = discover(raw_root)
    experiments: dict[tuple[str, str], dict] = {}
    runs: dict[str, dict] = {}
    source_rows, mapping_rows = [], []
    missing = Counter()
    time_issues: list[dict] = []

    for source in sources:
        key = (source.dataset_id, source.experiment_id)
        experiments.setdefault(key, {"experiment_id": source.experiment_id, "dataset_id": source.dataset_id, "cell_type": source.cell_type, "strain": source.strain, "processing_label": source.processing_label})
        frame = _read_series(source.path)
        duration = float(frame["time_hours"].max()) if frame["time_hours"].notna().any() else None
        previous = runs.get(source.culture_run_id)
        if previous is None or (duration is not None and (previous["duration_hours"] is None or duration > previous["duration_hours"])):
            runs[source.culture_run_id] = {"culture_run_id": source.culture_run_id, "experiment_id": source.experiment_id, "dataset_id": source.dataset_id, "reactor_id": source.reactor_id, "duration_hours": duration}
        for original in pd.read_csv(source.path, nrows=0).columns:
            if original == "Time (h)":
                continue
            mapped = map_header(original)
            mapping_rows.append({"dataset_id": source.dataset_id, "source_kind": source.source_kind, "original_name": original, "parameter_id": mapped.parameter_id, "unit": mapped.unit, "mapping_status": mapped.mapping_status})
        for column in frame.columns:
            if column != "time_hours":
                missing[column] += int(frame[column].isna().sum())
        differences = frame["time_hours"].diff().dropna()
        # Raw offline samples are intentionally irregular; only inline and interpolated series should be evenly spaced.
        interval_variation = source.source_kind != "offline_raw" and differences.round(10).nunique() > 1
        if frame["time_hours"].duplicated().any() or (differences <= 0).any() or interval_variation:
            time_issues.append({"source_series_id": source.source_series_id, "duplicate_times": int(frame["time_hours"].duplicated().sum()), "non_monotonic": int((differences <= 0).sum()), "distinct_intervals": int(differences.round(10).nunique())})
        parquet_path = output_root / "timeseries" / f"dataset_id={source.dataset_id}" / f"experiment_id={source.experiment_id}" / f"reactor_id={source.reactor_id}" / f"source_kind={source.source_kind}.parquet"
        parquet_path.parent.mkdir(parents=True, exist_ok=True)
        frame.to_parquet(parquet_path, index=False, engine="pyarrow")
        source_rows.append({"source_series_id": source.source_series_id, "culture_run_id": source.culture_run_id, "source_kind": source.source_kind, "original_path": source.path.relative_to(raw_root).as_posix(), "file_hash": sha256(source.path), "row_count": len(frame), "time_resolution_hours": _resolution(frame["time_hours"]), "is_derived": source.is_derived, "parquet_path": parquet_path.relative_to(output_root).as_posix()})

    mapping_frame = pd.DataFrame(mapping_rows).drop_duplicates().sort_values(["parameter_id", "dataset_id", "source_kind"])
    parameter_rows = []
    for parameter_id, group in mapping_frame.groupby("parameter_id", sort=True):
        parameter_rows.append({"parameter_id": parameter_id, "original_name": group.iloc[0].original_name, "display_name": group.iloc[0].original_name, "unit": group.iloc[0].unit, "datatype": "numeric", "category": "offline_assay" if any(kind != "inline" for kind in group.source_kind) else "process_measurement", "applicable_cell_types": sorted({"CHO" if dataset.startswith("cho_") else "yeast" for dataset in group.dataset_id}), "applicable_source_kinds": sorted(group.source_kind.unique())})
    tables = {
        "experiments": pd.DataFrame(experiments.values()).sort_values(["dataset_id", "experiment_id"]),
        "culture_runs": pd.DataFrame(runs.values()).sort_values("culture_run_id"),
        "source_series": pd.DataFrame(source_rows).sort_values("source_series_id"),
        "parameters": pd.DataFrame(parameter_rows),
    }
    for name, table in tables.items():
        table.to_parquet(output_root / "catalog" / f"{name}.parquet", index=False, engine="pyarrow")

    unmapped = sorted(set(mapping_frame.loc[mapping_frame.mapping_status == "unmapped", "original_name"]))
    return {
        "counts": {
            "experiments": len(experiments),
            "culture_runs": len(runs),
            "source_series": len(source_rows),
            "by_dataset": {dataset: {"experiments": sum(1 for d, _ in experiments if d == dataset), "culture_runs": sum(1 for r in runs.values() if r["dataset_id"] == dataset)} for dataset in sorted({d for d, _ in experiments})},
        },
        "unmapped_headers": unmapped,
        "missing_values": {column: count for column, count in sorted(missing.items()) if count},
        "unusual_time_axes": time_issues,
        "failed_quality_checks": check_source_completeness(sources) + check_duplicate_source_ids(sources),
    }
