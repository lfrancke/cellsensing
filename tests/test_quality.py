from pathlib import Path

from cell_culture_import.models import ParsedSource
from cell_culture_import.quality import check_duplicate_source_ids, check_source_completeness


def _source(kind: str) -> ParsedSource:
    return ParsedSource(Path("placeholder.csv"), "dataset", "CHO", "EXP001", "R01", None, "step", kind)


def test_quality_checks_report_missing_and_duplicate_sources():
    sources = [_source("inline"), _source("inline")]
    assert check_source_completeness(sources)[0]["check"] == "missing_expected_source_series"
    assert check_duplicate_source_ids(sources) == [{"check": "duplicate_source_series_id", "source_series_id": "dataset:EXP001:R01:inline", "count": 2}]
