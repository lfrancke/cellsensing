import shutil
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
LAKE = ROOT / "data_lake"


def lake_with_source_series(tmp_path: Path, select: str) -> Path:
    """Copy of the catalog and CHO EXP001 whose source_series is `select` over the original."""
    lake = tmp_path / "lake"
    shutil.copytree(LAKE / "catalog", lake / "catalog")
    experiment = "timeseries/dataset_id=cho_20260711_60s/experiment_id=EXP001"
    shutil.copytree(LAKE / experiment, lake / experiment)
    original = (LAKE / "catalog/source_series.parquet").as_posix()
    target = (lake / "catalog/source_series.parquet").as_posix()
    duckdb.sql(f"COPY ({select.format(source=f'read_parquet({original!r})')}) TO '{target}' (FORMAT parquet)")
    return lake
