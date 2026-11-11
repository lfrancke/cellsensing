from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import duckdb

from .importer import import_all


def validate(lake: Path) -> list[str]:
    """Structural checks a data lake must pass before the site can be built from it."""
    errors: list[str] = []
    con = duckdb.connect()
    try:
        catalog = {name: (lake / "catalog" / f"{name}.parquet").as_posix() for name in ("experiments", "culture_runs", "source_series", "parameters")}
        for name, path in catalog.items():
            if not Path(path).is_file():
                errors.append(f"missing catalog table: {path}")
        if errors:
            return errors
        invalid = con.execute(f"SELECT culture_run_id, list_sort(list(source_kind)) FROM read_parquet('{catalog['source_series']}') GROUP BY culture_run_id HAVING list_sort(list(source_kind)) != ['inline', 'offline_interpolated', 'offline_raw']").fetchall()
        errors.extend(f"{run} does not have exactly one inline, offline and interpolated file: {kinds}" for run, kinds in invalid)
        no_duration = con.execute(f"SELECT culture_run_id FROM read_parquet('{catalog['culture_runs']}') WHERE duration_hours IS NULL").fetchall()
        errors.extend(f"{row[0]} has no time values" for row in no_duration)
        for (path,) in con.execute(f"SELECT parquet_path FROM read_parquet('{catalog['source_series']}')").fetchall():
            if not (lake / path).is_file():
                errors.append(f"missing series file: {path}")
    finally:
        con.close()
    return errors


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="culture-import", description="Import the lab's CSV exports into data_lake/.")
    parser.add_argument("--raw-root", type=Path, required=True, help="directory that contains cho_20260711_60s/ and yeast_20260804_60s/")
    parser.add_argument("--output", type=Path, default=Path("data_lake"))
    args = parser.parse_args(argv)

    output = args.output.resolve()
    staging = output.with_name(output.name + ".new")
    if staging.exists():
        shutil.rmtree(staging)
    report = import_all(args.raw_root, staging)
    errors = validate(staging)
    print(json.dumps({**report, "validation_errors": errors}, indent=2, ensure_ascii=False))
    if errors or report["failed_quality_checks"]:
        print(f"\nImport stopped; {output} is unchanged. The incomplete result is in {staging}.")
        raise SystemExit(1)
    # The previous data lake is in git, so replacing it can be undone.
    if output.exists():
        shutil.rmtree(output)
    staging.rename(output)
    print(f"\n{output} replaced. Review the changes with `git status` before committing.")


if __name__ == "__main__":
    main()
