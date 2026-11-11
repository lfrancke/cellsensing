"""Build the static site in site/ from data_lake/.

The overview files are the API responses verbatim. Each series is split into a
time file per culture run and source kind, shared by all its parameters, and one
value file per parameter, because repeating the time axis would triple the size.
"""

from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from cell_culture_import.api.app import STATIC_DIR, create_app

ROOT = Path(__file__).resolve().parent
DATA_LAKE = ROOT / "data_lake"
SITE = ROOT / "site"
CELL_TYPES = ("CHO", "yeast")
SOURCE_KINDS = ("inline", "offline_raw", "offline_interpolated")
SIGNIFICANT_DIGITS = 5
TIME_DECIMALS = 4


def series_dir(culture_run_id: str, source_kind: str) -> str:
    return f"data/series/{culture_run_id.replace(':', '/')}/{source_kind}"


def source_decimals(values: list) -> int:
    numbers = [v for v in values if isinstance(v, float) and math.isfinite(v)]
    for decimals in range(10):
        if all(abs(round(v, decimals) - v) < 10 ** -(decimals + 3) for v in numbers):
            return decimals
    return 10


def round_value(value, max_decimals: int):
    if not isinstance(value, float):
        return value
    if value == 0:
        return 0
    decimals = min(max_decimals, max(0, SIGNIFICANT_DIGITS - 1 - math.floor(math.log10(abs(value)))))
    rounded = round(value, decimals)
    return int(rounded) if rounded == int(rounded) and abs(rounded) < 2**53 else rounded


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


V2_REDIRECT = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>CellSENSING Data</title>
<script>location.replace("../" + location.hash);</script>
<meta http-equiv="refresh" content="0; url=../"></head>
<body><p>The viewer has moved to <a href="../">the start page</a>.</p></body></html>
"""


def write_classic_view() -> None:
    """The classic view lives in /classic/; its source keeps root-relative paths for the development server."""
    index = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    replacements = {
        '<html lang="en">': '<html lang="en" data-source="static" data-root="../">',
        'src="static/': 'src="../static/',
        'href="static/': 'href="../static/',
        'href="v2/"': 'href="../"',
        'href="legal/': 'href="../legal/',
        'id="data-information-view"': 'id="data-information-view" data-asset-base="../"',
    }
    for old, new in replacements.items():
        if old not in index:
            raise SystemExit(f"{old!r} not found in index.html")
        index = index.replace(old, new)
    (SITE / "classic").mkdir()
    (SITE / "classic" / "index.html").write_text(index, encoding="utf-8")


HERO_PARAMETER = "permittivity_pf_cm"
HERO_POINTS = 160


def write_hero_image(cell_type: str) -> None:
    """Decorative SVG for the start page: the permittivity curves of every cultivation of a dataset."""
    overview = json.loads((SITE / f"data/overview/{cell_type}-inline.json").read_text(encoding="utf-8"))
    parameter = next((p for p in overview["parameters"] if p["parameter_id"] == HERO_PARAMETER), None)
    if parameter is None:
        return
    curves = []
    for run in parameter["culture_run_ids"]:
        directory = SITE / series_dir(run, "inline")
        time = json.loads((directory / "time.json").read_text(encoding="utf-8"))["t"]
        values = json.loads((directory / f"{HERO_PARAMETER}.json").read_text(encoding="utf-8"))["v"]
        step = max(1, len(time) // HERO_POINTS)
        curves.append([(t, v) for t, v in zip(time[::step], values[::step]) if isinstance(v, (int, float))])
    max_time = max(t for curve in curves for t, _ in curve)
    max_value = max(v for curve in curves for _, v in curve)
    paths = []
    for curve in curves:
        points = [f"{t / max_time * 1000:.1f} {300 - max(v, 0) / max_value * 280:.1f}" for t, v in curve]
        if points:
            paths.append(f'<path d="M{" L".join(points)}"/>')
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 300" preserveAspectRatio="none">'
        '<g fill="none" stroke="#8fd0ff" stroke-width="1.4" stroke-opacity=".5" vector-effect="non-scaling-stroke" stroke-linejoin="round">'
        + "".join(paths) + "</g></svg>"
    )
    (SITE / f"hero-{cell_type}.svg").write_text(svg, encoding="utf-8")


def main() -> None:
    if SITE.exists():
        shutil.rmtree(SITE)
    shutil.copytree(STATIC_DIR, SITE / "static")
    (SITE / "static" / "index.html").unlink()
    write_classic_view()
    shutil.copytree(ROOT / "v2", SITE, dirs_exist_ok=True)
    shutil.copytree(ROOT / "legal", SITE / "legal")
    # Links to /v2/ were shared before the new viewer moved to the root.
    (SITE / "v2").mkdir()
    (SITE / "v2" / "index.html").write_text(V2_REDIRECT, encoding="utf-8")
    (SITE / ".nojekyll").touch()

    client = TestClient(create_app(DATA_LAKE))
    manifest: dict[str, list[str]] = {}
    times: dict[tuple[str, str], list] = {}
    for cell_type in CELL_TYPES:
        for source_kind in SOURCE_KINDS:
            response = client.get("/api/dashboard-overview", params={"cell_type": cell_type, "source_kind": source_kind})
            response.raise_for_status()
            overview = response.json()
            write_json(SITE / f"data/overview/{cell_type}-{source_kind}.json", overview)
            for parameter in overview["parameters"]:
                parameter_id = parameter["parameter_id"]
                response = client.get("/api/series/compare", params={"culture_run_id": parameter["culture_run_ids"], "source_kind": source_kind, "parameter_id": parameter_id})
                response.raise_for_status()
                compare = response.json()
                if compare["skipped_combinations"]:
                    raise SystemExit(f"overview lists unavailable series: {compare['skipped_combinations']}")
                for trace in compare["traces"]:
                    run = trace["culture_run_id"]
                    directory = series_dir(run, source_kind)
                    if (run, source_kind) not in times:
                        write_json(SITE / directory / "time.json", {"t": [round(t, TIME_DECIMALS) for t in trace["time_hours"]]})
                        times[(run, source_kind)] = trace["time_hours"]
                    elif times[(run, source_kind)] != trace["time_hours"]:
                        raise SystemExit(f"{run} {source_kind} {parameter_id}: time axis differs between parameters")
                    decimals = source_decimals(trace["values"])
                    write_json(SITE / directory / f"{parameter_id}.json", {"v": [round_value(v, decimals) for v in trace["values"]]})
                    manifest.setdefault(f"{directory}/time.json", [])
                    manifest[f"{directory}/time.json"].append(parameter_id)
            print(f"{cell_type} {source_kind}: {len(overview['parameters'])} parameters")
    for cell_type in CELL_TYPES:
        write_hero_image(cell_type)
    write_json(SITE / "data/manifest.json", {"series": {path.removesuffix("/time.json"): sorted(set(ids)) for path, ids in manifest.items()}})
    size = sum(f.stat().st_size for f in SITE.rglob("*") if f.is_file())
    print(f"site/: {size / 2**20:.1f} MiB, {sum(len(set(v)) for v in manifest.values())} series")


if __name__ == "__main__":
    main()
