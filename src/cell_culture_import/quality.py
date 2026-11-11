from __future__ import annotations

from collections import Counter

from .models import SOURCE_KINDS, ParsedSource


def check_source_completeness(sources: list[ParsedSource]) -> list[dict]:
    grouped: dict[str, set[str]] = {}
    for source in sources:
        grouped.setdefault(source.culture_run_id, set()).add(source.source_kind)
    return [
        {"check": "missing_expected_source_series", "culture_run_id": run, "expected": list(SOURCE_KINDS), "actual": sorted(kinds)}
        for run, kinds in sorted(grouped.items()) if kinds != set(SOURCE_KINDS)
    ]


def check_duplicate_source_ids(sources: list[ParsedSource]) -> list[dict]:
    counts = Counter(source.source_series_id for source in sources)
    return [
        {"check": "duplicate_source_series_id", "source_series_id": identifier, "count": count}
        for identifier, count in sorted(counts.items()) if count > 1
    ]


def count_values(frame, column: str) -> tuple[int, int]:
    values = frame[column]
    missing = int(values.isna().sum())
    boolean = int(values.astype(str).isin(["True", "False"]).sum())
    return missing, boolean
