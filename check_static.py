"""Compare the static build in site/ with the API it was generated from.

Checks every series listed in each overview file, against the manifest and,
for a sample plus all derived NaOH series, against the API values.
"""

from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from build_static import CELL_TYPES, DATA_LAKE, SITE, SOURCE_KINDS, series_dir
from cell_culture_import.api.app import create_app

SAMPLE_SIZE = 300
RELATIVE_TOLERANCE = 1e-4


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def close(a, b) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, rel_tol=RELATIVE_TOLERANCE, abs_tol=1e-9)
    return a == b


def main() -> int:
    client = TestClient(create_app(DATA_LAKE))
    manifest = load(SITE / "data/manifest.json")["series"]
    errors: list[str] = []
    candidates = []
    for cell_type in CELL_TYPES:
        for source_kind in SOURCE_KINDS:
            api = client.get("/api/dashboard-overview", params={"cell_type": cell_type, "source_kind": source_kind}).json()
            if load(SITE / f"data/overview/{cell_type}-{source_kind}.json") != api:
                errors.append(f"overview {cell_type}-{source_kind} differs from API")
            for parameter in api["parameters"]:
                for run in parameter["culture_run_ids"]:
                    directory = series_dir(run, source_kind)
                    if parameter["parameter_id"] not in manifest.get(directory, []) or not (SITE / directory / f"{parameter['parameter_id']}.json").is_file():
                        errors.append(f"missing {directory}/{parameter['parameter_id']}.json")
                    candidates.append((run, source_kind, parameter["parameter_id"]))
    random.seed(0)
    sample = random.sample(candidates, min(SAMPLE_SIZE, len(candidates)))
    sample += [c for c in candidates if c[2] == "cumulative_naoh_amount_mmol"]
    for run, source_kind, parameter_id in sample:
        trace = client.get("/api/series/compare", params={"culture_run_id": run, "source_kind": source_kind, "parameter_id": parameter_id}).json()["traces"][0]
        directory = SITE / series_dir(run, source_kind)
        time, values = load(directory / "time.json")["t"], load(directory / f"{parameter_id}.json")["v"]
        if len(time) != len(trace["time_hours"]) or not all(abs(a - b) < 1e-4 for a, b in zip(time, trace["time_hours"])):
            errors.append(f"time differs: {run} {source_kind}")
        if len(values) != len(trace["values"]) or not all(close(a, b) for a, b in zip(values, trace["values"])):
            errors.append(f"values differ: {run} {source_kind} {parameter_id}")
    print(f"checked {len(candidates)} series against the manifest, {len(sample)} against API values")
    for error in errors[:50]:
        print("ERROR", error)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
