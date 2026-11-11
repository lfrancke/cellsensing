from pathlib import Path

from cell_culture_import.discovery import parse_source
from cell_culture_import.mapping import extract_unit, map_header, normalize_header


def test_cho_filename_and_stable_ids():
    source = parse_source(Path("EXP012_CHO_CleanedData_step5-3_R02_offline_interpolated.csv"), "cho_20260711_60s")
    assert source.culture_run_id == "cho_20260711_60s:EXP012:R02"
    assert source.source_series_id.endswith(":offline_interpolated")
    assert source.is_derived is True


def test_yeast_filename_maps_offline_raw():
    source = parse_source(Path("EXP001_W-68_CleanedData_step6-3_raw_norm_R01_offline.csv"), "yeast_20260804_60s")
    assert (source.cell_type, source.strain, source.source_kind) == ("yeast", "W-68", "offline_raw")


def test_header_mapping_is_name_based_and_unknown_is_deterministic():
    assert normalize_header("Temperature (°C)") == "temperature_c"
    assert extract_unit("Temperature (°C)") == "°C"
    assert map_header("Temperature (°C)").parameter_id == "temperature_c"
    unknown = map_header("New metric (foo)")
    assert unknown.parameter_id == "unmapped__new_metric_foo"
    assert unknown.mapping_status == "unmapped"
