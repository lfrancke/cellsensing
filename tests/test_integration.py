import os
from pathlib import Path

import pandas as pd
import pytest
from pandas.testing import assert_frame_equal

from cell_culture_import.cli import validate
from cell_culture_import.importer import import_all

ROOT = Path(__file__).resolve().parents[1]
RAW_ROOT = os.environ.get("CELLSENSING_RAW_ROOT")


def assert_same_table(new: Path, committed: Path) -> None:
    # pandas 2 parsed some CSV floats one bit off; the tolerance keeps both versions equal.
    assert_frame_equal(pd.read_parquet(new), pd.read_parquet(committed), rtol=1e-12, atol=0, check_dtype=False, obj=str(committed))


# The raw CSV exports are not in the repository; set CELLSENSING_RAW_ROOT to the directory that contains them.
@pytest.mark.skipif(not RAW_ROOT, reason="CELLSENSING_RAW_ROOT not set")
def test_import_reproduces_the_committed_data_lake(tmp_path):
    lake = tmp_path / "lake"
    report = import_all(Path(RAW_ROOT), lake)
    assert report["failed_quality_checks"] == [] and report["unmapped_headers"] == []
    assert validate(lake) == []
    for table in ("experiments", "culture_runs", "source_series", "parameters"):
        assert_same_table(lake / "catalog" / f"{table}.parquet", ROOT / "data_lake" / "catalog" / f"{table}.parquet")
    for path in pd.read_parquet(lake / "catalog" / "source_series.parquet")["parquet_path"]:
        assert_same_table(lake / path, ROOT / "data_lake" / path)
