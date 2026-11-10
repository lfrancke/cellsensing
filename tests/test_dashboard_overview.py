from pathlib import Path

from fastapi.testclient import TestClient

from cell_culture_import.api.app import create_app
from cell_culture_import.dashboard_parameter_layout import layout

ROOT = Path(__file__).resolve().parents[1]
CLIENT = TestClient(create_app(ROOT / "data_lake"))


def test_overview_has_deterministic_real_parameter_lists():
    for cell_type, kind, expected_runs in [("CHO", "inline", 24), ("CHO", "offline_raw", 24), ("yeast", "inline", 52), ("yeast", "offline_raw", 52)]:
        response = CLIENT.get("/api/dashboard-overview", params={"cell_type": cell_type, "source_kind": kind})
        assert response.status_code == 200
        data = response.json()
        assert len(data["culture_runs"]) == expected_runs
        assert data["max_compare_combinations"] == 60
        assert data["parameters"] == sorted(data["parameters"], key=lambda item: (item["section"], item["order"], item["display_name"], item["parameter_id"]))
        assert all(item["available_in_count"] <= item["total_culture_runs"] == expected_runs for item in data["parameters"])


def test_frontend_declares_two_main_scientific_columns_and_status_states():
    script = (ROOT / "src/cell_culture_import/api/static/app.js").read_text(encoding="utf-8")
    stylesheet = (ROOT / "src/cell_culture_import/api/static/style.css").read_text(encoding="utf-8")
    assert "IntersectionObserver" not in script and "panelObserver" not in script
    assert "connectgaps: false" in script and "dataset.loaded" in script
    assert "ResizeObserver" in script and "Plotly.Plots.resize" in script
    assert "responsive: true" in script and "displayModeBar: true" in script
    assert "No data available" in script
    assert "All traces are hidden by the current experiment selection." in script
    assert "panel.traces.length" in script and "visibleTraces.length" in script
    assert "scientific-main-content" in script
    assert 'heading.textContent = "Dynamic Sensor Data"' not in script
    assert 'createScientificColumn("Static Process Variables")' not in script
    assert 'parameters.filter((parameter) => parameter.section !== "Static Process Variables")' in script
    assert "scientific-column-content" in script and "subgroup-card" in script
    priorities = script[script.index("const dynamicGroupPriorities"):script.index("function createScientificColumn")]
    assert 'CHO: ["subgroup-dynamic-sensor-data-dissolved-o2", "subgroup-dynamic-sensor-data-dissolved-co2", "subgroup-dynamic-sensor-data-dielectric-spectroscopy", "subgroup-dynamic-sensor-data-turbidity", "subgroup-dynamic-sensor-data-feed", "subgroup-dynamic-sensor-data-base-addition", "subgroup-dynamic-sensor-data-gas-supply", "subgroup-dynamic-sensor-data-agitation", "subgroup-dynamic-sensor-data-temperature", "subgroup-dynamic-sensor-data-liquid-volume"]' in priorities
    assert 'yeast: ["subgroup-dynamic-sensor-data-dissolved-o2", "subgroup-dynamic-sensor-data-dissolved-co2", "subgroup-dynamic-sensor-data-dielectric-spectroscopy", "subgroup-dynamic-sensor-data-turbidity", "subgroup-dynamic-sensor-data-offgas", "subgroup-dynamic-sensor-data-gas-supply", "subgroup-dynamic-sensor-data-agitation", "subgroup-dynamic-sensor-data-antifoam", "subgroup-dynamic-sensor-data-ph", "subgroup-dynamic-sensor-data-temperature", "subgroup-dynamic-sensor-data-liquid-volume"]' in priorities
    assert "function orderedInlineVisualizationParameters(parameters)" in priorities
    assert "Number.MAX_SAFE_INTEGER" in priorities and "left.index - right.index" in priorities
    assert "Offline Measurements" in script and "offline-panel-grid" in script
    assert "function createCollapsiblePanelHeader" in script and "function updatePanelGroupSummary" in script and "function initializePanelGroup" in script
    assert 'id="advanced"' not in (ROOT / "src/cell_culture_import/api/static/index.html").read_text(encoding="utf-8")
    advanced_control = script[script.index("function configureAdvancedControl"):script.index("async function buildDashboard")]
    assert 'item.groupTitle === "Dielectric Spectroscopy"' in advanced_control
    assert 'control.id = "advanced"' in advanced_control and 'control.className = "advanced-control"' in advanced_control
    assert "content.prepend(control);" in advanced_control
    assert "Advanced dielectric spectroscopy parameters" in advanced_control
    assert 'visible ? "Hide" : "Show"' in advanced_control
    assert "if (visible) addPanels(true);" in advanced_control
    assert 'control.setAttribute("aria-expanded", "false")' in script
    assert 'control.setAttribute("aria-controls", contentId)' in script
    assert 'group.dataset.loadState = "unloaded"' in script
    assert 'group.dataset.expanded = "false"' in script and "function setGroupExpanded(group, expanded)" in script
    assert 'group.dataset.loadState = "loading"' in script and 'group.dataset.loadState = "loaded";' in script and 'group.dataset.loadState = "error";' in script
    assert "content.hidden = true" in script and "content.hidden = !expanded" in script
    assert "resizeCollapsiblePlots(content)" in script and "if (plot.data) Plotly.Plots.resize(plot)" in script
    assert 'group.dataset.expanded === "true"' in script
    assert 'if (group.dataset.expanded === "true") {' in script and "setGroupExpanded(group, false);" in script
    assert 'if (group.dataset.loadState === "unloaded") await initializePanelGroup(group);' in script
    assert "collapsible-panel-summary" in script
    assert "Array.from(group.parameters.values())" in script
    assert "function isSingleParameterGroup(group)" in script and "return group.parameters.size === 1;" in script
    assert "function updatePanelPresentation(panel, directDisplay)" in script and "function syncGroupPanelPresentation(group)" in script
    assert "toggle.hidden = directDisplay;" in script and "content.hidden = !directDisplay;" in script
    assert 'if (panel.dataset.directDisplay !== String(directDisplay)) updatePanelPresentation(panel, directDisplay);' in script
    assert "group.groupTitle = title;" in script
    assert 'const suppressSummary = parameters.length === 1 && normalizedTitle === normalizedLabel;' in script
    assert "summary.hidden = suppressSummary;" in script
    ordering = script[script.index("function orderedGroupParameters"):script.index("function updatePanelGroupSummary")]
    assert 'group.groupTitle !== "Dielectric Spectroscopy"' in ordering
    assert "!parameter.advanced" in ordering
    assert 'parameter.parameter_id === "fitting_quality_cole_fit_r2"' in ordering
    assert 'parameter.parameter_id === "fitting_error_cole_fit_rmse"' in ordering
    assert '(/^c_\\d+khz$/).test(parameter.parameter_id)' not in ordering
    assert '/^c_\\d+khz$/.test(parameter.parameter_id)' in ordering
    assert 'Number(left.parameter_id.match(/^c_(\\d+)khz$/)[1]) - Number(right.parameter_id.match(/^c_(\\d+)khz$/)[1])' in ordering
    assert "return [...standard, ...fittingQuality, ...fittingError, ...capacitance" in ordering
    advanced_positioning = script[script.index("function positionAdvancedControl"):script.index("function updatePanelGroupSummary")]
    assert 'const control = group.querySelector("#advanced");' in advanced_positioning
    assert 'filter((panel) => !panel.parameter.advanced)' in advanced_positioning
    assert "standardPanels[standardPanels.length - 1].after(control);" in advanced_positioning
    registration = script[script.index("function registerGroupParameter"):script.index("function createCollapsiblePanelHeader")]
    assert "createPanel(" not in registration and "loadPanel(" not in registration and "Plotly.newPlot" not in registration
    assert "syncGroupPanelPresentation(group);" in registration
    initializer = script[script.index("async function initializePanelGroup"):script.index("function registerGroupParameter")]
    assert "while (true)" in initializer and "!group.renderedParameterIds.has(parameter.parameter_id)" in initializer
    assert "const directDisplay = isSingleParameterGroup(group);" in initializer
    assert "createPanel(parameter, directDisplay)" in initializer and "Promise.all(panels.map((panel) => loadPanel(panel)))" in initializer
    assert "group.renderedParameterIds.add(parameter.parameter_id);" in initializer
    assert "positionAdvancedControl(group);" in initializer
    assert 'group.dataset.loadState = "loaded";' in initializer and 'group.dataset.loadState = "error";' in initializer
    collapsible_handler = script[script.index("function createCollapsiblePanelHeader"):script.index("function ensureInlineLayout")]
    assert "api(" not in collapsible_handler
    panel_factory = script[script.index("function createPanel"):script.index("function addPanels")]
    assert 'toggle.className = "panel-collapse-toggle"' in panel_factory
    assert 'toggle.setAttribute("aria-expanded", String(directDisplay))' in panel_factory and 'toggle.setAttribute("aria-controls", contentId)' in panel_factory
    assert 'content.className = "panel-collapsible-content"' in panel_factory and "content.hidden = !directDisplay" in panel_factory
    assert "panel.append(toggle, content)" in panel_factory
    assert "content.append(panelControls)" in panel_factory and "content.append(visualKey)" in panel_factory and "content.append(plot)" in panel_factory
    assert "loadPanel(" not in panel_factory and "api(" not in panel_factory and "Plotly.newPlot" not in panel_factory and "Plotly.purge" not in panel_factory
    assert "if (group.parameters.has(parameter.parameter_id)) return;" in registration
    assert "deferInitialization = false" in registration
    add_panels = script[script.index("function addPanels"):script.index("function configureAdvancedControl")]
    assert "registerGroupParameter(subgroup, parameter, advanced);" in add_panels
    assert "if (advanced) updatedGroups.forEach" in add_panels
    assert "initializePanelGroup(group)" in add_panels
    advanced_control = script[script.index("function configureAdvancedControl"):script.index("async function buildDashboard")]
    assert "positionAdvancedControl(group);" in advanced_control
    assert ".scientific-main-content { min-width: 0; margin-top: 1.75rem; }" in stylesheet
    assert ".scientific-column-content { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; align-items: start; }" in stylesheet
    assert "@media (max-width: 1100px) { .scientific-column-content, .offline-panel-grid { grid-template-columns: 1fr; } }" in stylesheet
    assert "scientific-main-grid" not in stylesheet and "static-column" not in stylesheet
    assert ".collapsible-panel-header" in stylesheet and ".collapsible-panel-content" in stylesheet
    assert ".collapsible-panel-content[hidden] { display: none; }" in stylesheet
    assert ".advanced-control" in stylesheet
    assert ".panel-collapse-toggle" in stylesheet and ".panel-collapsible-content" in stylesheet
    assert "@media (max-width: 1100px)" in stylesheet
    assert "inline-section-grid" not in script


def test_frontend_uses_one_selection_chip_language_and_backend_labels():
    script = (ROOT / "src/cell_culture_import/api/static/app.js").read_text(encoding="utf-8")
    stylesheet = (ROOT / "src/cell_culture_import/api/static/style.css").read_text(encoding="utf-8")
    assert 'selection-chip ${selected ? "selected" : "deselected"}' in script
    assert "cell-type-chip" not in script and "source-kind-chip" in script
    assert "experiment-chip" in script and "panel-experiment-chip" in script
    assert "title.textContent = parameter.display_label" in script
    assert "panel.parameter.display_label" in script
    assert ".selection-chip.selected" in stylesheet
    assert ".selection-chip.deselected" in stylesheet
    assert "background: #fff" in stylesheet and "background: #e5e7eb" in stylesheet


def test_panel_chip_appearance_and_traces_share_effective_visibility_helper():
    script = (ROOT / "src/cell_culture_import/api/static/app.js").read_text(encoding="utf-8")
    assert "function isExperimentEffectivelyVisible(panel, experimentId)" in script
    assert "function isExperimentMetadataEligible(experimentId)" in script
    assert "function isExperimentGloballyEffective(experimentId)" in script
    assert "isExperimentGloballyEffective(experimentId) && panel.localExperiments.has(experimentId)" in script
    assert "selectionChip(experimentId, isExperimentEffectivelyVisible(panel, experimentId)" in script
    assert "return isExperimentEffectivelyVisible(panel, experimentId);" in script
    assert "renderPanelExperiments(panel);\n    renderVisualEncodingControls(panel);\n    drawPanel(panel);" in script


def test_overview_filter_dimensions_are_ordered_and_source_independent():
    expected = {
        "CHO": [("process_mode", ["Batch", "Fed-batch"]), ("culture_medium", ["TC-42", "TCX6D"])],
        "yeast": [("yeast_strain", ["W-68", "W-34/70"]), ("wort_concentration", ["12 °Plato", "24 °Plato"]), ("pre_culture_duration", ["3 h", "24 h"]), ("scale", ["Small scale", "Pilot scale"])],
    }
    for cell_type, dimensions in expected.items():
        inline = CLIENT.get("/api/dashboard-overview", params={"cell_type": cell_type, "source_kind": "inline"})
        offline = CLIENT.get("/api/dashboard-overview", params={"cell_type": cell_type, "source_kind": "offline_raw"})
        assert inline.status_code == offline.status_code == 200
        for payload in (inline.json(), offline.json()):
            assert [(item["id"], [value["label"] for value in item["values"]]) for item in payload["filter_dimensions"]] == dimensions
            assert all(value["experiment_ids"] for item in payload["filter_dimensions"] for value in item["values"])
        assert inline.json()["filter_dimensions"] == offline.json()["filter_dimensions"]
    cho_ids = [item["id"] for item in CLIENT.get("/api/dashboard-overview", params={"cell_type": "CHO", "source_kind": "inline"}).json()["filter_dimensions"]]
    assert "bottom_impeller" not in cho_ids and "l_glutamine" not in cho_ids


def test_frontend_metadata_filters_are_generic_and_do_not_fetch_series_on_visibility_change():
    script = (ROOT / "src/cell_culture_import/api/static/app.js").read_text(encoding="utf-8")
    assert "overview.filter_dimensions" in script
    assert "metadataFilterSelections" in script
    assert "every((dimension)" in script and "some(" in script
    assert "loadTraces(panel.parameter.culture_run_ids" in script
    metadata_handler = script[script.index("function renderMetadataFilters"):script.index("function subgroupKey")]
    assert "/api/series" not in metadata_handler and "loadTraces" not in metadata_handler


def test_frontend_panel_visual_encoding_is_generic_and_panel_local():
    script = (ROOT / "src/cell_culture_import/api/static/app.js").read_text(encoding="utf-8")
    stylesheet = (ROOT / "src/cell_culture_import/api/static/style.css").read_text(encoding="utf-8")
    assert "globalVisualEncoding: { colorBy: \"experiment\", markerBy: \"none\" }" in script
    assert "panel.visualEncodingOverride = null" in script
    assert "buildExperimentMetadata" in script and "state.overview.filter_dimensions" in script
    assert "Color by" in script and "Marker by" in script
    assert "markerPalette" in script and "colorPalette" in script
    assert "mode: lineOnly ? (marker ? \"lines+markers\" : \"lines\") : \"markers\"" in script
    assert "maxdisplayed: lineOnly && marker ? 40" in script
    assert "line: { color: visualColor(panel, experimentId), dash: reactorDash(trace.reactor_id) }" in script
    assert ".visual-encoding-controls" in stylesheet


def test_panel_encoding_ux_uses_a_compact_key_and_local_experiment_popover():
    script = (ROOT / "src/cell_culture_import/api/static/app.js").read_text(encoding="utf-8")
    stylesheet = (ROOT / "src/cell_culture_import/api/static/style.css").read_text(encoding="utf-8")
    assert "function renderVisualEncodingKey(panel)" in script
    assert "visualColorForValue" in script and "visualMarkerForValue" in script
    assert "markerKeyIcon" in script
    assert "Experiments (${effectiveCount}) ▾" in script
    assert "panel-experiment-popover" in script
    assert "event.key === \"Escape\"" in script and "closest(\".panel-experiment-selector\")" in script
    assert "panel.localExperiments = new Set(experiments)" in script
    assert "panel.localExperiments.clear()" in script
    assert ".panel-experiment-popover" in stylesheet and "max-height: 260px" in stylesheet


def test_global_visual_encoding_is_generic_with_optional_panel_override():
    script = (ROOT / "src/cell_culture_import/api/static/app.js").read_text(encoding="utf-8")
    assert "function renderGlobalVisualEncoding()" in script
    assert "getEffectivePanelColorBy(panel)" in script and "getEffectivePanelMarkerBy(panel)" in script
    assert "Using global encoding" in script and "Override" in script and "Reset to global" in script
    assert "panel.visualEncodingOverride = { ...state.globalVisualEncoding }" in script
    assert "panel.visualEncodingOverride = null" in script
    assert "renderVisualEncodingControls(panel);\n    drawPanel(panel);" in script
    assert "[{ id: \"experiment\", label: \"Experiment\" }, ...state.overview.filter_dimensions]" in script


def test_yeast_scale_is_explicit_ordered_curated_dashboard_metadata():
    payload = CLIENT.get("/api/dashboard-overview", params={"cell_type": "yeast", "source_kind": "offline_raw"}).json()
    scale = payload["filter_dimensions"][3]
    assert scale["id"] == "scale" and scale["label"] == "Scale"
    assert scale["values"] == [
        {"id": "small_scale", "label": "Small scale", "experiment_ids": [f"EXP{number:03d}" for number in range(1, 13)]},
        {"id": "pilot_scale", "label": "Pilot scale", "experiment_ids": [f"EXP{number:03d}" for number in range(13, 17)]},
    ]
    cho = CLIENT.get("/api/dashboard-overview", params={"cell_type": "CHO", "source_kind": "inline"}).json()
    assert [dimension["id"] for dimension in cho["filter_dimensions"]] == ["process_mode", "culture_medium"]


def test_scale_is_consumed_by_generic_filter_and_visual_encoding_code():
    script = (ROOT / "src/cell_culture_import/api/static/app.js").read_text(encoding="utf-8")
    assert '"scale"' not in script
    assert "state.overview.filter_dimensions.every" in script
    assert "[{ id: \"experiment\", label: \"Experiment\" }, ...state.overview.filter_dimensions]" in script
    assert "[{ id: \"none\", label: \"None\" }, ...state.overview.filter_dimensions]" in script
    assert "visualColorForValue" in script and "visualMarkerForValue" in script


def test_static_layout_rules_and_coding_help_are_canonical_id_based():
    expected = {
        "bottom_impeller": ("Bottom impeller", "0 = upper position; 1 = lower position (closer to Incyte)"),
        "culture_medium": ("Culture Medium", "0 = TC-42; 1 = TCX6D"),
        "l_glutamine_start_concentration_mm": ("L-glutamine start concentration", None),
        "duration_pre_culture_h": ("Duration pre-culture", None),
        "wort_concentration_plato": ("Wort concentration", None),
        "yeast": ("Yeast", "0 = W-68; 1 = W-34/70"),
    }
    for parameter_id, (subgroup, help_text) in expected.items():
        result = layout(parameter_id, "CHO", "inline")
        assert result["section"] == "Static Process Variables"
        assert result["subgroup"] == subgroup
        assert result["help_text"] == help_text
        assert result["order"] < 999


def test_cho_inline_bottom_impeller_help_and_values_are_preserved():
    overview = CLIENT.get("/api/dashboard-overview", params={"cell_type": "CHO", "source_kind": "inline"})
    assert overview.status_code == 200
    parameter = next(item for item in overview.json()["parameters"] if item["parameter_id"] == "bottom_impeller")
    assert parameter["section"] == "Static Process Variables"
    assert parameter["help_text"] == "0 = upper position; 1 = lower position (closer to Incyte)"
    assert layout("bottom_impeller", "CHO", "offline_raw")["help_text"] is None
    assert layout("bottom_impeller", "yeast", "inline")["help_text"] is None
    series = CLIENT.get("/api/series/compare", params={"culture_run_id": "cho_20260711_60s:EXP001:R01", "source_kind": "inline", "parameter_id": "bottom_impeller"})
    assert series.status_code == 200
    values = [value for value in series.json()["traces"][0]["values"] if value is not None]
    assert values and set(values) <= {0, 1}


def test_cho_inline_hides_naoh_helpers_and_keeps_derived_naoh_panel():
    response = CLIENT.get("/api/dashboard-overview", params={"cell_type": "CHO", "source_kind": "inline"})
    assert response.status_code == 200
    parameters = {item["parameter_id"]: item for item in response.json()["parameters"]}
    assert "cumulative_naoh_weight_g" not in parameters
    assert "naoh_concentration_m" not in parameters
    derived = parameters["cumulative_naoh_amount_mmol"]
    assert derived["display_label"] == "Cumulative NaOH amount (mmol)"
    assert (derived["section"], derived["subgroup"]) == ("Dynamic Sensor Data", "Base Addition")
