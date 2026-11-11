"use strict";

// The static build puts the data next to this page; the classic view in /classic/ reads the same files.
const DATA_ROOT = "data";

const DATASETS = {
  CHO: {
    label: "CHO",
    longLabel: "CHO cultivations",
    about: "cho",
    doi: "https://doi.org/10.5281/zenodo.20829177",
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

const GROUP_ORDER = ["Offline analytics", "Dielectric spectroscopy", "Dissolved O2", "Dissolved CO2", "pH", "Temperature", "Turbidity", "Offgas", "Base Addition", "Feed", "Gas Supply", "Agitation", "Antifoam", "Liquid Volume", "Other", "Dielectric spectroscopy: single frequencies"];

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
  return { dataset, conditions, experiments, runs, parameters };
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
  if (state.display === "summary") {
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
    xaxis: { ...axis, title: { ...axis.title, text: "Time (h)" }, range: state.xRange ?? undefined, autorange: state.xRange ? false : true },
    yaxis: { ...axis, title: { ...axis.title, text: parameter.unit || "" }, exponentformat: "power" },
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
  const sourceLabel = parameter.source === "inline" ? "Inline sensor, every 60 s" : "Offline samples";
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
  cards.forEach((card) => drawChart(card, state.catalog.parameters.get(card.dataset.key)));
}

function redrawAll() {
  document.querySelectorAll(".chart-card").forEach((card) => drawChart(card, state.catalog.parameters.get(card.dataset.key)));
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
    results = await Promise.all(runIds.map(async (runId) => ({
      run: state.catalog.runs.get(runId),
      main: await loadSeries(runId, parameter.source === "inline" ? "inline" : "offline_raw", parameter.id),
      curve: withInterpolation ? await loadSeries(runId, "offline_interpolated", parameter.id) : null,
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
  const traces = summary ? summaryTraces(results, parameter) : runTraces(results, parameter);
  if (!traces.length) {
    Plotly.purge(plot);
    plot.hidden = true;
    status.textContent = "This measurement has no numeric values to summarise. Switch the display to each cultivation.";
    return;
  }
  status.textContent = "";
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

function runTraces(results, parameter) {
  const scheme = colorScheme();
  const unit = parameter.unit ? ` ${parameter.unit}` : "";
  const traces = [];
  for (const { run, main, curve } of results) {
    const color = scheme.colorOf(run);
    const meta = [`${run.experiment_id} · ${run.reactor_id}`, [conditionSummary(run.experiment_id), noteFor(run)].filter(Boolean).join(" · "), run.culture_run_id];
    const hovertemplate = `<b>%{meta[0]}</b><br>%{meta[1]}<br>%{x:.2f} h: <b>%{y:.5~g}${unit}</b><extra></extra>`;
    if (curve) traces.push({ type: "scattergl", mode: "lines", x: curve.t, y: curve.v, line: { color, width: 1.25, dash: "dot" }, opacity: 0.7, hoverinfo: "skip", meta });
    traces.push(parameter.source === "inline"
      ? { type: "scattergl", mode: "lines", x: main.t, y: main.v, line: { color, width: 1.5 }, opacity: 0.8, connectgaps: false, meta, hovertemplate }
      : { type: "scattergl", mode: "markers", x: main.t, y: main.v, marker: { color, size: 8, line: { color: cssVar("--surface"), width: 1 } }, opacity: 0.9, meta, hovertemplate });
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
  const unit = parameter.unit ? ` ${parameter.unit}` : "";
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
  for (const plot of document.querySelectorAll(".chart-card .plot")) {
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
  const updates = [...document.querySelectorAll(".chart-card .plot")].filter((plot) => plot !== source && plot.data).map((plot) => Plotly.relayout(plot, range ? { "xaxis.range": range, "xaxis.autorange": false } : { "xaxis.autorange": true }));
  Promise.all(updates).finally(() => { syncing = false; });
}

function resetZoom() {
  state.xRange = null;
  syncing = true;
  Promise.all([...document.querySelectorAll(".chart-card .plot")].filter((plot) => plot.data).map((plot) => Plotly.relayout(plot, { "xaxis.autorange": true, "yaxis.autorange": true }))).finally(() => { syncing = false; });
}

function csvField(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(card, parameter) {
  if (!card.loaded) return;
  const rows = [["culture_run_id", "experiment_id", "reactor_id", "source", "time_h", `${parameter.id}${parameter.unit ? ` (${parameter.unit})` : ""}`]];
  for (const { run, main, curve } of card.loaded) {
    const sourceName = parameter.source === "inline" ? "inline" : "offline_raw";
    main.t.forEach((t, index) => rows.push([run.culture_run_id, run.experiment_id, run.reactor_id, sourceName, t, main.v[index]]));
    if (curve) curve.t.forEach((t, index) => rows.push([run.culture_run_id, run.experiment_id, run.reactor_id, "offline_interpolated", t, curve.v[index]]));
  }
  const blob = new Blob([rows.map((row) => row.map(csvField).join(",")).join("\n") + "\n"], { type: "text/csv" });
  const link = el("a", { href: URL.createObjectURL(blob), download: `cellsensing-${state.dataset.toLowerCase()}-${parameter.id}.csv` });
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
  byId("charts").replaceChildren();
  renderConditionFilters();
  renderExperimentList();
  renderColorBy();
  renderLegend();
  writeExploreHash();
  renderCharts();
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
  byId("copy-link").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      announce("Link copied");
      byId("copy-link").textContent = "Link copied";
    } catch {
      byId("copy-link").textContent = "Copy the address bar";
    }
    setTimeout(() => { byId("copy-link").textContent = "Copy link"; }, 2000);
  });
  byId("select-all").addEventListener("click", () => { state.catalog.runs.forEach((_, runId) => state.selected.add(runId)); selectionChanged(); });
  byId("select-none").addEventListener("click", () => { state.selected.clear(); selectionChanged(); });
  if (window.matchMedia("(max-width: 900px)").matches) byId("runs-panel").open = false;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (state.catalog) { renderLegend(); redrawAll(); } });
  window.addEventListener("hashchange", route);
  route();
}

init();
