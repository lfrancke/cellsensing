from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

SOURCE_KINDS = ("inline", "offline_raw", "offline_interpolated")


@dataclass(frozen=True)
class ParsedSource:
    path: Path
    dataset_id: str
    cell_type: str
    experiment_id: str
    reactor_id: str
    strain: str | None
    processing_label: str
    source_kind: str

    @property
    def culture_run_id(self) -> str:
        return f"{self.dataset_id}:{self.experiment_id}:{self.reactor_id}"

    @property
    def source_series_id(self) -> str:
        return f"{self.culture_run_id}:{self.source_kind}"

    @property
    def is_derived(self) -> bool:
        return self.source_kind == "offline_interpolated"
