from __future__ import annotations

import re
from pathlib import Path

from .models import ParsedSource

CHO_RE = re.compile(r"^(EXP\d+)_CHO_CleanedData_(step[^_]+)_(R\d+)_(inline|offline|offline_interpolated)\.csv$")
YEAST_RE = re.compile(r"^(EXP\d+)_(W-\d+)_CleanedData_(step[^_]+_raw_norm)_(R\d+)_(inline|offline|offline_interpolated)\.csv$")
KIND_MAP = {"inline": "inline", "offline": "offline_raw", "offline_interpolated": "offline_interpolated"}


def parse_source(path: Path, dataset_id: str) -> ParsedSource:
    if dataset_id.startswith("cho_"):
        match = CHO_RE.fullmatch(path.name)
        if not match:
            raise ValueError(f"Unrecognized CHO filename: {path.name}")
        experiment, processing, reactor, raw_kind = match.groups()
        return ParsedSource(path, dataset_id, "CHO", experiment, reactor, None, processing, KIND_MAP[raw_kind])
    if dataset_id.startswith("yeast_"):
        match = YEAST_RE.fullmatch(path.name)
        if not match:
            raise ValueError(f"Unrecognized yeast filename: {path.name}")
        experiment, strain, processing, reactor, raw_kind = match.groups()
        return ParsedSource(path, dataset_id, "yeast", experiment, reactor, strain, processing, KIND_MAP[raw_kind])
    raise ValueError(f"Unsupported dataset directory: {dataset_id}")


def discover(raw_root: Path) -> list[ParsedSource]:
    found: list[ParsedSource] = []
    for dataset_id in ("cho_20260711_60s", "yeast_20260804_60s"):
        directory = raw_root / dataset_id
        if not directory.is_dir():
            raise FileNotFoundError(f"Dataset directory not found: {directory}")
        for path in sorted(directory.glob("*.csv")):
            if path.name != "pre_culture_metadata.csv":
                found.append(parse_source(path, dataset_id))
    return found
