from pathlib import Path

from fastapi.testclient import TestClient

from cell_culture_import.api.app import MAX_COMPARE_COMBINATIONS, create_app
from conftest import lake_with_source_series


ROOT = Path(__file__).resolve().parents[1]
LAKE = ROOT / "data_lake"
CHO_RUNS = ["cho_20260711_60s:EXP001:R01", "cho_20260711_60s:EXP001:R02"]
YEAST_RUNS = ["yeast_20260804_60s:EXP001:R01", "yeast_20260804_60s:EXP001:R02"]


def client() -> TestClient:
    return TestClient(create_app(LAKE))


def repeated(**items):
    return [(key, value) for key, values in items.items() for value in values]


def test_compare_multiple_reactors_parameters_and_source_kinds_with_skips():
    response = client().get("/api/series/compare", params=repeated(culture_run_id=CHO_RUNS, source_kind=["inline", "offline_raw"], parameter_id=["ph", "glucose_g_l"]))
    assert response.status_code == 200
    payload = response.json()
    assert [(item["parameter_id"], item["reactor_id"], item["source_kind"]) for item in payload["traces"]] == [
        ("ph", "R01", "inline"), ("ph", "R02", "inline"), ("glucose_g_l", "R01", "offline_raw"), ("glucose_g_l", "R02", "offline_raw"),
    ]
    assert len(payload["skipped_combinations"]) == 4
    assert {item["reason"] for item in payload["skipped_combinations"]} == {"parameter_not_available"}
    assert any(value is None for trace in client().get("/api/series/compare", params=repeated(culture_run_id=YEAST_RUNS, source_kind=["inline"], parameter_id=["rq"])).json()["traces"] for value in trace["values"])


def test_compare_limit_accepts_60_and_rejects_larger_requests():
    all_parameters = [item["parameter_id"] for item in client().get("/api/dashboard-overview", params={"cell_type": "CHO", "source_kind": "inline"}).json()["parameters"]]
    source_kinds = ["inline", "offline_raw", "offline_interpolated"]
    accepted = client().get("/api/series/compare", params=repeated(culture_run_id=CHO_RUNS, source_kind=source_kinds, parameter_id=all_parameters[:10]))
    assert MAX_COMPARE_COMBINATIONS == 60 and accepted.status_code == 200
    rejected = client().get("/api/series/compare", params=repeated(culture_run_id=CHO_RUNS, source_kind=source_kinds, parameter_id=all_parameters[:11]))
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["error"] == "comparison_limit_exceeded"


def test_compare_reports_missing_source_series(tmp_path):
    lake = lake_with_source_series(tmp_path, "SELECT * FROM {source} WHERE NOT (culture_run_id = 'cho_20260711_60s:EXP001:R02' AND source_kind = 'inline')")
    response = TestClient(create_app(lake)).get("/api/series/compare", params=repeated(culture_run_id=CHO_RUNS, source_kind=["inline"], parameter_id=["ph"]))
    assert response.status_code == 200
    assert response.json()["skipped_combinations"] == [{"culture_run_id": CHO_RUNS[1], "reactor_id": "R02", "source_kind": "inline", "parameter_id": "ph", "reason": "source_series_not_available"}]


def test_v3_frontend_declares_compact_controls():
    html = (ROOT / "src/cell_culture_import/api/static/index.html").read_text(encoding="utf-8")
    stylesheet = (ROOT / "src/cell_culture_import/api/static/style.css").read_text(encoding="utf-8")
    assert 'id="cell-type"' not in html and 'id="source-kind"' in html and 'id="panels"' in html
    assert 'class="control-label">Cell Type<' not in html
    assert 'class="control-label">Data Source<' in html
    assert html.index('class="control-label">Data Source<') < html.index('id="source-kind"')
    assert ".toolbar { display: flex; flex-direction: column; align-items: flex-start; gap: 1.25rem;" in stylesheet
    assert ".control-row { display: flex; flex-direction: column; align-items: flex-start;" in stylesheet


def test_frontend_application_shell_declares_hash_routed_views_and_preserves_dashboard_hooks():
    html = (ROOT / "src/cell_culture_import/api/static/index.html").read_text(encoding="utf-8")
    script = (ROOT / "src/cell_culture_import/api/static/app.js").read_text(encoding="utf-8")
    stylesheet = (ROOT / "src/cell_culture_import/api/static/style.css").read_text(encoding="utf-8")
    for label in ("Home", "Guide", "Subprojects", "CHO Cell Cultivation", "Yeast Cultivation", "Yeast/Beer Fermentation &amp; Maturation"):
        assert label in html
    assert 'class="app-title" href="#home">CellSENSING<' in html
    assert "CellSENSING Data</a>" not in html
    assert 'id="home-view"' in html and 'id="guide-view"' in html and 'id="subprojects-view"' in html and 'id="data-information-view"' in html and 'id="data-visualization-view"' in html and 'id="empty-subproject-view"' in html
    assert 'id="cell-type"' not in html and 'id="source-kind"' in html and 'id="panels"' in html
    assert 'href="#subprojects" data-top-route="subprojects">Subprojects<' in html
    assert 'id="subproject-context-nav"' in html and 'aria-label="Subproject navigation"' in html and 'id="subproject-context-pages"' in html
    assert 'subprojects-toggle' not in html and 'subprojects-menu' not in html and 'subprojects-nav' not in html
    for route in ("#subprojects/cho/data-information", "#subprojects/cho/data-visualisation", "#subprojects/yeast/data-information", "#subprojects/yeast/data-visualisation", "#subprojects/yeast-beer-fermentation-maturation/data-information"):
        assert f'href="{route}"' in html
    assert 'link.href = `#subprojects/${route.subproject}/${link.dataset.contextPage}`;' in script
    for obsolete in ("Explore the data", "Data information", "Open Data Visualization", "Open Data Visualisation"):
        assert obsolete not in html
    assert 'target="_blank" rel="noopener noreferrer">Official CellSENSING project page<' in html
    assert "From process data to soft sensing" not in html
    assert all(label not in html for label in (">Process<", ">Sensor Data<", ">Data &amp; Models<", ">Soft Sensor<"))
    assert "01 April 2024 – 31 December 2027" in html and "31 March 2027" not in html
    assert "Federal Ministry of Research, Technology and Space (BMFTR)" in html and "(BMBF)" not in html
    assert "Program: Forschung an Fachhochschulen" in html and "Contract number: 13FH045KX2" in html
    assert "This work was funded by the German Federal Ministry of Research, Technology and Space" not in html
    assert "home-actions" not in html and "primary-action" not in html
    assert ".home-actions" not in stylesheet and ".primary-action" not in stylesheet
    assert "secondary-action" not in html and ".secondary-action" not in stylesheet
    assert 'const subprojects = new Set(["cho", "yeast", "yeast-beer-fermentation-maturation"])' in script
    assert '"data-information": "subprojects/cho/data-information"' in script and '"data-visualization": "subprojects/cho/data-visualisation"' in script
    assert "function routeFromHash()" in script and "function renderRoute(route)" in script and "function syncRoute()" in script
    assert 'window.history.replaceState(null, "", "#home")' in script
    assert 'window.addEventListener("hashchange", syncRoute)' in script
    assert "initializeApplicationShell" in script and "initializeDashboard" in script
    assert "document.readyState === \"loading\"" in script and "DOMContentLoaded" in script
    shell_start = script.index("function initializeApplicationShell()")
    dashboard_start = script.index("function initializeDashboard()")
    shell = script[shell_start:dashboard_start]
    assert "syncRoute();" in shell and 'window.addEventListener("hashchange", syncRoute)' in shell
    assert "initializeApplicationShell();\n\nif (document.readyState" in script
    assert "setDataInformationDataset" in script and "enterDashboardSubproject" in script
    assert 'state.sourceKind = "inline";' in script and 'state.cellType = cellType;' in script
    assert 'route === "home" || route === "guide" || route === "subprojects"' in script
    assert "function renderSubprojectContext(route)" in script
    assert 'context.hidden = !route.subproject;' in script and 'pages.hidden = false;' in script
    assert 'link.href = `#subprojects/${route.subproject}/${link.dataset.contextPage}`;' in script
    assert 'setSubprojectsMenuExpanded' not in script and 'subprojects-toggle' not in script
    assert "resizeDashboardPlots" in script and "Plotly.Plots.resize(plot)" in script and "Unable to resize dashboard plots." in script
    assert 'const experimentToggle = document.createElement("button")' in script
    panel_factory = script[script.index("function createPanel"):script.index("function addPanels")]
    assert panel_factory.count('const toggle = document.createElement("button")') == 1
    assert 'experimentToggle.addEventListener("click"' in panel_factory
    assert 'document.addEventListener("click", (event) => {' in script
    assert 'event.target.closest(".panel-experiment-selector")' in script
    assert 'event.target.closest("button")' not in script
    resize_handler = script[script.index("function resizeDashboardPlots"):script.index("function renderRoute")]
    assert 'const dashboard = byId("data-visualization-view")' in resize_handler
    assert "if (!dashboard || dashboard.hidden) return;" in resize_handler
    assert '.collapsible-visual-panel[data-expanded="true"] .panel[data-expanded="true"] .panel-collapsible-content:not([hidden]) .plot' in resize_handler
    assert "if (plot.data) Plotly.Plots.resize(plot);" in resize_handler
    assert "Unable to resize a dashboard plot." in resize_handler
    assert ".app-nav a.active" in stylesheet and ".workflow" not in stylesheet
    assert ".subproject-context-nav" in stylesheet and ".subprojects-menu" not in stylesheet
    assert ".subproject-card-grid" in stylesheet and "grid-template-columns: repeat(3, minmax(0, 1fr))" in stylesheet
    assert "@media (max-width: 720px)" in stylesheet


def test_subprojects_overview_and_context_navigation_are_route_driven_and_future_safe():
    html = (ROOT / "src/cell_culture_import/api/static/index.html").read_text(encoding="utf-8")
    script = (ROOT / "src/cell_culture_import/api/static/app.js").read_text(encoding="utf-8")
    stylesheet = (ROOT / "src/cell_culture_import/api/static/style.css").read_text(encoding="utf-8")
    overview = html[html.index('id="subprojects-view"'):html.index('id="data-information-view"')]

    assert 'data-view="subprojects"' in overview
    assert ">Subprojects<" in overview
    assert "Experimental datasets and associated information are organised into the following CellSENSING subprojects." in overview
    assert overview.count('class="subproject-card"') == 3 and overview.count('<article class="subproject-card" hidden>') == 1
    assert overview.count('class="subproject-card-visual"') == 3
    assert overview.count(">Pictogram<") == 1
    assert '<div class="subproject-card-visual"><img src="static/images/subprojects/cho_subproject.png" alt="CHO cell cultivation"></div>' in overview
    assert '<div class="subproject-card-visual"><img src="static/images/subprojects/yeast_subproject.png" alt="Yeast cultivation"></div>' in overview
    assert '<span class="subproject-card-placeholder">Pictogram</span>' in overview
    for label in ("CHO Cell Cultivation", "Yeast Cultivation", "Yeast/Beer Fermentation &amp; Maturation"):
        assert label in overview
    for route in ("#subprojects/cho/data-information", "#subprojects/cho/data-visualisation", "#subprojects/yeast/data-information", "#subprojects/yeast/data-visualisation"):
        assert f'href="{route}"' in overview
    assert "Data and documentation for this subproject will be provided here." in overview
    assert overview.count('class="subproject-card-action"') == 4
    assert overview.count('class="subproject-card-action is-unavailable" aria-disabled="true"') == 2
    assert overview.count('aria-hidden="true">→</span>') == 6
    future = overview[overview.index("Yeast/Beer Fermentation &amp; Maturation"):]
    assert "yeast-beer-fermentation-maturation/data-information" not in future
    assert "yeast-beer-fermentation-maturation/data-visualisation" not in future
    assert 'aria-current", "location"' in script and 'aria-current", "page"' in script
    assert 'context.hidden = !route.subproject;' in script
    assert 'route.page === "subprojects" || Boolean(route.subproject)' not in script
    assert ".subproject-card-visual" in stylesheet and "@media (max-width: 900px)" in stylesheet
    assert ".subproject-card-actions { display: grid; gap: .5rem; margin-top: auto;" in stylesheet
    assert ".subproject-card-action.is-unavailable" in stylesheet
    assert ".subproject-card-visual { display: flex; align-items: center; justify-content: center; height: 155px;" in stylesheet
    assert ".subproject-card-visual > img { display: block; width: 100%; height: 100%; max-width: 100%; max-height: 100%; object-fit: contain; object-position: center; }" in stylesheet
    assert ".subproject-card-placeholder" in stylesheet
    assert "@media (max-width: 480px) { .subproject-card-visual { height: 130px; } }" in stylesheet
    assert "background: #eff6ff; color: #1d4f86;" in stylesheet
    assert "background: #dbeafe;" in stylesheet
    for filename in ("cho_subproject.png", "yeast_subproject.png"):
        assert (ROOT / "src/cell_culture_import/api/static/images/subprojects" / filename).is_file()


def test_guide_is_compact_static_information_without_alternative_navigation_or_dashboard_loading():
    html = (ROOT / "src/cell_culture_import/api/static/index.html").read_text(encoding="utf-8")
    script = (ROOT / "src/cell_culture_import/api/static/app.js").read_text(encoding="utf-8")
    stylesheet = (ROOT / "src/cell_culture_import/api/static/style.css").read_text(encoding="utf-8")
    guide = html[html.index('id="guide-view"'):html.index('id="subprojects-view"')]

    for heading in (
        ">Guide<",
        "CellSENSING Data Platform",
        "Platform Structure",
        "Using Data Visualisation",
        "Inline and Offline Data",
        "Interacting with Plots",
        "Interpreting the Data",
        "Terminology",
    ):
        assert heading in guide
    for subsection in ("Selecting Experiments", "Exploring Process Parameters", "Comparing Experiments", "Visual Encoding"):
        assert subsection in guide
    assert "PCHIP" in guide and "Piecewise Cubic Hermite Interpolating Polynomial" in guide
    assert "available discrete offline measurements" in guide
    assert "guide-hierarchy" not in guide and "Platform hierarchy" not in guide
    for term in ("Inline data", "Offline data", "Experiment", "Reactor"):
        assert f">{term}<" in guide
    for interaction in ("Hover over traces", "zoom", "pan", "legend", "reset the view"):
        assert interaction in guide
    assert '<a ' not in guide and '<button' not in guide and "href=" not in guide
    for excluded in ("EXP001", "Countstar", "Osmomat", "L-glutamine", "Fitting Quality"):
        assert excluded not in guide
    assert 'data-view="guide"' in guide
    assert '.guide-page' in stylesheet and '.guide-terminology' in stylesheet and '.guide-hierarchy' not in stylesheet
    assert '.guide-structure, .guide-terminology { grid-template-columns: 1fr; }' in stylesheet
    route_renderer = script[script.index("function renderRoute(route)"):script.index("function syncRoute()")]
    assert 'if (route.page === "data-visualisation" && route.subproject !== "yeast-beer-fermentation-maturation")' in route_renderer
    assert 'route.page === "guide"' not in route_renderer
    home = html[html.index('id="home-view"'):html.index('id="guide-view"')]
    assert "CELLSENSING" not in home and "Explore the experimental data" not in home
    assert 'class="eyebrow"' not in home and "data-exploration" not in home
    assert ".eyebrow" not in stylesheet and ".data-exploration" not in stylesheet


def test_data_information_is_manuscript_grounded_and_uses_route_driven_dataset_selection():
    html = (ROOT / "src/cell_culture_import/api/static/index.html").read_text(encoding="utf-8")
    script = (ROOT / "src/cell_culture_import/api/static/data-information.js").read_text(encoding="utf-8")
    stylesheet = (ROOT / "src/cell_culture_import/api/static/style.css").read_text(encoding="utf-8")
    assert '"static/data-information.js"' in html
    assert 'data-dataset-tab="cho"' not in script and 'data-dataset-tab="yeast"' not in script
    assert 'data-dataset="${kind}"' in script and 'cho ? "" : "hidden"' in script
    assert "window.setDataInformationDataset" in script and "container.dataset.activeDataset" in script
    for heading in ("Dataset Overview", "Experimental Setup", "Experimental Conditions", "Reactor Setup", "Laboratory Setup", "Inline Sensors", "Offline Analysis", "Important Data Notes"):
        assert heading in script
    assert "12 experiments" in script and "24" in script and "2 per experiment (R01, R02)" in script
    assert "EXP001–EXP012" in script and "EXP013–EXP016" in script
    assert "<i>Saccharomyces cerevisiae</i> — SafAle™ W-68" in script
    assert "<i>Saccharomyces pastorianus</i> — SafLager™ W-34/70" in script
    assert "<i>Saccharomyces cerevisiae — SafAle™ W-68</i>" not in script
    assert "<i>Saccharomyces pastorianus — SafLager™ W-34/70</i>" not in script
    assert "Dry yeast" in script
    assert "Dataset code" not in script and "W-3470" not in script
    assert "Culture Medium" in script and "Wort Medium" in script
    assert "Basic Feed" in script and "Forschung an Fachhochschulen" not in script
    assert '"Measurement", "Sensor", "Recording system", "Recorded signals"' in script
    assert '"Manufacturer"' not in script
    assert '"Dielectric spectroscopy"' in script and '"Permittivity / dielectric spectroscopy"' not in script
    assert "Transmission" in script and "Reflection" in script and "Fitting Quality (Cole fit R²)" in script
    assert "Offline Measurements" not in script
    assert "Cell Analysis" in script and "Medium / Metabolite Analysis" in script and "Wort / Fermentation Analysis" in script
    for instrument in ("Countstar BioTech (Alit Biotech)", "Osmomat 3000 Basic (Gonotec)", "Biosen C-Line (EKF Diagnostics)", "Thermo Scientific multimode reader", "Countstar Mira FL (Alit Biotech)", "SmartRef and EasyDens (Anton Paar)"):
        assert instrument in script
    assert "trypan blue exclusion" in script and "methylene blue exclusion" in script
    assert "one to two times per day" in script and "approximately 8 h daily window" in script
    assert "The manuscripts and dataset refer to dielectric spectroscopy measurements as permittivity" not in script
    for item in ("Pre-culture vessel", "1 L narrow-neck, unbaffled flask with gas-permeable stopper", "150 mL thawed 12 °Plato wort", "3 h or 24 h", "22 °C", "140 rpm; 50 mm shaking amplitude", "50 g/L dry yeast for 3 h"):
        assert item in script
    assert "Both culture media were supplemented with 8 mM L-glutamine" in script
    assert "Both culture media contained 8 mM L-glutamine" not in script
    assert "EXP007 used 6 mM" not in script
    assert "Initial L-glutamine: 6 mM" in script
    assert "Chemically defined; free of lipids, hydrolysates, and growth factors; 20 g/L glucose (111 mM); supplemented with 22 mM L-glutamine." in script
    assert "supplemented with 20 g/L glucose" not in script
    assert "510 mOsmol/kg" not in script
    assert "0.4% trypan blue (VWR International) to a final 0.1%" in script
    assert "0.25% aqueous methylene blue (Th. Geyer; pH 3.0) solution was diluted to 0.1% with distilled water" in script
    assert 'const yeastDetails = "Analyzed from the centrifuged-sample supernatant in single determination."' in script
    assert "Analyzed from the centrifuged-sample supernatant; each parameter was measured in single determination." not in script
    assert 'const choDetails = "Analyzed from the centrifuged-sample supernatant in single determination."' in script
    assert "External laboratory — Biosen C-Line (EKF Diagnostics) — Chip-Sensor" in script
    assert "Fluorescence after derivatization with respect to the cell culture media matrix" in script
    assert "L-glutamine was not analyzed." in script
    cho_cell_analysis = script[script.index("const cellRows"):script.index("const choDetails")]
    assert "Viable cell density (VCD); total cell density (TCD); viability; average cell diameter" in cho_cell_analysis
    assert "compactness" not in cho_cell_analysis.lower() and "aggregation" not in cho_cell_analysis.lower()
    image_assets = ("CHO_experimental_setup.jpeg", "Dasgip_Aufbau_CHO.png", "Yeast_smallscale_experimental_setup.jpeg", "Yeast_pilotscale_experimental_setup.jpeg", "Dasgip_Aufbau_Yeast_smallscale.png", "Dasgip_Aufbau_Yeast_pilotscale.png")
    for name in image_assets:
        assert name in script
        assert (ROOT / "src/cell_culture_import/api/static/images/data-information" / name).is_file()
    for name in ("Yeast_smallscale_empty_reactors.jpeg", "Yeast_smallscale_filled_reactors.jpeg", "Dasgip_Aufbau.pptx"):
        assert name not in script
    for caption in ("CHO reactor setup", "CHO experimental setup", "Small-scale reactor setup", "Pilot-scale reactor setup", "Small-scale experimental setup", "Pilot-scale experimental setup"):
        assert caption in script
    for alt in ("CHO reactor setup schematic", "CHO experimental laboratory setup", "Yeast small-scale reactor setup schematic", "Yeast small-scale experimental setup", "Yeast pilot-scale reactor setup schematic", "Yeast pilot-scale experimental setup"):
        assert alt in script
    assert "<figure class=\"data-info-figure ${modifier}\"" in script and "<img class=\"data-info-figure-image" in script
    assert script.count('"data-info-figure--single"') == 2
    assert "Reactor schematic will be added here." not in script and "Laboratory setup photograph" not in script and "Future asset:" not in script
    rendered_panel = script[script.index("return `<section class=\"data-info-dataset\""):script.index("function render()")]
    assert rendered_panel.index("<h3>Laboratory Setup</h3>") < rendered_panel.index("<h3>Reactor Setup</h3>")
    assert ".data-info-figure-grid" in stylesheet and ".data-info-table-wrap" in stylesheet
    assert "object-fit: contain" in stylesheet and "height: auto" in stylesheet
    assert ".data-info-figure--single { width: calc((100% - 1rem) / 2); margin-right: auto; margin-left: auto; }" in stylesheet
    assert ".data-info-figure--single { width: 100%; }" in stylesheet
    assert ".data-info-medium-grid" in stylesheet and ".data-info-key-values" in stylesheet
    assert ".data-info-pre-culture" in stylesheet


def test_dielectric_sensor_dropouts_are_gaps():
    run = "cho_20260711_60s:EXP005:R02"
    traces = client().get("/api/series/compare", params=repeated(culture_run_id=[run], source_kind=["inline"], parameter_id=["permittivity_pf_cm", "conductivity_ms_cm", "ph"])).json()["traces"]
    by_parameter = {trace["parameter_id"]: trace["values"] for trace in traces}
    dropouts = [index for index, value in enumerate(by_parameter["conductivity_ms_cm"]) if value is None]
    assert dropouts and 0 not in by_parameter["conductivity_ms_cm"]
    assert all(by_parameter["permittivity_pf_cm"][index] is None for index in dropouts)
    assert all(by_parameter["ph"][index] is not None for index in dropouts)


def test_antifoam_column_is_split_into_manual_additions_and_pilot_volume():
    overview = client().get("/api/dashboard-overview", params={"cell_type": "yeast", "source_kind": "inline"}).json()
    parameters = {item["parameter_id"]: item for item in overview["parameters"]}
    addition, volume = parameters["antifoam_addition"], parameters["antifoam_volume_ml"]
    assert addition["display_label"] == "Antifoam addition (manual)" and addition["subgroup"] == "Antifoam"
    assert {run.split(":")[1] for run in volume["culture_run_ids"]} == {"EXP013", "EXP014", "EXP015", "EXP016"}
    assert len(addition["culture_run_ids"]) + len(volume["culture_run_ids"]) == 52
    values = client().get("/api/series/compare", params=repeated(culture_run_id=YEAST_RUNS, source_kind=["inline"], parameter_id=["antifoam_addition"])).json()["traces"][0]["values"]
    assert set(values) <= {0, 1, None} and 1 in values
    skipped = client().get("/api/series/compare", params=repeated(culture_run_id=YEAST_RUNS[:1], source_kind=["inline"], parameter_id=["antifoam_volume_ml"])).json()["skipped_combinations"]
    assert skipped[0]["reason"] == "parameter_not_available"
