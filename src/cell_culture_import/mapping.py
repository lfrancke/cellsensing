from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


def normalize_header(header: str) -> str:
    value = unicodedata.normalize("NFKD", header).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", value).strip("_")


def extract_unit(header: str) -> str | None:
    match = re.search(r"\(([^()]*)\)\s*$", header)
    return match.group(1).strip() if match else None


@dataclass(frozen=True)
class HeaderMapping:
    parameter_id: str
    mapping_status: str
    mapping_provenance: str
    unit: str | None


# These headers are explicitly observed in the supported raw datasets.  New headers are never
# inferred from similarity; they are retained under deterministic unmapped IDs instead.
KNOWN_HEADERS = frozenset({
    "Dissolved CO2 (%-sat)", "Absorption filtered", "Conductivity (mS/cm)", "Permittivity (pF/cm)", "fc (kHz)", "DeltaEps (pF/cm)", "Alpha", "Fitting Quality (Cole fit R2)", "Fitting Error (Cole fit RMSE)",
    "C (300kHz)", "C (374kHz)", "C (466kHz)", "C (580kHz)", "C (720kHz)", "C (896kHz)", "C (1118kHz)", "C (1392kHz)", "C (1729kHz)", "C (2155kHz)", "C (2689kHz)", "C (3347kHz)", "C (4158kHz)", "C (5188kHz)", "C (6447kHz)", "C (8030kHz)", "C (9995kHz)",
    "pH", "Dissolved O2 (% air sat)", "Temperature (°C)", "Agitation rate (rpm)", "Liquid volume (L)", "Culture Medium", "L-glutamine start concentration (mM)", "Bottom impeller", "NaOH concentration (M)", "Cumulative NaOH weight (g)", "Cumulative feed weight (g)", "Aeration rate total (sL/h)", "O2 fraction inlet (%)", "CO2 fraction inlet (%)", "Aeration rate air (sL/h)", "Aeration rate O2 (sL/h)", "Aeration rate CO2 (sL/h)",
    "Transmission (arb. Unit)", "Reflection (arb. Unit)", "Aeration rate (sL/h)", "O2 fraction exhaust (%)", "CO2 fraction exhaust (%)", "Antifoam volume (mL)", "OUR (mmol/L*h)", "CER (mmol/L*h)", "RQ", "Yeast", "Wort concentration (°Plato)", "Duration pre-culture (h)",
    "VCD Mean (cells/mL)", "VCD SEM (cells/mL)", "TCD Mean (cells/mL)", "TCD SEM (cells/mL)", "Viability Mean (%)", "Viability SEM (%)", "Avg. diameter Mean (µm)", "Avg. diameter SEM (µm)", "Avg. compactness Mean", "Avg. compactness SEM", "Aggregation Mean (%)", "Aggregation SEM (%)", "Glucose (g/L)", "Lactate (g/L)", "Ammonium (mM)", "Osmolality (mOsmol/kg)", "Density (g/cm³)", "Refractive index", "Original gravity (SG)", "Real extract (SG)", "Residual extract (SG)", "Alcohol content (% w/w)", "Degree of fermentation (%)", "Energy (kcal/100 mL)",
})


def map_header(header: str) -> HeaderMapping:
    normalized = normalize_header(header)
    if header in KNOWN_HEADERS:
        return HeaderMapping(normalized, "mapped", "explicit_supported_header_v1", extract_unit(header))
    return HeaderMapping(f"unmapped__{normalized}", "unmapped", "no_exact_supported_header_match", extract_unit(header))
