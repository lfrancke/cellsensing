"use strict";

// The static build puts the data next to this page; the classic view in /classic/ reads the same files.
const DATA_ROOT = "data";

const DATASETS = {
  CHO: {
    label: "CHO",
    longLabel: "CHO cultivations",
    about: "cho",
    doi: "https://doi.org/10.5281/zenodo.20829177",
    citation: {
      authors: ["Uhlendorff, Selina", "Fulek, Ruwen", "Eimler, Jonas", "Pein-Hackelbusch, Miriam", "Frahm, Björn"],
      title: "Dataset Based on Chinese Hamster Ovary (CHO) Cultivations including Turbidity, Permittivity, O2 and CO2 Measurements",
      year: 2026,
      doi: "10.5281/zenodo.20829177",
      key: "uhlendorff2026cho",
    },
    summary: "24 cultivations of CHO-K1 cells in 12 experiments with two parallel 0.55–0.8 L reactors, 161–329 h each.",
    defaults: ["offline:vcd_mean_cells_ml", "inline:permittivity_pf_cm"],
    // From the "Important data notes" and "Experimental conditions" of the dataset description.
    notes: {
      EXP001: { R02: "No multifrequency scans" },
      EXP002: { R02: "No multifrequency scans" },
      EXP003: { R02: "No multifrequency scans" },
      EXP005: { all: "Impaired oxygen supply" },
      EXP006: { all: "Inoculation density 6 × 10⁵ viable cells/mL" },
      EXP007: { all: "Initial L-glutamine 6 mM" },
      EXP009: { all: "Lower bottom-impeller position" },
      EXP010: { R02: "Delayed feed" },
      EXP011: { all: "Lower bottom-impeller position", R02: "Contaminated" },
    },
  },
  yeast: {
    label: "Yeast",
    longLabel: "Yeast cultivations",
    about: "yeast",
    doi: "https://doi.org/10.5281/zenodo.19690247",
    citation: {
      authors: ["Uhlendorff, Selina", "Fulek, Ruwen", "Eimler, Jonas", "Schneider, Jan", "Frahm, Björn", "Pein-Hackelbusch, Miriam"],
      title: "Dataset Based on Inline Monitoring and Offline Analysis of Yeast Cultivations",
      year: 2026,
      doi: "10.5281/zenodo.19690247",
      key: "uhlendorff2026yeast",
    },
    summary: "52 cultivations of two brewing yeast strains: 12 experiments with four parallel 0.7 L reactors and 4 experiments at 10 L pilot scale, 72–76 h each.",
    defaults: ["offline:vcd_mean_cells_ml", "inline:permittivity_pf_cm"],
    notes: {
      EXP002: { all: "Permittivity offset after an outage" },
      EXP007: { R03: "37 °C", R04: "37 °C" },
      EXP008: { R03: "37 °C", R04: "37 °C" },
      EXP009: { R03: "Aeration 0.5 vvm", R04: "Aeration 0.5 vvm" },
      EXP010: { all: "Temperature-control variation", R03: "Aeration 0.5 vvm", R04: "Aeration 0.5 vvm" },
      EXP011: { R03: "30 °C", R04: "30 °C" },
      EXP012: { R03: "30 °C", R04: "30 °C" },
      EXP015: { all: "30 °C" },
      EXP016: { all: "30 °C" },
    },
  },
};

const GROUP_ORDER = ["Offline analytics", "Derived", "Dielectric spectroscopy", "Dissolved O2", "Dissolved CO2", "pH", "Temperature", "Turbidity", "Offgas", "Base Addition", "Feed", "Gas Supply", "Agitation", "Antifoam", "Liquid Volume", "Other", "Dielectric spectroscopy: single frequencies"];

// WebGL draws tens of thousands of points quickly; without it (old or hardened browsers) Plotly draws SVG.
const LINE_TRACE = (() => {
  try { return document.createElement("canvas").getContext("webgl") ? "scattergl" : "scatter"; } catch { return "scatter"; }
})();

const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

const state = {
  dataset: "CHO",
  catalog: null,
  selected: new Set(),
  excludedValues: new Set(),
  parameters: [],
  interpolated: new Set(),
  colorBy: null,
  display: "runs",
  view: "time",
  normalize: "none",
  align: "none",
  correlationX: null,
  correlationY: null,
  xRange: null,
};

const byId = (id) => document.getElementById(id);
const el = (tag, attributes = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.filter((child) => child !== undefined && child !== null));
  return node;
};

function announce(message) {
  byId("announcer").textContent = message;
}

// ---------- data ----------

const jsonCache = new Map();

function fetchJson(path) {
  if (!jsonCache.has(path)) {
    const request = fetch(`${DATA_ROOT}/${path}`).then((response) => {
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      return response.json();
    });
    request.catch(() => jsonCache.delete(path));
    jsonCache.set(path, request);
  }
  return jsonCache.get(path);
}

function seriesDir(runId, sourceKind) {
  return `series/${runId.split(":").map(encodeURIComponent).join("/")}/${sourceKind}`;
}

async function loadSeries(runId, sourceKind, parameterId) {
  const [time, values] = await Promise.all([
    fetchJson(`${seriesDir(runId, sourceKind)}/time.json`),
    fetchJson(`${seriesDir(runId, sourceKind)}/${encodeURIComponent(parameterId)}.json`),
  ]);
  return { t: time.t, v: values.v };
}

async function loadCatalog(dataset) {
  const [inline, offline, interpolated] = await Promise.all(
    ["inline", "offline_raw", "offline_interpolated"].map((kind) => fetchJson(`overview/${dataset}-${kind}.json`)),
  );
  const conditions = inline.filter_dimensions.map((dimension) => {
    const valueOf = new Map();
    dimension.values.forEach((value, index) => value.experiment_ids.forEach((experimentId) => valueOf.set(experimentId, { ...value, index })));
    return { id: dimension.id, label: dimension.label.replace(/^CHO /, ""), values: dimension.values, valueOf };
  });
  const runsByExperiment = new Map();
  for (const run of inline.culture_runs) {
    if (!runsByExperiment.has(run.experiment_id)) runsByExperiment.set(run.experiment_id, []);
    runsByExperiment.get(run.experiment_id).push(run);
  }
  const experiments = inline.experiments.map((experiment) => ({ id: experiment.experiment_id, runs: runsByExperiment.get(experiment.experiment_id) || [] }));
  const runs = new Map(inline.culture_runs.map((run) => [run.culture_run_id, run]));
  const interpolatedIds = new Set(interpolated.parameters.map((parameter) => parameter.parameter_id));
  const parameters = new Map();
  for (const parameter of inline.parameters) {
    if (parameter.section !== "Dynamic Sensor Data") continue;
    const group = parameter.advanced ? "Dielectric spectroscopy: single frequencies" : parameter.subgroup === "Dielectric Spectroscopy" ? "Dielectric spectroscopy" : parameter.subgroup;
    parameters.set(`inline:${parameter.parameter_id}`, { key: `inline:${parameter.parameter_id}`, id: parameter.parameter_id, source: "inline", label: parameter.display_label, name: parameter.display_name, unit: parameter.unit, help: parameter.help_text, group, runIds: new Set(parameter.culture_run_ids) });
  }
  for (const parameter of offline.parameters) {
    parameters.set(`offline:${parameter.parameter_id}`, { key: `offline:${parameter.parameter_id}`, id: parameter.parameter_id, source: "offline", label: parameter.display_label, name: parameter.display_name, unit: parameter.unit, help: parameter.help_text, group: "Offline analytics", runIds: new Set(parameter.culture_run_ids), hasInterpolated: interpolatedIds.has(parameter.parameter_id) });
  }
  addDerivedParameters(parameters);
  return { dataset, conditions, experiments, runs, parameters };
}

// Quantities computed here from the published series. They are labelled as derived wherever they appear.
function addDerivedParameters(parameters) {
  const vcd = parameters.get("offline:vcd_mean_cells_ml");
  if (vcd?.hasInterpolated) {
    parameters.set("derived:growth_rate", {
      key: "derived:growth_rate", id: "growth_rate", source: "derived", group: "Derived", runIds: vcd.runIds,
      label: "Specific growth rate µ (1/h)", name: "Specific growth rate µ", unit: "1/h",
      help: "Computed here from the interpolated viable cell density: µ = Δ ln(VCD) / Δt over ±1 h",
      from: ["offline_interpolated", "vcd_mean_cells_ml"], compute: growthRate,
    });
  }
  for (const [id, base, label] of [["cumulative_our", "our_mmol_l_h", "Cumulative oxygen uptake"], ["cumulative_cer", "cer_mmol_l_h", "Cumulative CO2 evolution"]]) {
    const parameter = parameters.get(`inline:${base}`);
    if (!parameter) continue;
    parameters.set(`derived:${id}`, {
      key: `derived:${id}`, id, source: "derived", group: "Derived", runIds: parameter.runIds,
      label: `${label} (mmol/L)`, name: label, unit: "mmol/L",
      help: `Computed here as the running time integral of ${parameter.name}`,
      from: ["inline", base], compute: runningIntegral,
    });
  }
}

const GROWTH_RATE_HALF_WINDOW_HOURS = 1;

function growthRate(series) {
  const { t, v } = series;
  const step = medianStep(t);
  const offset = Math.max(1, Math.round(GROWTH_RATE_HALF_WINDOW_HOURS / step));
  const rate = t.map((_, index) => {
    const before = index - offset, after = index + offset;
    if (before < 0 || after >= t.length) return null;
    const a = v[before], b = v[after];
    if (typeof a !== "number" || typeof b !== "number" || a <= 0 || b <= 0) return null;
    return Math.log(b / a) / (t[after] - t[before]);
  });
  return { t, v: rate };
}

function runningIntegral(series) {
  const { t, v } = series;
  let total = 0;
  const integral = v.map((value, index) => {
    if (index > 0 && typeof value === "number" && typeof v[index - 1] === "number") total += ((value + v[index - 1]) / 2) * (t[index] - t[index - 1]);
    return typeof value === "number" ? total : null;
  });
  return { t, v: integral };
}

function medianStep(t) {
  const steps = [];
  for (let index = 1; index < Math.min(t.length, 200); index += 1) steps.push(t[index] - t[index - 1]);
  steps.sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)] || 1 / 60;
}

// Loads one cultivation's series for a chart: the main series, and the interpolated curve when asked for.
async function loadParameterSeries(parameter, runId, withInterpolation) {
  if (parameter.source === "derived") return { main: parameter.compute(await loadSeries(runId, ...parameter.from)), curve: null };
  return {
    main: await loadSeries(runId, parameter.source === "inline" ? "inline" : "offline_raw", parameter.id),
    curve: withInterpolation ? await loadSeries(runId, "offline_interpolated", parameter.id) : null,
  };
}

// ---------- derived state ----------

function experimentPassesFilters(experimentId) {
  return state.catalog.conditions.every((condition) => {
    const value = condition.valueOf.get(experimentId);
    return !value || !state.excludedValues.has(`${condition.id}:${value.id}`);
  });
}

function visibleRunIds() {
  return [...state.selected].filter((runId) => experimentPassesFilters(state.catalog.runs.get(runId).experiment_id));
}

function noteFor(run) {
  const notes = DATASETS[state.dataset].notes[run.experiment_id] || {};
  return [notes.all, notes[run.reactor_id]].filter(Boolean).join("; ");
}

function conditionSummary(experimentId) {
  return state.catalog.conditions.map((condition) => condition.valueOf.get(experimentId)?.label).filter(Boolean).join(" · ");
}

function colorOptions() {
  const visibleExperiments = new Set(visibleRunIds().map((runId) => state.catalog.runs.get(runId).experiment_id));
  return [
    ...state.catalog.conditions.map((condition) => ({ id: condition.id, label: condition.label })),
    { id: "experiment", label: visibleExperiments.size <= 8 ? "Experiment" : "Experiment (8 at most)", disabled: visibleExperiments.size > 8 },
    { id: "reactor", label: "Reactor" },
    { id: "none", label: "Nothing (one colour)" },
  ];
}

function palette() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? PALETTE.dark : PALETTE.light;
}

// Returns the legend entries and a function mapping a run to its colour.
// Colours follow the entity (condition value, reactor, experiment position in the full list), never the selection.
function colorScheme() {
  const colors = palette();
  const by = state.colorBy;
  const condition = state.catalog.conditions.find((item) => item.id === by);
  if (condition) {
    return {
      entries: condition.values.map((value, index) => ({ label: value.label, color: colors[index] })),
      colorOf: (run) => colors[condition.valueOf.get(run.experiment_id)?.index ?? 0],
      groupOf: (run) => condition.valueOf.get(run.experiment_id)?.label ?? "",
    };
  }
  if (by === "reactor") {
    const reactors = [...new Set([...state.catalog.runs.values()].map((run) => run.reactor_id))].sort();
    return { entries: reactors.map((reactor, index) => ({ label: reactor, color: colors[index] })), colorOf: (run) => colors[reactors.indexOf(run.reactor_id)], groupOf: (run) => run.reactor_id };
  }
  if (by === "experiment") {
    const shown = [...new Set(visibleRunIds().map((runId) => state.catalog.runs.get(runId).experiment_id))].sort();
    return { entries: shown.map((experimentId, index) => ({ label: experimentId, color: colors[index] })), colorOf: (run) => colors[shown.indexOf(run.experiment_id)], groupOf: (run) => run.experiment_id };
  }
  return { entries: [], colorOf: () => colors[0], groupOf: () => "" };
}

// ---------- URL state ----------

function readHash() {
  const [path, query = ""] = location.hash.replace(/^#/, "").split("?");
  return { path: path || "explore", params: new URLSearchParams(query) };
}

function writeExploreHash() {
  const params = new URLSearchParams();
  params.set("ds", state.dataset);
  params.set("m", state.parameters.join(","));
  if (state.interpolated.size) params.set("interp", [...state.interpolated].join(","));
  params.set("color", state.colorBy);
  if (state.display === "summary") params.set("display", "summary");
  if (state.view === "correlation") params.set("view", "correlation");
  if (state.correlationX) params.set("x", state.correlationX);
  if (state.correlationY) params.set("y", state.correlationY);
  if (state.normalize !== "none") params.set("values", state.normalize);
  if (state.align !== "none") params.set("align", state.align);
  const allRuns = [...state.catalog.runs.keys()];
  const off = allRuns.filter((runId) => !state.selected.has(runId)).map((runId) => runId.split(":").slice(1).join(":"));
  if (off.length) params.set("off", off.join(","));
  if (state.excludedValues.size) params.set("hide", [...state.excludedValues].join(","));
  history.replaceState(null, "", `#explore?${params.toString().replaceAll("%2C", ",").replaceAll("%3A", ":")}`);
}

function applyExploreParams(params) {
  const catalog = state.catalog;
  const requested = (params.get("m") ?? DATASETS[state.dataset].defaults.join(",")).split(",").filter((key) => catalog.parameters.has(key));
  state.parameters = [...new Set(requested)];
  state.interpolated = new Set((params.get("interp") || "").split(",").filter((key) => catalog.parameters.get(key)?.hasInterpolated));
  const off = new Set((params.get("off") || "").split(",").filter(Boolean));
  state.selected = new Set([...catalog.runs.keys()].filter((runId) => !off.has(runId.split(":").slice(1).join(":"))));
  state.excludedValues = new Set((params.get("hide") || "").split(",").filter(Boolean));
  state.display = params.get("display") === "summary" ? "summary" : "runs";
  state.view = params.get("view") === "correlation" ? "correlation" : "time";
  state.normalize = params.get("values") === "max" ? "max" : "none";
  state.align = alignOptions().some((option) => option.id === params.get("align")) ? params.get("align") : "none";
  const sensors = correlationSensors(), samples = correlationSamples();
  state.correlationX = sensors.some((p) => p.key === params.get("x")) ? params.get("x") : (sensors.find((p) => p.id === "permittivity_pf_cm") ?? sensors[0])?.key ?? null;
  state.correlationY = samples.some((p) => p.key === params.get("y")) ? params.get("y") : (samples.find((p) => p.id === "vcd_mean_cells_ml") ?? samples[0])?.key ?? null;
  const color = params.get("color");
  state.colorBy = colorOptions().some((option) => option.id === color && !option.disabled) ? color : catalog.conditions[0]?.id ?? "none";
}

// ---------- rendering: runs panel ----------

function renderDatasetSwitch() {
  const container = byId("dataset-switch");
  container.querySelectorAll("label").forEach((label) => label.remove());
  for (const [key, dataset] of Object.entries(DATASETS)) {
    const input = el("input", { type: "radio", name: "dataset", value: key, checked: key === state.dataset, onchange: () => switchDataset(key) });
    container.append(el("label", {}, input, el("span", { text: dataset.longLabel })));
  }
  byId("dataset-summary").textContent = DATASETS[state.dataset].summary;
  byId("hero-art").src = `hero-${state.dataset}.svg`;
}

function renderHeroStats() {
  const catalog = state.catalog;
  const measured = [...catalog.parameters.values()].filter((parameter) => parameter.source !== "derived");
  const stats = [
    [catalog.runs.size, "cultivations"],
    [catalog.experiments.length, "experiments"],
    [measured.filter((parameter) => parameter.source === "inline").length, "inline signals, every 60 s"],
    [measured.filter((parameter) => parameter.source === "offline").length, "offline analytics"],
  ];
  byId("hero-stats").replaceChildren(...stats.map(([value, label]) => el("div", {}, el("dt", { text: label }), el("dd", { text: String(value) }))));
}

function renderConditionFilters() {
  const container = byId("condition-filters");
  container.replaceChildren();
  for (const condition of state.catalog.conditions) {
    const fieldset = el("fieldset", { class: "condition" }, el("legend", { text: condition.label }));
    for (const value of condition.values) {
      const key = `${condition.id}:${value.id}`;
      const input = el("input", {
        type: "checkbox",
        checked: !state.excludedValues.has(key),
        onchange: (event) => {
          if (event.target.checked) state.excludedValues.delete(key); else state.excludedValues.add(key);
          selectionChanged();
        },
      });
      fieldset.append(el("label", { class: "chip" }, input, el("span", { text: value.label })));
    }
    container.append(fieldset);
  }
}

function renderExperimentList() {
  const list = byId("experiment-list");
  list.replaceChildren();
  let hidden = 0;
  for (const experiment of state.catalog.experiments) {
    if (!experimentPassesFilters(experiment.id)) { hidden += 1; continue; }
    const runIds = experiment.runs.map((run) => run.culture_run_id);
    const selectedCount = runIds.filter((runId) => state.selected.has(runId)).length;
    const experimentBox = el("input", {
      type: "checkbox",
      id: `exp-${experiment.id}`,
      checked: selectedCount === runIds.length,
      onchange: (event) => {
        runIds.forEach((runId) => (event.target.checked ? state.selected.add(runId) : state.selected.delete(runId)));
        selectionChanged();
      },
    });
    experimentBox.indeterminate = selectedCount > 0 && selectedCount < runIds.length;
    const reactors = el("div", { class: "reactors", role: "group", "aria-label": `${experiment.id} reactors` });
    for (const run of experiment.runs) {
      const note = noteFor(run);
      const box = el("input", {
        type: "checkbox",
        checked: state.selected.has(run.culture_run_id),
        "aria-label": `${experiment.id} ${run.reactor_id}${note ? `, note: ${note}` : ""}`,
        onchange: (event) => {
          if (event.target.checked) state.selected.add(run.culture_run_id); else state.selected.delete(run.culture_run_id);
          selectionChanged();
        },
      });
      reactors.append(el("label", { class: "reactor", title: note || undefined }, box, el("span", { text: run.reactor_id }), note ? el("span", { class: "note-mark", "aria-hidden": "true", text: "*" }) : null));
    }
    const notes = [...new Set(experiment.runs.map((run) => {
      const all = DATASETS[state.dataset].notes[experiment.id]?.all;
      const own = DATASETS[state.dataset].notes[experiment.id]?.[run.reactor_id];
      return [all, own ? `${run.reactor_id}: ${own}` : null];
    }).flat().filter(Boolean))];
    list.append(el("li", { class: "experiment" },
      el("div", { class: "experiment-head" },
        experimentBox,
        el("label", { for: `exp-${experiment.id}`, class: "experiment-label" }, el("strong", { text: experiment.id }), el("span", { class: "muted", text: conditionSummary(experiment.id) }))),
      reactors,
      notes.length ? el("p", { class: "experiment-note", text: notes.join(" · ") }) : null,
    ));
  }
  const notice = byId("filter-hidden");
  notice.hidden = hidden === 0;
  notice.replaceChildren();
  if (hidden) notice.append(`${hidden} experiment${hidden === 1 ? "" : "s"} hidden by the condition filters. `, el("button", { type: "button", class: "link-button", text: "Show all", onclick: () => { state.excludedValues.clear(); selectionChanged(); } }));
  const visible = visibleRunIds().length;
  byId("runs-count").textContent = `${visible} of ${state.catalog.runs.size} shown`;
}

function renderColorBy() {
  const select = byId("color-by");
  select.replaceChildren(...colorOptions().map((option) => el("option", { value: option.id, disabled: option.disabled, selected: option.id === state.colorBy, text: option.label })));
}

function renderLegend() {
  const legend = byId("legend");
  legend.replaceChildren();
  const scheme = colorScheme();
  for (const entry of scheme.entries) legend.append(el("span", { class: "legend-item" }, el("span", { class: "swatch", style: `background:${entry.color}` }), entry.label));
  if (state.view === "correlation") {
    legend.append(el("span", { class: "legend-item muted" }, el("span", { class: "swatch dot" }), "offline sample"), el("span", { class: "legend-item muted" }, el("span", { class: "swatch line" }), "fitted line"));
    byId("chart-hint").textContent = "Point at a sample to see its cultivation and time. Drag to zoom.";
  } else if (state.display === "summary") {
    legend.append(el("span", { class: "legend-item muted" }, el("span", { class: "swatch line" }), "median"), el("span", { class: "legend-item muted" }, el("span", { class: "swatch band" }), "interquartile range"));
    byId("chart-hint").textContent = "Each group is shown where at least half of its cultivations have data. Offline measurements are summarised from their interpolated curves. Drag to zoom; all charts share the time axis.";
  } else {
    legend.append(el("span", { class: "legend-item muted" }, el("span", { class: "swatch line" }), "inline sensor"), el("span", { class: "legend-item muted" }, el("span", { class: "swatch dot" }), "offline sample"));
    byId("chart-hint").textContent = "Point at a curve to highlight that cultivation in every chart. Drag to zoom; all charts share the time axis.";
  }
  byId("display").value = state.display;
}

// ---------- rendering: charts ----------

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function plotLayout(parameter) {
  const text = cssVar("--text-secondary");
  const grid = cssVar("--grid");
  const axis = { gridcolor: grid, linecolor: grid, zerolinecolor: grid, tickfont: { color: text }, title: { font: { color: text } } };
  return {
    margin: { l: 64, r: 16, t: 8, b: 44 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: getComputedStyle(document.body).fontFamily, size: 12, color: text },
    showlegend: false,
    hovermode: "closest",
    hoverlabel: { bgcolor: cssVar("--surface-raised"), bordercolor: grid, font: { color: cssVar("--text-primary") } },
    xaxis: { ...axis, title: { ...axis.title, text: state.align === "none" ? "Time (h)" : `Time since ${alignLabel()} (h)` }, range: state.xRange ?? undefined, autorange: state.xRange ? false : true },
    yaxis: { ...axis, title: { ...axis.title, text: displayUnit(parameter) }, exponentformat: "power" },
    dragmode: "zoom",
  };
}

const PLOT_CONFIG = {
  displaylogo: false,
  showSendToCloud: false,
  responsive: true,
  modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"],
};

function chartCard(parameter) {
  const card = el("article", { class: "chart-card", "data-key": parameter.key, "aria-labelledby": `title-${parameter.key}`, "aria-describedby": `description-${parameter.key}` });
  const sourceLabel = { inline: "Inline sensor, every 60 s", offline: "Offline samples", derived: "Derived, not part of the published dataset" }[parameter.source];
  const actions = el("div", { class: "chart-actions" });
  if (parameter.hasInterpolated) {
    actions.append(el("label", { class: "toggle interpolation-toggle" },
      el("input", { type: "checkbox", checked: state.interpolated.has(parameter.key), onchange: (event) => {
        if (event.target.checked) state.interpolated.add(parameter.key); else state.interpolated.delete(parameter.key);
        writeExploreHash();
        drawChart(card, parameter);
      } }),
      el("span", { text: "Interpolated curve" })));
  }
  actions.append(
    el("button", { type: "button", class: "button small", text: "Download CSV", onclick: () => downloadCsv(card, parameter) }),
    el("button", { type: "button", class: "button small", "aria-label": `Remove ${parameter.name}`, text: "Remove", onclick: () => removeParameter(parameter.key) }),
  );
  card.append(
    el("header", { class: "chart-head" },
      el("div", {}, el("h2", { id: `title-${parameter.key}`, text: parameter.label }), el("p", { class: "muted small", text: parameter.help ? `${sourceLabel} · ${parameter.help}` : sourceLabel })),
      actions),
    el("p", { class: "visually-hidden chart-description", id: `description-${parameter.key}` }),
    el("div", { class: "chart-status muted small", role: "status" }),
    el("div", { class: "plot" }),
  );
  return card;
}

function renderCharts() {
  const container = byId("charts");
  const existing = new Map([...container.querySelectorAll(".chart-card")].map((card) => [card.dataset.key, card]));
  const cards = state.parameters.map((key) => existing.get(key) || chartCard(state.catalog.parameters.get(key)));
  existing.forEach((card, key) => { if (!state.parameters.includes(key)) { Plotly.purge(card.querySelector(".plot")); card.remove(); } });
  container.replaceChildren(...cards);
  byId("charts-empty").hidden = state.parameters.length > 0;
  renderMoreOptions();
  if (state.view === "time") cards.forEach((card) => drawChart(card, state.catalog.parameters.get(card.dataset.key)));
}

function redrawAll() {
  if (state.view === "correlation") { drawCorrelation(); return; }
  document.querySelectorAll("#charts .chart-card").forEach((card) => drawChart(card, state.catalog.parameters.get(card.dataset.key)));
}

async function drawChart(card, parameter) {
  const token = (card.drawToken || 0) + 1;
  card.drawToken = token;
  const status = card.querySelector(".chart-status");
  const plot = card.querySelector(".plot");
  const runIds = visibleRunIds().filter((runId) => parameter.runIds.has(runId));
  if (!runIds.length) {
    Plotly.purge(plot);
    plot.hidden = true;
    status.textContent = "No cultivation selected that has this measurement.";
    return;
  }
  const slow = setTimeout(() => { if (card.drawToken === token) status.textContent = `Loading ${runIds.length} cultivations…`; }, 400);
  const summary = state.display === "summary";
  const withInterpolation = parameter.source === "offline" && (summary || state.interpolated.has(parameter.key));
  let results;
  try {
    const events = await eventTimes(runIds);
    results = await Promise.all(runIds.filter((runId) => state.align === "none" || events.get(runId) !== null).map(async (runId) => ({
      run: state.catalog.runs.get(runId),
      ...transformSeries(await loadParameterSeries(parameter, runId, withInterpolation), events.get(runId) ?? 0),
    })));
  } catch (error) {
    clearTimeout(slow);
    if (card.drawToken !== token) return;
    status.replaceChildren(`Could not load the data (${error.message}). `, el("button", { type: "button", class: "link-button", text: "Retry", onclick: () => drawChart(card, parameter) }));
    return;
  }
  clearTimeout(slow);
  if (card.drawToken !== token) return;
  card.loaded = results;
  const excluded = runIds.length - results.length;
  const traces = summary ? summaryTraces(results, parameter) : runTraces(results, parameter);
  if (!results.length) {
    Plotly.purge(plot);
    plot.hidden = true;
    status.textContent = `None of the selected cultivations has the event "${alignLabel()}".`;
    return;
  }
  if (!traces.length) {
    Plotly.purge(plot);
    plot.hidden = true;
    status.textContent = "This measurement has no numeric values to summarise. Switch the display to each cultivation.";
    return;
  }
  status.textContent = excluded ? `${excluded} cultivation${excluded === 1 ? "" : "s"} without the event "${alignLabel()}" not shown.` : "";
  plot.hidden = false;
  const colouring = byId("color-by").selectedOptions[0]?.textContent ?? "";
  card.querySelector(".chart-description").textContent = `${parameter.label} over time, ${summary ? `median and interquartile range per ${colouring}` : `${results.length} cultivations coloured by ${colouring}`}. Use Download CSV for the values.`;
  await Plotly.react(plot, traces, plotLayout(parameter), PLOT_CONFIG);
  if (!plot.eventsAttached) {
    plot.eventsAttached = true;
    plot.on("plotly_relayout", (event) => syncZoom(plot, event));
    plot.on("plotly_hover", (event) => highlightRun(event.points[0]?.data.meta?.[2] ?? null));
    plot.on("plotly_unhover", () => highlightRun(null));
  }
}

function displayUnit(parameter) {
  return state.normalize === "max" ? "% of maximum" : parameter.unit || "";
}

function runTraces(results, parameter) {
  const scheme = colorScheme();
  const unit = displayUnit(parameter) ? ` ${displayUnit(parameter)}` : "";
  const traces = [];
  for (const { run, main, curve } of results) {
    const color = scheme.colorOf(run);
    const meta = [`${run.experiment_id} · ${run.reactor_id}`, [conditionSummary(run.experiment_id), noteFor(run)].filter(Boolean).join(" · "), run.culture_run_id];
    const hovertemplate = `<b>%{meta[0]}</b><br>%{meta[1]}<br>%{x:.2f} h: <b>%{y:.5~g}${unit}</b><extra></extra>`;
    if (curve) traces.push({ type: LINE_TRACE, mode: "lines", x: curve.t, y: curve.v, line: { color, width: 1.25, dash: "dot" }, opacity: 0.7, hoverinfo: "skip", meta });
    traces.push(parameter.source !== "offline"
      ? { type: LINE_TRACE, mode: "lines", x: main.t, y: main.v, line: { color, width: 1.5 }, opacity: 0.8, connectgaps: false, meta, hovertemplate }
      : { type: LINE_TRACE, mode: "markers", x: main.t, y: main.v, marker: { color, size: 8, line: { color: cssVar("--surface"), width: 1 } }, opacity: 0.9, meta, hovertemplate });
  }
  return traces;
}

const SUMMARY_STEP_MINUTES = 5;

function quantile(sorted, q) {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
}

// Median and interquartile range per colour group, on a 5-minute grid. Offline
// measurements use the interpolated curves, which share the inline 60 s grid.
function summaryTraces(results, parameter) {
  const scheme = colorScheme();
  const unit = displayUnit(parameter) ? ` ${displayUnit(parameter)}` : "";
  const groups = new Map();
  for (const { run, main, curve } of results) {
    const series = curve || main;
    const label = scheme.groupOf(run) || "All selected";
    if (!groups.has(label)) groups.set(label, { color: scheme.colorOf(run), bins: new Map(), runs: 0 });
    const group = groups.get(label);
    group.runs += 1;
    let lastBin = null;
    series.t.forEach((t, index) => {
      const value = series.v[index];
      if (typeof value !== "number") return;
      const bin = Math.round((t * 60) / SUMMARY_STEP_MINUTES);
      if (bin === lastBin) return;
      lastBin = bin;
      if (!group.bins.has(bin)) group.bins.set(bin, []);
      group.bins.get(bin).push(value);
    });
  }
  const traces = [];
  for (const [label, group] of groups) {
    const bins = [...group.bins.keys()].sort((a, b) => a - b);
    if (!bins.length) continue;
    const x = [], median = [], q1 = [], q3 = [], n = [];
    const minimum = Math.max(1, Math.ceil(group.runs / 2));
    for (const bin of bins) {
      const values = group.bins.get(bin).sort((a, b) => a - b);
      if (values.length < minimum) continue;
      x.push((bin * SUMMARY_STEP_MINUTES) / 60);
      median.push(quantile(values, 0.5));
      q1.push(quantile(values, 0.25));
      q3.push(quantile(values, 0.75));
      n.push(values.length);
    }
    const fill = colorWithAlpha(group.color, 0.18);
    traces.push(
      { type: "scatter", mode: "lines", x, y: q3, line: { width: 0 }, hoverinfo: "skip", showlegend: false },
      { type: "scatter", mode: "lines", x, y: q1, line: { width: 0 }, fill: "tonexty", fillcolor: fill, hoverinfo: "skip", showlegend: false },
      { type: "scatter", mode: "lines", x, y: median, line: { color: group.color, width: 2.25 }, customdata: n.map((count, index) => [count, q1[index], q3[index]]),
        hovertemplate: `<b>${label}</b><br>%{x:.2f} h: median <b>%{y:.5~g}${unit}</b><br>IQR %{customdata[1]:.5~g} – %{customdata[2]:.5~g}<br>%{customdata[0]} of ${group.runs} cultivations<extra></extra>` },
    );
  }
  return traces;
}

function colorWithAlpha(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

let highlighted = null;
function highlightRun(runId) {
  if (state.display === "summary" || runId === highlighted) return;
  highlighted = runId;
  for (const plot of document.querySelectorAll("#charts .chart-card .plot")) {
    if (!plot.data?.length) continue;
    const opacity = plot.data.map((trace) => (runId === null ? (trace.mode === "markers" ? 0.9 : trace.hoverinfo === "skip" ? 0.7 : 0.8) : trace.meta?.[2] === runId ? 1 : 0.12));
    Plotly.restyle(plot, { opacity });
  }
}

let syncing = false;
function syncZoom(source, event) {
  if (syncing) return;
  let range = null;
  if (event["xaxis.range[0]"] !== undefined) range = [event["xaxis.range[0]"], event["xaxis.range[1]"]];
  else if (Array.isArray(event["xaxis.range"])) range = event["xaxis.range"];
  else if (event["xaxis.autorange"]) range = null;
  else return;
  state.xRange = range;
  syncing = true;
  const updates = [...document.querySelectorAll("#charts .chart-card .plot")].filter((plot) => plot !== source && plot.data).map((plot) => Plotly.relayout(plot, range ? { "xaxis.range": range, "xaxis.autorange": false } : { "xaxis.autorange": true }));
  Promise.all(updates).finally(() => { syncing = false; });
}

function resetZoom() {
  state.xRange = null;
  syncing = true;
  Promise.all([...document.querySelectorAll("#charts .chart-card .plot")].filter((plot) => plot.data).map((plot) => Plotly.relayout(plot, { "xaxis.autorange": true, "yaxis.autorange": true }))).finally(() => { syncing = false; });
}

function csvField(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(card, parameter) {
  if (!card.loaded) return;
  const timeColumn = state.align === "none" ? "time_h" : `time_since_${alignLabel().replaceAll(" ", "_")}_h`;
  const unit = displayUnit(parameter);
  const rows = [["culture_run_id", "experiment_id", "reactor_id", "source", timeColumn, `${parameter.id}${unit ? ` (${unit})` : ""}`]];
  for (const { run, main, curve } of card.loaded) {
    const sourceName = { inline: "inline", offline: "offline_raw", derived: "derived" }[parameter.source];
    main.t.forEach((t, index) => rows.push([run.culture_run_id, run.experiment_id, run.reactor_id, sourceName, t, main.v[index]]));
    if (curve) curve.t.forEach((t, index) => rows.push([run.culture_run_id, run.experiment_id, run.reactor_id, "offline_interpolated", t, curve.v[index]]));
  }
  saveCsv(rows, `cellsensing-${state.dataset.toLowerCase()}-${parameter.id}.csv`);
}

function saveCsv(rows, filename) {
  const blob = new Blob([rows.map((row) => row.map(csvField).join(",")).join("\n") + "\n"], { type: "text/csv" });
  const link = el("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ---------- parameter dialog ----------

function renderParameterOptions() {
  const query = byId("parameter-search").value.trim().toLowerCase();
  const container = byId("parameter-options");
  container.replaceChildren();
  const groups = new Map();
  for (const parameter of state.catalog.parameters.values()) {
    if (query && !`${parameter.label} ${parameter.group} ${parameter.id}`.toLowerCase().includes(query)) continue;
    if (!groups.has(parameter.group)) groups.set(parameter.group, []);
    groups.get(parameter.group).push(parameter);
  }
  const ordered = [...groups.keys()].sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
  if (!ordered.length) container.append(el("p", { class: "muted", text: "No measurement matches." }));
  for (const group of ordered) {
    const fieldset = el("fieldset", { class: "option-group" }, el("legend", { text: group }));
    for (const parameter of groups.get(group)) {
      fieldset.append(el("label", { class: "option" },
        el("input", { type: "checkbox", checked: state.parameters.includes(parameter.key), onchange: (event) => {
          if (event.target.checked) state.parameters.push(parameter.key); else state.parameters = state.parameters.filter((key) => key !== parameter.key);
          writeExploreHash();
          renderCharts();
          announce(`${parameter.name} ${event.target.checked ? "added" : "removed"}`);
        } }),
        el("span", { text: parameter.label })));
    }
    container.append(fieldset);
  }
}

function openParameterDialog() {
  byId("parameter-search").value = "";
  renderParameterOptions();
  byId("parameter-dialog").showModal();
  byId("parameter-search").focus();
}

function removeParameter(key) {
  const parameter = state.catalog.parameters.get(key);
  state.parameters = state.parameters.filter((item) => item !== key);
  state.interpolated.delete(key);
  writeExploreHash();
  renderCharts();
  announce(`${parameter.name} removed`);
  byId("add-parameter").focus();
}

// ---------- normalising and aligning ----------

function plainName(parameter) {
  return parameter.name.replace(/\s*\([^()]*\)$/, "");
}

function alignOptions() {
  const options = [{ id: "none", label: "Process time" }];
  if (state.catalog?.parameters.has("inline:cumulative_feed_weight_g")) options.push({ id: "feed", label: "Time since feed start" });
  const first = state.catalog?.parameters.get(state.parameters[0]);
  options.push({ id: "peak", label: first ? `Time since maximum of ${plainName(first)}` : "Time since maximum of the first chart", disabled: !first });
  return options;
}

function alignLabel() {
  if (state.align === "feed") return "feed start";
  const first = state.catalog.parameters.get(state.parameters[0]);
  return first ? `maximum of ${plainName(first)}` : "maximum of the first chart";
}

const eventCache = new Map();

// Time of the alignment event per cultivation, or null where the cultivation has no such event.
async function eventTimes(runIds) {
  const times = new Map();
  if (state.align === "none") return times;
  const align = state.align;
  const first = state.catalog.parameters.get(state.parameters[0]);
  await Promise.all(runIds.map(async (runId) => {
    const key = `${state.dataset}|${align}|${align === "peak" ? first?.key : ""}|${runId}`;
    if (!eventCache.has(key)) eventCache.set(key, eventTime(align, first, runId));
    times.set(runId, await eventCache.get(key));
  }));
  return times;
}

async function eventTime(align, first, runId) {
  if (align === "feed") {
    const feed = await loadSeries(runId, "inline", "cumulative_feed_weight_g");
    const index = feed.v.findIndex((value) => typeof value === "number" && value > 0);
    return index < 0 ? null : feed.t[index];
  }
  if (!first?.runIds.has(runId)) return null;
  const { main } = await loadParameterSeries(first, runId, false);
  let best = null, at = null;
  main.v.forEach((value, index) => { if (typeof value === "number" && (best === null || value > best)) { best = value; at = main.t[index]; } });
  return at;
}

function transformSeries(series, shift) {
  let scale = 1;
  if (state.normalize === "max") {
    let maximum = 0;
    for (const values of [series.main.v, series.curve?.v ?? []]) for (const value of values) if (typeof value === "number" && Math.abs(value) > maximum) maximum = Math.abs(value);
    if (maximum > 0) scale = 100 / maximum;
  }
  const apply = (part) => part && {
    t: shift ? part.t.map((t) => t - shift) : part.t,
    v: scale === 1 ? part.v : part.v.map((value) => (typeof value === "number" ? value * scale : value)),
  };
  return { main: apply(series.main), curve: apply(series.curve) };
}

function renderMoreOptions() {
  const align = byId("align");
  align.replaceChildren(...alignOptions().map((option) => el("option", { value: option.id, disabled: option.disabled, selected: option.id === state.align, text: option.label })));
  byId("normalize").value = state.normalize;
  const changed = (state.normalize !== "none") + (state.align !== "none");
  byId("more-options-count").textContent = changed ? `(${changed} changed)` : "";
}

// ---------- sensor against sample ----------

function correlationSensors() {
  return [...state.catalog.parameters.values()].filter((parameter) => parameter.source === "inline");
}

function correlationSamples() {
  return [...state.catalog.parameters.values()].filter((parameter) => parameter.source === "offline");
}

function renderCorrelationControls() {
  for (const [id, parameters, selected] of [["correlation-x", correlationSensors(), state.correlationX], ["correlation-y", correlationSamples(), state.correlationY]]) {
    const groups = new Map();
    for (const parameter of parameters) {
      if (!groups.has(parameter.group)) groups.set(parameter.group, []);
      groups.get(parameter.group).push(parameter);
    }
    const ordered = [...groups.keys()].sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
    byId(id).replaceChildren(...ordered.map((group) => el("optgroup", { label: group }, ...groups.get(group).map((parameter) => el("option", { value: parameter.key, selected: parameter.key === selected, text: parameter.label })))));
  }
}

const PAIRING_WINDOW_HOURS = 0.1;

function nearestIndex(times, target) {
  let low = 0, high = times.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] < target) low = middle + 1; else high = middle;
  }
  return low > 0 && Math.abs(times[low - 1] - target) < Math.abs(times[low] - target) ? low - 1 : low;
}

function leastSquares(points) {
  const n = points.length;
  if (n < 3) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const { x, y } of points) { sxx += (x - meanX) ** 2; sxy += (x - meanX) * (y - meanY); syy += (y - meanY) ** 2; }
  if (sxx === 0 || syy === 0) return null;
  const slope = sxy / sxx;
  return { n, slope, intercept: meanY - slope * meanX, r2: (sxy * sxy) / (sxx * syy), minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)) };
}

const correlation = { token: 0, loaded: null };

async function drawCorrelation() {
  const token = ++correlation.token;
  const status = byId("correlation-status");
  const plot = byId("correlation-plot");
  const table = byId("fit-table");
  const sensor = state.catalog.parameters.get(state.correlationX);
  const sample = state.catalog.parameters.get(state.correlationY);
  const runIds = sensor && sample ? visibleRunIds().filter((runId) => sensor.runIds.has(runId) && sample.runIds.has(runId)) : [];
  if (!runIds.length) {
    Plotly.purge(plot);
    plot.hidden = true;
    table.replaceChildren();
    status.textContent = "No cultivation selected that has both measurements.";
    return;
  }
  const slow = setTimeout(() => { if (correlation.token === token) status.textContent = `Loading ${runIds.length} cultivations…`; }, 400);
  let results;
  try {
    results = await Promise.all(runIds.map(async (runId) => {
      const [x, y] = await Promise.all([loadSeries(runId, "inline", sensor.id), loadSeries(runId, "offline_raw", sample.id)]);
      const pairs = [];
      y.t.forEach((time, index) => {
        const value = y.v[index];
        if (typeof value !== "number" || !x.t.length) return;
        const nearest = nearestIndex(x.t, time);
        if (Math.abs(x.t[nearest] - time) <= PAIRING_WINDOW_HOURS && typeof x.v[nearest] === "number") pairs.push({ t: time, x: x.v[nearest], y: value });
      });
      return { run: state.catalog.runs.get(runId), pairs };
    }));
  } catch (error) {
    clearTimeout(slow);
    if (correlation.token !== token) return;
    status.replaceChildren(`Could not load the data (${error.message}). `, el("button", { type: "button", class: "link-button", text: "Retry", onclick: drawCorrelation }));
    return;
  }
  clearTimeout(slow);
  if (correlation.token !== token) return;
  correlation.loaded = { sensor, sample, results };
  const scheme = colorScheme();
  const traces = [];
  const groups = new Map();
  for (const { run, pairs } of results) {
    if (!pairs.length) continue;
    const label = scheme.groupOf(run) || "All shown";
    if (!groups.has(label)) groups.set(label, { color: scheme.colorOf(run), points: [] });
    groups.get(label).points.push(...pairs);
    traces.push({
      type: LINE_TRACE, mode: "markers", x: pairs.map((pair) => pair.x), y: pairs.map((pair) => pair.y), customdata: pairs.map((pair) => pair.t),
      marker: { color: scheme.colorOf(run), size: 8, line: { color: cssVar("--surface"), width: 1 } }, opacity: 0.85,
      meta: [`${run.experiment_id} · ${run.reactor_id}`, [conditionSummary(run.experiment_id), noteFor(run)].filter(Boolean).join(" · ")],
      hovertemplate: `<b>%{meta[0]}</b><br>%{meta[1]}<br>Sample at %{customdata:.1f} h<br>${plainName(sensor)}: %{x:.5~g}${sensor.unit ? ` ${sensor.unit}` : ""}<br>${plainName(sample)}: %{y:.5~g}${sample.unit ? ` ${sample.unit}` : ""}<extra></extra>`,
    });
  }
  const fits = [...groups].map(([label, group]) => ({ label, color: group.color, fit: leastSquares(group.points) }));
  for (const { color, fit } of fits) if (fit) traces.push({ type: "scatter", mode: "lines", x: [fit.minX, fit.maxX], y: [fit.intercept + fit.slope * fit.minX, fit.intercept + fit.slope * fit.maxX], line: { color, width: 2.25 }, hoverinfo: "skip" });
  const all = leastSquares([...groups.values()].flatMap((group) => group.points));
  const pairCount = [...groups.values()].reduce((sum, group) => sum + group.points.length, 0);
  if (!pairCount) {
    Plotly.purge(plot);
    plot.hidden = true;
    table.replaceChildren();
    status.textContent = "No offline sample has an inline value within 6 minutes.";
    return;
  }
  status.textContent = "";
  plot.hidden = false;
  const format = formatNumber;
  table.replaceChildren(
    el("caption", { class: "visually-hidden", text: `Least-squares fit of ${plainName(sample)} against ${plainName(sensor)}` }),
    el("thead", {}, el("tr", {}, ...["Group", "Samples", "Slope", "Intercept", "R²"].map((heading) => el("th", { scope: "col", text: heading })))),
    el("tbody", {}, ...[...fits, ...(fits.length > 1 ? [{ label: "All shown", fit: all }] : [])].map(({ label, color, fit }) => el("tr", {},
      el("th", { scope: "row" }, color ? el("span", { class: "swatch", style: `background:${color}` }) : null, ` ${label}`),
      el("td", { text: fit ? String(fit.n) : "fewer than 3" }),
      el("td", { text: format(fit?.slope) }),
      el("td", { text: format(fit?.intercept) }),
      el("td", { text: fit ? fit.r2.toFixed(2) : "–" }),
    ))),
  );
  byId("correlation-description").textContent = `Scatter plot of ${sample.label} against ${sensor.label}, ${pairCount} samples from ${results.length} cultivations. The table below lists the fitted lines.`;
  const layout = plotLayout(sensor);
  layout.xaxis = { ...layout.xaxis, title: { ...layout.xaxis.title, text: sensor.label }, range: undefined, autorange: true };
  layout.yaxis = { ...layout.yaxis, title: { ...layout.yaxis.title, text: sample.label } };
  await Plotly.react(plot, traces, layout, PLOT_CONFIG);
}

// Four significant digits; powers of ten outside 0.001 to 100 000, as on the chart axes.
function formatNumber(value) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "–";
  if (value === 0) return "0";
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  if (magnitude >= -3 && magnitude < 5) return Number(value.toPrecision(4)).toLocaleString("en", { maximumSignificantDigits: 4 });
  const mantissa = Number((value / 10 ** magnitude).toPrecision(4));
  const superscript = String(magnitude).replace("-", "⁻").replace(/\d/g, (digit) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[digit]);
  return `${mantissa} × 10${superscript}`;
}

function downloadCorrelationCsv() {
  if (!correlation.loaded) return;
  const { sensor, sample, results } = correlation.loaded;
  const rows = [["culture_run_id", "experiment_id", "reactor_id", "sample_time_h", `${sensor.id}${sensor.unit ? ` (${sensor.unit})` : ""}`, `${sample.id}${sample.unit ? ` (${sample.unit})` : ""}`]];
  for (const { run, pairs } of results) for (const pair of pairs) rows.push([run.culture_run_id, run.experiment_id, run.reactor_id, pair.t, pair.x, pair.y]);
  saveCsv(rows, `cellsensing-${state.dataset.toLowerCase()}-${sample.id}-vs-${sensor.id}.csv`);
}

// ---------- share and cite ----------

function shortAuthor(name) {
  const [family, given = ""] = name.split(", ");
  return `${family}, ${given.split(/[\s-]+/).map((part) => `${part[0]}.`).join(" ")}`;
}

function citationText(citation) {
  const authors = citation.authors.map(shortAuthor);
  return `${authors.slice(0, -1).join(", ")}, & ${authors.at(-1)} (${citation.year}). ${citation.title} [Data set]. Zenodo. https://doi.org/${citation.doi}`;
}

function bibtex(citation) {
  return [
    `@dataset{${citation.key},`,
    `  author    = {${citation.authors.join(" and ")}},`,
    `  title     = {{${citation.title}}},`,
    `  year      = {${citation.year}},`,
    "  publisher = {Zenodo},",
    `  doi       = {${citation.doi}},`,
    `  url       = {https://doi.org/${citation.doi}}`,
    "}",
  ].join("\n");
}

function pythonSnippet() {
  const series = [];
  const notes = [];
  const add = (source, id) => { if (!series.some(([s, i]) => s === source && i === id)) series.push([source, id]); };
  const shown = state.view === "correlation" ? [state.correlationX, state.correlationY] : state.parameters;
  for (const key of shown) {
    const parameter = state.catalog.parameters.get(key);
    if (!parameter) continue;
    if (parameter.source === "inline") add("inline", parameter.id);
    else if (parameter.source === "offline") {
      add("offline_raw", parameter.id);
      if (state.interpolated.has(key) || state.display === "summary") add("offline_interpolated", parameter.id);
    } else {
      add(...parameter.from);
      notes.push(`# ${parameter.name} is computed from ${parameter.from[0]} ${parameter.from[1]}: ${parameter.help.replace(/^Computed here (from the interpolated viable cell density: |as )/, "")}.`);
    }
  }
  const base = new URL("data/series", location.href.split("#")[0]).href;
  const runs = visibleRunIds().sort();
  return [
    "import json",
    "from urllib.error import HTTPError",
    "from urllib.request import urlopen",
    "",
    "import pandas as pd",
    "",
    `BASE = "${base}"`,
    "RUNS = [",
    ...runs.map((runId) => `    "${runId}",`),
    "]",
    "SERIES = [",
    ...series.map(([source, id]) => `    ("${source}", "${id}"),`),
    "]",
    ...(notes.length ? ["", ...notes] : []),
    "",
    "",
    "def load(run, source, measurement):",
    "    folder = f\"{BASE}/{run.replace(':', '/')}/{source}\"",
    "    try:",
    "        time = json.load(urlopen(f\"{folder}/time.json\"))[\"t\"]",
    "        values = json.load(urlopen(f\"{folder}/{measurement}.json\"))[\"v\"]",
    "    except HTTPError:",
    "        return None  # this cultivation does not have the measurement",
    "    return pd.DataFrame({\"culture_run_id\": run, \"source\": source, \"measurement\": measurement, \"time_h\": time, \"value\": values})",
    "",
    "",
    "frames = [load(run, source, measurement) for run in RUNS for source, measurement in SERIES]",
    "data = pd.concat([frame for frame in frames if frame is not None], ignore_index=True)",
    "print(data.groupby([\"measurement\", \"source\"]).size())",
  ].join("\n");
}

function openShareDialog() {
  writeExploreHash();
  const citation = DATASETS[state.dataset].citation;
  byId("share-link").value = location.href;
  byId("share-citation").textContent = citationText(citation);
  byId("share-bibtex").textContent = bibtex(citation);
  byId("share-python").textContent = pythonSnippet();
  byId("share-dialog").showModal();
}

async function copyFrom(button) {
  const source = byId(button.dataset.copy);
  const text = source.value ?? source.textContent;
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
    announce("Copied to the clipboard");
  } catch {
    button.textContent = "Select and copy by hand";
  }
  setTimeout(() => { button.textContent = label; }, 2000);
}

// ---------- views ----------

function setView(view) {
  state.view = view;
  document.querySelectorAll("#view-switch input").forEach((input) => { input.checked = input.value === view; });
  byId("time-view").hidden = view !== "time";
  byId("correlation-view").hidden = view !== "correlation";
  document.querySelectorAll(".time-only").forEach((element) => { element.hidden = view !== "time"; });
  renderLegend();
  redrawAll();
}

// ---------- flows ----------

function selectionChanged() {
  renderConditionFilters();
  renderExperimentList();
  if (colorOptions().find((option) => option.id === state.colorBy)?.disabled) state.colorBy = state.catalog.conditions[0]?.id ?? "none";
  renderColorBy();
  renderLegend();
  writeExploreHash();
  redrawAll();
  announce(`${visibleRunIds().length} cultivations shown`);
}

async function switchDataset(dataset, params = new URLSearchParams()) {
  state.dataset = dataset;
  state.xRange = null;
  renderDatasetSwitch();
  byId("charts").replaceChildren();
  byId("charts").append(el("p", { class: "muted", text: "Loading dataset…" }));
  try {
    state.catalog = await loadCatalog(dataset);
  } catch (error) {
    byId("charts").replaceChildren(el("p", {}, `Could not load the dataset (${error.message}). `, el("button", { type: "button", class: "link-button", text: "Retry", onclick: () => switchDataset(dataset, params) })));
    return;
  }
  if (state.dataset !== dataset) return;
  applyExploreParams(params);
  renderHeroStats();
  byId("charts").replaceChildren();
  renderConditionFilters();
  renderExperimentList();
  renderColorBy();
  renderCorrelationControls();
  writeExploreHash();
  renderCharts();
  setView(state.view);
}

// ---------- routing ----------

const TITLES = { explore: "Explore", datasets: "Datasets", project: "Project" };

function route() {
  const { path, params } = readHash();
  const [view, sub] = path.split("/");
  const known = ["explore", "datasets", "project"].includes(view) ? view : "explore";
  document.querySelectorAll(".view").forEach((section) => { section.hidden = section.dataset.view !== known; });
  document.querySelectorAll("[data-nav]").forEach((link) => { if (link.dataset.nav === known) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
  if (known === "explore") {
    document.title = "Explore · CellSENSING Data";
    const dataset = DATASETS[params.get("ds")] ? params.get("ds") : state.dataset;
    if (!state.catalog || dataset !== state.dataset || params.has("m")) switchDataset(dataset, params);
    else writeExploreHash();
  } else if (known === "datasets") {
    const key = sub === "yeast" ? "yeast" : "cho";
    const dataset = key === "cho" ? "CHO" : "yeast";
    document.title = `${DATASETS[dataset].longLabel} · Datasets · CellSENSING Data`;
    document.querySelectorAll("[data-dataset-tab]").forEach((link) => { if (link.dataset.datasetTab === key) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
    byId("dataset-explore-link").href = `#explore?ds=${dataset}`;
    byId("dataset-doi-link").href = DATASETS[dataset].doi;
    window.setDataInformationDataset?.(key);
  } else {
    document.title = `${TITLES[known]} · CellSENSING Data`;
  }
}

function init() {
  byId("add-parameter").addEventListener("click", openParameterDialog);
  document.querySelector("[data-action=add-parameter]").addEventListener("click", openParameterDialog);
  byId("parameter-search").addEventListener("input", renderParameterOptions);
  byId("color-by").addEventListener("change", (event) => { state.colorBy = event.target.value; renderLegend(); writeExploreHash(); redrawAll(); });
  byId("display").addEventListener("change", (event) => { state.display = event.target.value; highlighted = null; renderLegend(); writeExploreHash(); redrawAll(); });
  byId("reset-zoom").addEventListener("click", resetZoom);
  byId("share").addEventListener("click", openShareDialog);
  document.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", () => copyFrom(button)));
  document.querySelectorAll("#view-switch input").forEach((input) => input.addEventListener("change", () => { setView(input.value); writeExploreHash(); }));
  byId("correlation-x").addEventListener("change", (event) => { state.correlationX = event.target.value; writeExploreHash(); drawCorrelation(); });
  byId("correlation-y").addEventListener("change", (event) => { state.correlationY = event.target.value; writeExploreHash(); drawCorrelation(); });
  byId("correlation-csv").addEventListener("click", downloadCorrelationCsv);
  for (const id of ["normalize", "align"]) {
    byId(id).addEventListener("change", (event) => {
      state[id] = event.target.value;
      state.xRange = null;
      renderMoreOptions();
      writeExploreHash();
      redrawAll();
    });
  }
  byId("select-all").addEventListener("click", () => { state.catalog.runs.forEach((_, runId) => state.selected.add(runId)); selectionChanged(); });
  byId("select-none").addEventListener("click", () => { state.selected.clear(); selectionChanged(); });
  if (window.matchMedia("(max-width: 900px)").matches) byId("runs-panel").open = false;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (state.catalog) { renderLegend(); redrawAll(); } });
  window.addEventListener("hashchange", route);
  route();
}

init();
