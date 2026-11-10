const byId = (id) => document.getElementById(id);

const state = {
  cellType: null,
  sourceKind: null,
  generation: 0,
  globalExperiments: new Set(),
  metadataFilterSelections: new Map(),
  experimentMetadata: new Map(),
  openPanelExperimentSelector: null,
  globalVisualEncoding: { colorBy: "experiment", markerBy: "none" },
  overview: null,
};

const sourceKindLabels = {
  inline: "Inline",
  offline_raw: "Offline",
  offline_interpolated: "Offline interpolated",
};

const colorPalette = ["#2563a6", "#dc2626", "#059669", "#7c3aed", "#d97706", "#0891b2", "#be123c", "#4d7c0f", "#9333ea"];
const markerPalette = ["circle", "square", "diamond", "triangle-up", "triangle-down", "cross", "x", "pentagon", "hexagon"];
const lineDashPalette = ["solid", "dash", "dot", "dashdot"];

function selectionChip(label, selected, onClick, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = `selection-chip ${selected ? "selected" : "deselected"} ${extraClass}`.trim();
  button.addEventListener("click", onClick);
  return button;
}

function actionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = "selection-action";
  button.addEventListener("click", onClick);
  return button;
}

function renderTopLevelControls() {
  const sourceKind = byId("source-kind");
  sourceKind.replaceChildren(
    ...Object.entries(sourceKindLabels).map(([value, label]) => selectionChip(label, state.sourceKind === value, () => {
      state.sourceKind = value;
      buildDashboard();
    }, "source-kind-chip")),
  );
}

function setPageStatus(message = "") {
  const status = byId("status");
  status.textContent = message;
  status.hidden = !message;
}

function experimentIdFromTrace(trace) {
  return trace.culture_run_id.split(":")[1];
}

function isExperimentEffectivelyVisible(panel, experimentId) {
  return isExperimentGloballyEffective(experimentId) && panel.localExperiments.has(experimentId);
}

function isExperimentMetadataEligible(experimentId) {
  return state.overview.filter_dimensions.every((dimension) => dimension.values.some(
    (value) => state.metadataFilterSelections.get(dimension.id).has(value.id) && value.experiment_ids.includes(experimentId),
  ));
}

function isExperimentGloballyEffective(experimentId) {
  return isExperimentMetadataEligible(experimentId) && state.globalExperiments.has(experimentId);
}

function buildExperimentMetadata() {
  state.experimentMetadata = new Map(state.overview.experiments.map((item) => [item.experiment_id, new Map()]));
  state.overview.filter_dimensions.forEach((dimension) => dimension.values.forEach((value) => value.experiment_ids.forEach((experimentId) => {
    state.experimentMetadata.get(experimentId).set(dimension.id, { id: value.id, label: value.label, index: dimension.values.indexOf(value) });
  })));
}

function visualMetadata(experimentId, dimensionId) {
  return state.experimentMetadata.get(experimentId).get(dimensionId);
}

function stableExperimentIndex(experimentId) {
  return state.overview.experiments.findIndex((item) => item.experiment_id === experimentId);
}

function visualColor(panel, experimentId) {
  const colorBy = getEffectivePanelColorBy(panel);
  if (colorBy === "experiment") return colorPalette[stableExperimentIndex(experimentId) % colorPalette.length];
  return visualColorForValue(colorBy, visualMetadata(experimentId, colorBy).id);
}

function visualColorForValue(dimensionId, valueId) {
  const dimension = state.overview.filter_dimensions.find((item) => item.id === dimensionId);
  return colorPalette[dimension.values.findIndex((value) => value.id === valueId) % colorPalette.length];
}

function visualMarker(panel, experimentId) {
  const markerBy = getEffectivePanelMarkerBy(panel);
  if (markerBy === "none") return null;
  return visualMarkerForValue(markerBy, visualMetadata(experimentId, markerBy).id);
}

function getEffectivePanelColorBy(panel) { return (panel.visualEncodingOverride || state.globalVisualEncoding).colorBy; }
function getEffectivePanelMarkerBy(panel) { return (panel.visualEncodingOverride || state.globalVisualEncoding).markerBy; }

function visualMarkerForValue(dimensionId, valueId) {
  const dimension = state.overview.filter_dimensions.find((item) => item.id === dimensionId);
  return markerPalette[dimension.values.findIndex((value) => value.id === valueId) % markerPalette.length];
}

function reactorDash(reactorId) {
  const index = Array.from(reactorId).reduce((total, character) => total + character.charCodeAt(0), 0);
  return lineDashPalette[index % lineDashPalette.length];
}

function setPanelStatus(panel, message = "") {
  const status = panel.querySelector(".panel-status");
  status.textContent = message;
  status.hidden = !message;
}

function clearPlot(plot) {
  if (plot.data) Plotly.purge(plot);
  plot.replaceChildren();
  plot.hidden = true;
}

function resizePlots(entry) {
  if (entry.target.dataset.expanded !== "true") return;
  entry.target.querySelectorAll('.panel[data-expanded="true"] .panel-collapsible-content:not([hidden]) .plot').forEach((plot) => {
    try {
      if (plot.data) Plotly.Plots.resize(plot);
    } catch (error) {
      console.error("Unable to resize a dashboard plot.", error);
    }
  });
}

const resizeObserver = new ResizeObserver((entries) => {
  window.requestAnimationFrame(() => entries.forEach(resizePlots));
});

function renderGlobalExperiments() {
  const container = byId("global-experiments");
  if (!state.overview) {
    container.replaceChildren();
    return;
  }
  const experiments = state.overview.experiments.map((item) => item.experiment_id);
  const heading = document.createElement("h2");
  heading.textContent = "Experiments";
  heading.className = "experiment-heading";
  container.replaceChildren(
    heading,
    actionButton("All", () => {
      state.globalExperiments = new Set(experiments);
      renderGlobalExperiments();
      redrawLoadedPanels();
    }),
    actionButton("None", () => {
      state.globalExperiments.clear();
      renderGlobalExperiments();
      redrawLoadedPanels();
    }),
    ...experiments.map((experimentId) => selectionChip(experimentId, isExperimentGloballyEffective(experimentId), () => {
      if (state.globalExperiments.has(experimentId)) state.globalExperiments.delete(experimentId);
      else state.globalExperiments.add(experimentId);
      renderGlobalExperiments();
      redrawLoadedPanels();
    }, "experiment-chip")),
  );
}

function renderMetadataFilters() {
  const container = byId("metadata-filters");
  if (!state.overview) {
    container.replaceChildren();
    return;
  }
  const heading = document.createElement("h2");
  heading.textContent = "Experiment Filters";
  heading.className = "experiment-heading";
  const controls = [heading];
  state.overview.filter_dimensions.forEach((dimension) => {
    const label = document.createElement("span");
    label.className = "metadata-filter-label";
    label.textContent = dimension.label;
    controls.push(label, ...dimension.values.map((value) => selectionChip(value.label, state.metadataFilterSelections.get(dimension.id).has(value.id), () => {
      const selected = state.metadataFilterSelections.get(dimension.id);
      if (selected.has(value.id)) selected.delete(value.id);
      else selected.add(value.id);
      renderMetadataFilters();
      renderGlobalExperiments();
      redrawLoadedPanels();
    }, "metadata-filter-chip")));
  });
  container.replaceChildren(...controls);
}

function encodingSelect(label, selected, choices, onSelect) {
  const wrapper = document.createElement("label"); wrapper.className = "visual-encoding-select"; wrapper.append(`${label} `);
  const input = document.createElement("select");
  choices.forEach((choice) => { const option = document.createElement("option"); option.value = choice.id; option.textContent = choice.label; option.selected = selected === choice.id; input.append(option); });
  input.addEventListener("change", () => onSelect(input.value)); wrapper.append(input); return wrapper;
}

function renderGlobalVisualEncoding() {
  const container = byId("global-visual-encoding");
  if (!state.overview) { container.replaceChildren(); return; }
  const heading = document.createElement("h2"); heading.textContent = "Visual Encoding"; heading.className = "experiment-heading";
  const update = () => redrawLoadedPanels();
  container.replaceChildren(
    heading,
    encodingSelect("Color by", state.globalVisualEncoding.colorBy, [{ id: "experiment", label: "Experiment" }, ...state.overview.filter_dimensions], (id) => { state.globalVisualEncoding.colorBy = id; update(); }),
    encodingSelect("Marker by", state.globalVisualEncoding.markerBy, [{ id: "none", label: "None" }, ...state.overview.filter_dimensions], (id) => { state.globalVisualEncoding.markerBy = id; update(); }),
  );
}

function subgroupKey(section, subgroup) {
  return `subgroup-${section.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${subgroup.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

const dynamicGroupPriorities = {
  CHO: ["subgroup-dynamic-sensor-data-dissolved-o2", "subgroup-dynamic-sensor-data-dissolved-co2", "subgroup-dynamic-sensor-data-dielectric-spectroscopy", "subgroup-dynamic-sensor-data-turbidity", "subgroup-dynamic-sensor-data-feed", "subgroup-dynamic-sensor-data-base-addition", "subgroup-dynamic-sensor-data-gas-supply", "subgroup-dynamic-sensor-data-agitation", "subgroup-dynamic-sensor-data-temperature", "subgroup-dynamic-sensor-data-liquid-volume"],
  yeast: ["subgroup-dynamic-sensor-data-dissolved-o2", "subgroup-dynamic-sensor-data-dissolved-co2", "subgroup-dynamic-sensor-data-dielectric-spectroscopy", "subgroup-dynamic-sensor-data-turbidity", "subgroup-dynamic-sensor-data-offgas", "subgroup-dynamic-sensor-data-gas-supply", "subgroup-dynamic-sensor-data-agitation", "subgroup-dynamic-sensor-data-antifoam", "subgroup-dynamic-sensor-data-ph", "subgroup-dynamic-sensor-data-temperature", "subgroup-dynamic-sensor-data-liquid-volume"],
};

function orderedInlineVisualizationParameters(parameters) {
  const priority = new Map((dynamicGroupPriorities[state.cellType] || []).map((key, index) => [key, index]));
  return parameters.map((parameter, index) => ({ parameter, index })).sort((left, right) => {
    const leftPriority = priority.get(subgroupKey(left.parameter.section, left.parameter.subgroup));
    const rightPriority = priority.get(subgroupKey(right.parameter.section, right.parameter.subgroup));
    return (leftPriority ?? Number.MAX_SAFE_INTEGER) - (rightPriority ?? Number.MAX_SAFE_INTEGER) || left.index - right.index;
  }).map(({ parameter }) => parameter);
}

function createScientificColumn() {
  const column = document.createElement("section");
  column.className = "scientific-column";
  const content = document.createElement("div");
  content.className = "scientific-column-content";
  column.append(content);
  return column;
}

let collapsiblePanelId = 0;

function resizeCollapsiblePlots(content) {
  window.requestAnimationFrame(() => {
    content.querySelectorAll(".panel-collapsible-content:not([hidden]) .plot").forEach((plot) => {
      try {
        if (plot.data) Plotly.Plots.resize(plot);
      } catch (error) {
        console.error("Unable to resize a collapsible dashboard plot.", error);
      }
    });
  });
}

function resizePanelPlot(panel) {
  window.requestAnimationFrame(() => {
    const plot = panel.querySelector(".plot");
    if (plot?.data) Plotly.Plots.resize(plot);
  });
}

function setGroupExpanded(group, expanded) {
  const control = group.querySelector(".collapsible-panel-header");
  const content = group.querySelector(".collapsible-panel-content");
  group.dataset.expanded = String(expanded);
  control.setAttribute("aria-expanded", String(expanded));
  content.hidden = !expanded;
  group.querySelector(".collapsible-panel-indicator").textContent = expanded ? "⌃" : "⌄";
}

function isSingleParameterGroup(group) {
  return group.parameters.size === 1;
}

function updatePanelPresentation(panel, directDisplay) {
  const toggle = panel.querySelector(".panel-collapse-toggle");
  const content = panel.querySelector(".panel-collapsible-content");
  panel.dataset.directDisplay = String(directDisplay);
  toggle.hidden = directDisplay;
  panel.dataset.expanded = String(directDisplay);
  toggle.setAttribute("aria-expanded", String(directDisplay));
  content.hidden = !directDisplay;
}

function syncGroupPanelPresentation(group) {
  const directDisplay = isSingleParameterGroup(group);
  group.querySelectorAll(".panel").forEach((panel) => {
    if (panel.dataset.directDisplay !== String(directDisplay)) updatePanelPresentation(panel, directDisplay);
  });
}

function orderedGroupParameters(group) {
  const parameters = Array.from(group.parameters.values());
  if (group.groupTitle !== "Dielectric Spectroscopy") return parameters;
  const standard = parameters.filter((parameter) => !parameter.advanced);
  const fittingQuality = parameters.filter((parameter) => parameter.parameter_id === "fitting_quality_cole_fit_r2");
  const fittingError = parameters.filter((parameter) => parameter.parameter_id === "fitting_error_cole_fit_rmse");
  const capacitance = parameters
    .filter((parameter) => /^c_\d+khz$/.test(parameter.parameter_id))
    .sort((left, right) => Number(left.parameter_id.match(/^c_(\d+)khz$/)[1]) - Number(right.parameter_id.match(/^c_(\d+)khz$/)[1]));
  const classified = new Set([...standard, ...fittingQuality, ...fittingError, ...capacitance]);
  return [...standard, ...fittingQuality, ...fittingError, ...capacitance, ...parameters.filter((parameter) => !classified.has(parameter))];
}

function positionAdvancedControl(group) {
  const control = group.querySelector("#advanced");
  if (!control) return;
  const standardPanels = Array.from(group.querySelectorAll(".panel")).filter((panel) => !panel.parameter.advanced);
  if (standardPanels.length) standardPanels[standardPanels.length - 1].after(control);
  else group.querySelector(".collapsible-panel-content").prepend(control);
}

function updatePanelGroupSummary(group) {
  const parameters = orderedGroupParameters(group);
  const summary = group.querySelector(".collapsible-panel-summary");
  const onlyParameter = parameters[0];
  const normalizedTitle = group.groupTitle.trim().toLowerCase().replace(/\s+/g, " ");
  const normalizedLabel = onlyParameter?.display_label.trim().toLowerCase().replace(/\s+/g, " ");
  const suppressSummary = parameters.length === 1 && normalizedTitle === normalizedLabel;
  summary.hidden = suppressSummary;
  summary.textContent = suppressSummary ? "" : parameters.map((parameter) => parameter.display_label).join(" · ");
}

async function initializePanelGroup(group) {
  const content = group.querySelector(".collapsible-panel-content");
  group.dataset.loadState = "loading";
  while (true) {
    const parameters = orderedGroupParameters(group).filter((parameter) => !group.renderedParameterIds.has(parameter.parameter_id));
    if (!parameters.length) {
      group.dataset.loadState = "loaded";
      return true;
    }
    const directDisplay = isSingleParameterGroup(group);
    const panels = parameters.map((parameter) => {
      const panel = createPanel(parameter, directDisplay);
      content.append(panel);
      group.renderedParameterIds.add(parameter.parameter_id);
      return panel;
    });
    positionAdvancedControl(group);
    const results = await Promise.all(panels.map((panel) => loadPanel(panel)));
    if (!results.every(Boolean)) {
      group.dataset.loadState = "error";
      return false;
    }
  }
}

function registerGroupParameter(group, parameter, deferInitialization = false) {
  if (group.parameters.has(parameter.parameter_id)) return;
  group.parameters.set(parameter.parameter_id, parameter);
  updatePanelGroupSummary(group);
  syncGroupPanelPresentation(group);
  if (!deferInitialization && !group.querySelector(".collapsible-panel-content").hidden && group.dataset.loadState === "loaded") {
    initializePanelGroup(group).then(() => resizeCollapsiblePlots(group.querySelector(".collapsible-panel-content")));
  }
}

function createCollapsiblePanelHeader(group, title, content) {
  const contentId = `collapsible-panel-content-${++collapsiblePanelId}`;
  content.id = contentId;
  content.classList.add("collapsible-panel-content");
  content.hidden = true;
  group.classList.add("collapsible-visual-panel");
  group.parameters = new Map();
  group.renderedParameterIds = new Set();
  group.groupTitle = title;
  group.dataset.loadState = "unloaded";
  group.dataset.expanded = "false";

  const control = document.createElement("button");
  control.type = "button";
  control.className = "collapsible-panel-header";
  control.setAttribute("aria-expanded", "false");
  control.setAttribute("aria-controls", contentId);
  const label = document.createElement("span");
  label.className = "collapsible-panel-label";
  const heading = document.createElement("span");
  heading.className = "collapsible-panel-title";
  heading.textContent = title;
  const summary = document.createElement("span");
  summary.className = "collapsible-panel-summary";
  label.append(heading, summary);
  const indicator = document.createElement("span");
  indicator.className = "collapsible-panel-indicator";
  indicator.setAttribute("aria-hidden", "true");
  indicator.textContent = "⌄";
  control.append(label, indicator);
  control.addEventListener("click", async () => {
    if (group.dataset.expanded === "true") {
      setGroupExpanded(group, false);
      return;
    }
    setGroupExpanded(group, true);
    if (group.dataset.loadState === "unloaded") await initializePanelGroup(group);
    if (group.dataset.expanded === "true") resizeCollapsiblePlots(content);
  });
  return control;
}

function ensureInlineLayout() {
  let content = byId("scientific-main-content");
  if (content) return content;
  content = document.createElement("div");
  content.id = "scientific-main-content";
  content.className = "scientific-main-content";
  content.append(createScientificColumn());
  byId("panels").append(content);
  return content;
}

function ensureInlineSubgroup(parameter) {
  const content = ensureInlineLayout();
  const column = content.querySelector(".scientific-column");
  const key = subgroupKey(parameter.section, parameter.subgroup);
  let subgroup = byId(key);
  if (subgroup) return subgroup;
  subgroup = document.createElement("section");
  subgroup.id = key;
  subgroup.className = "subgroup-card";
  const panels = document.createElement("div");
  panels.className = "subgroup-panels";
  subgroup.append(createCollapsiblePanelHeader(subgroup, parameter.subgroup, panels), panels);
  column.querySelector(".scientific-column-content").append(subgroup);
  resizeObserver.observe(subgroup);
  return subgroup;
}

function ensureOfflineLayout() {
  let section = byId("offline-measurements");
  if (section) return section;
  section = document.createElement("section");
  section.id = "offline-measurements";
  section.className = "offline-measurements";
  const grid = document.createElement("div");
  grid.className = "offline-panel-grid";
  section.append(createCollapsiblePanelHeader(section, "Offline Measurements", grid), grid);
  byId("panels").append(section);
  return section;
}

function renderPanelExperiments(panel) {
  const chips = panel.querySelector(".panel-experiment-popover-chips");
  const experiments = state.overview.experiments.map((item) => item.experiment_id);
  const effectiveCount = experiments.filter((experimentId) => isExperimentEffectivelyVisible(panel, experimentId)).length;
  panel.querySelector(".panel-experiment-toggle").textContent = `Experiments (${effectiveCount}) ▾`;
  chips.replaceChildren(
    actionButton("All", () => {
      panel.localExperiments = new Set(experiments);
      renderPanelExperiments(panel); drawPanel(panel);
    }),
    actionButton("None", () => {
      panel.localExperiments.clear();
      renderPanelExperiments(panel); drawPanel(panel);
    }),
    ...experiments.map((experimentId) => {
      return selectionChip(experimentId, isExperimentEffectivelyVisible(panel, experimentId), () => {
        if (panel.localExperiments.has(experimentId)) panel.localExperiments.delete(experimentId);
        else panel.localExperiments.add(experimentId);
        renderPanelExperiments(panel);
        drawPanel(panel);
      }, "experiment-chip panel-experiment-chip");
    }),
  );
}

function markerKeyIcon(symbol, color = "#172033") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20"); svg.setAttribute("class", "encoding-key-icon");
  const shape = (tag, attributes) => { const node = document.createElementNS(svg.namespaceURI, tag); Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value)); svg.append(node); };
  const fill = { fill: color, stroke: color, "stroke-width": "1.5" };
  if (symbol === "circle") shape("circle", { cx: 10, cy: 10, r: 5, ...fill });
  else if (symbol === "square") shape("rect", { x: 5, y: 5, width: 10, height: 10, ...fill });
  else if (symbol === "diamond") shape("polygon", { points: "10,3 17,10 10,17 3,10", ...fill });
  else if (symbol === "triangle-up") shape("polygon", { points: "10,3 17,16 3,16", ...fill });
  else if (symbol === "triangle-down") shape("polygon", { points: "3,4 17,4 10,17", ...fill });
  else if (symbol === "pentagon") shape("polygon", { points: "10,2 18,8 15,18 5,18 2,8", ...fill });
  else if (symbol === "hexagon") shape("polygon", { points: "5,3 15,3 19,10 15,17 5,17 1,10", ...fill });
  else { const diagonal = symbol === "x"; shape("line", { x1: diagonal ? 4 : 10, y1: 4, x2: diagonal ? 16 : 10, y2: 16, ...fill }); shape("line", { x1: diagonal ? 16 : 4, y1: 4, x2: diagonal ? 4 : 16, y2: 16, ...fill }); }
  return svg;
}

function renderVisualEncodingKey(panel) {
  const key = panel.querySelector(".visual-encoding-key");
  const sections = [];
  [["Color", getEffectivePanelColorBy(panel), visualColorForValue], ["Marker", getEffectivePanelMarkerBy(panel), visualMarkerForValue]].forEach(([kind, dimensionId, mapper]) => {
    if (dimensionId === "experiment" || dimensionId === "none") return;
    const dimension = state.overview.filter_dimensions.find((item) => item.id === dimensionId);
    const section = document.createElement("div"); section.className = "encoding-key-section";
    const title = document.createElement("strong"); title.textContent = `${kind} · ${dimension.label}`; section.append(title);
    dimension.values.forEach((value) => { const entry = document.createElement("span"); entry.className = "encoding-key-entry"; entry.append(markerKeyIcon(kind === "Color" ? "circle" : mapper(dimensionId, value.id), kind === "Color" ? mapper(dimensionId, value.id) : "#172033"), document.createTextNode(value.label)); section.append(entry); });
    sections.push(section);
  });
  key.replaceChildren(...sections); key.hidden = !sections.length;
}

function renderVisualEncodingControls(panel) {
  const controls = panel.querySelector(".visual-encoding-controls");
  const redraw = () => { renderVisualEncodingControls(panel); drawPanel(panel); };
  if (!panel.visualEncodingOverride) {
    controls.replaceChildren(document.createTextNode("Using global encoding"), actionButton("Override", () => { panel.visualEncodingOverride = { ...state.globalVisualEncoding }; redraw(); }));
  } else {
    controls.replaceChildren(
      encodingSelect("Color by", panel.visualEncodingOverride.colorBy, [{ id: "experiment", label: "Experiment" }, ...state.overview.filter_dimensions], (id) => { panel.visualEncodingOverride.colorBy = id; redraw(); }),
      encodingSelect("Marker by", panel.visualEncodingOverride.markerBy, [{ id: "none", label: "None" }, ...state.overview.filter_dimensions], (id) => { panel.visualEncodingOverride.markerBy = id; redraw(); }),
      actionButton("Reset to global", () => { panel.visualEncodingOverride = null; redraw(); }),
    );
  }
  renderVisualEncodingKey(panel);
}

function createPanel(parameter, directDisplay = false) {
  const panel = document.createElement("article");
  panel.className = `panel${parameter.advanced ? " advanced" : ""}`;
  panel.dataset.parameterId = parameter.parameter_id;
  panel.dataset.loaded = "0";
  panel.dataset.expanded = String(directDisplay);
  panel.parameter = parameter;
  panel.localExperiments = new Set(state.overview.experiments.map((item) => item.experiment_id));
  panel.visualEncodingOverride = null;

  const contentId = `panel-collapsible-content-${++collapsiblePanelId}`;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "panel-collapse-toggle";
  toggle.setAttribute("aria-expanded", String(directDisplay));
  toggle.setAttribute("aria-controls", contentId);
  const title = document.createElement("span");
  title.className = "panel-title";
  title.textContent = parameter.display_label;
  const chevron = document.createElement("span");
  chevron.className = "panel-collapse-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "▸";
  toggle.append(title, chevron);
  const content = document.createElement("div");
  content.id = contentId;
  content.className = "panel-collapsible-content";
  content.hidden = !directDisplay;
  toggle.addEventListener("click", () => {
    const expanded = panel.dataset.expanded !== "true";
    panel.dataset.expanded = String(expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    content.hidden = !expanded;
    chevron.textContent = expanded ? "▾" : "▸";
    if (expanded) resizePanelPlot(panel);
  });
  toggle.hidden = directDisplay;
  panel.dataset.directDisplay = String(directDisplay);
  panel.append(toggle, content);
  if (parameter.help_text) {
    const help = document.createElement("small");
    help.className = "panel-help";
    help.textContent = parameter.help_text;
    content.append(help);
  }
  const panelControls = document.createElement("div");
  panelControls.className = "panel-controls";
  const selector = document.createElement("div"); selector.className = "panel-experiment-selector";
  const experimentToggle = document.createElement("button"); experimentToggle.type = "button"; experimentToggle.className = "selection-action panel-experiment-toggle";
  experimentToggle.addEventListener("click", (event) => { event.stopPropagation(); const opening = state.openPanelExperimentSelector !== panel; if (state.openPanelExperimentSelector) state.openPanelExperimentSelector.querySelector(".panel-experiment-popover").hidden = true; state.openPanelExperimentSelector = opening ? panel : null; selector.querySelector(".panel-experiment-popover").hidden = !opening; });
  const popover = document.createElement("div"); popover.className = "panel-experiment-popover"; popover.hidden = true;
  const popoverTitle = document.createElement("strong"); popoverTitle.textContent = "Experiments";
  const popoverChips = document.createElement("div"); popoverChips.className = "chips panel-experiment-popover-chips";
  popover.append(popoverTitle, popoverChips); selector.append(experimentToggle, popover); panelControls.append(selector);
  const visualControls = document.createElement("div"); visualControls.className = "visual-encoding-controls"; panelControls.append(visualControls);
  content.append(panelControls);
  const visualKey = document.createElement("div"); visualKey.className = "visual-encoding-key"; visualKey.hidden = true; content.append(visualKey);
  const status = document.createElement("p");
  status.className = "panel-status";
  status.textContent = "Waiting to load…";
  content.append(status);
  const plot = document.createElement("div");
  plot.className = "plot";
  plot.hidden = true;
  content.append(plot);

  renderPanelExperiments(panel);
  renderVisualEncodingControls(panel);
  return panel;
}

function addPanels(advanced) {
  const parameters = state.overview.parameters.filter((parameter) => Boolean(parameter.advanced) === advanced);
  const updatedGroups = new Set();
  if (state.sourceKind === "inline") {
    ensureInlineLayout();
    orderedInlineVisualizationParameters(parameters.filter((parameter) => parameter.section !== "Static Process Variables")).forEach((parameter) => {
      const subgroup = ensureInlineSubgroup(parameter);
      registerGroupParameter(subgroup, parameter, advanced);
      updatedGroups.add(subgroup);
    });
    if (advanced) updatedGroups.forEach((group) => {
      if (!group.querySelector(".collapsible-panel-content").hidden && group.dataset.loadState === "loaded") {
        initializePanelGroup(group).then(() => resizeCollapsiblePlots(group.querySelector(".collapsible-panel-content")));
      }
    });
    return;
  }
  const section = ensureOfflineLayout();
  parameters.forEach((parameter) => registerGroupParameter(section, parameter));
}

function configureAdvancedControl() {
  const hasAdvanced = state.sourceKind === "inline" && state.overview.parameters.some((parameter) => parameter.advanced);
  if (!hasAdvanced) return;
  const group = Array.from(document.querySelectorAll(".collapsible-visual-panel")).find((item) => item.groupTitle === "Dielectric Spectroscopy");
  if (!group) return;
  const content = group.querySelector(".collapsible-panel-content");
  const control = document.createElement("button");
  control.type = "button";
  control.id = "advanced";
  control.className = "advanced-control";
  control.dataset.visible = "0";
  content.prepend(control);
  const updateText = () => {
    const visible = control.dataset.visible === "1";
    control.textContent = `Advanced dielectric spectroscopy parameters — ${visible ? "Hide" : "Show"} advanced parameters`;
  };
  updateText();
  control.onclick = () => {
    const visible = control.dataset.visible !== "1";
    control.dataset.visible = visible ? "1" : "0";
    updateText();
    if (visible) addPanels(true);
    else document.querySelectorAll(".collapsible-visual-panel").forEach((group) => {
      Array.from(group.parameters.values()).filter((parameter) => parameter.advanced).forEach((parameter) => {
        group.parameters.delete(parameter.parameter_id);
        group.renderedParameterIds.delete(parameter.parameter_id);
        group.querySelector(`.panel[data-parameter-id="${parameter.parameter_id}"]`)?.remove();
      });
      updatePanelGroupSummary(group);
      syncGroupPanelPresentation(group);
      positionAdvancedControl(group);
      if (!group.parameters.size) {
        resizeObserver.unobserve(group);
        group.remove();
      }
    });
  };
}

async function buildDashboard() {
  const generation = ++state.generation;
  byId("panels").replaceChildren();
  state.overview = null;
  renderTopLevelControls();
  renderMetadataFilters();
  renderGlobalVisualEncoding();
  renderGlobalExperiments();
  if (!state.cellType || !state.sourceKind) {
    setPageStatus("Choose a cell type and source type.");
    return;
  }
  setPageStatus("Loading dashboard…");
  try {
    const overview = await loadOverview(state.cellType, state.sourceKind);
    if (generation !== state.generation) return;
    state.overview = overview;
    state.globalExperiments = new Set(overview.experiments.map((item) => item.experiment_id));
    state.metadataFilterSelections = new Map(overview.filter_dimensions.map((dimension) => [dimension.id, new Set(dimension.values.map((value) => value.id))]));
    state.globalVisualEncoding = { colorBy: "experiment", markerBy: "none" };
    buildExperimentMetadata();
    renderTopLevelControls();
    renderMetadataFilters();
    renderGlobalVisualEncoding();
    renderGlobalExperiments();
    addPanels(false);
    configureAdvancedControl();
    setPageStatus(overview.parameters.length ? "" : "No parameters available.");
  } catch (error) {
    if (generation === state.generation) setPageStatus(`Loading error: ${error.message}`);
  }
}

async function loadPanel(panel) {
  if (panel.dataset.loaded !== "0") return panel.dataset.loaded === "2";
  panel.dataset.loaded = "1";
  setPanelStatus(panel, "Loading…");
  try {
    panel.traces = await loadTraces(panel.parameter.culture_run_ids, state.sourceKind, panel.parameter);
    panel.dataset.loaded = "2";
    drawPanel(panel);
    return true;
  } catch (error) {
    panel.dataset.loaded = "3";
    clearPlot(panel.querySelector(".plot"));
    setPanelStatus(panel, `Loading error: ${error.message}`);
    return false;
  }
}

function drawPanel(panel) {
  if (panel.dataset.loaded !== "2") return;
  const plot = panel.querySelector(".plot");
  if (!panel.traces.length) {
    clearPlot(plot);
    setPanelStatus(panel, "No data available");
    return;
  }
  const visibleTraces = panel.traces.filter((trace) => {
    const experimentId = experimentIdFromTrace(trace);
    return isExperimentEffectivelyVisible(panel, experimentId);
  });
  if (!visibleTraces.length) {
    clearPlot(plot);
    setPanelStatus(panel, "All traces are hidden by the current experiment selection.");
    return;
  }
  setPanelStatus(panel);
  plot.hidden = false;
  Plotly.newPlot(
    plot,
    visibleTraces.map((trace) => {
      const experimentId = experimentIdFromTrace(trace);
      const marker = visualMarker(panel, experimentId);
      const lineOnly = state.sourceKind !== "offline_raw";
      return {
        x: trace.time_hours,
        y: trace.values,
        name: `${experimentId} · ${trace.reactor_id}`,
        mode: lineOnly ? (marker ? "lines+markers" : "lines") : "markers",
        connectgaps: false,
        line: { color: visualColor(panel, experimentId), dash: reactorDash(trace.reactor_id) },
        marker: { color: visualColor(panel, experimentId), symbol: marker || "circle", size: 6, maxdisplayed: lineOnly && marker ? 40 : undefined },
      };
    }),
    { xaxis: { title: { text: "time_hours" } }, yaxis: { title: { text: panel.parameter.display_label } } },
    { displayModeBar: true, displaylogo: false, showSendToCloud: false, responsive: true, scrollZoom: true },
  );
}

function redrawLoadedPanels() {
  document.querySelectorAll(".panel").forEach((panel) => {
    renderPanelExperiments(panel);
    renderVisualEncodingControls(panel);
    drawPanel(panel);
  });
}

const subprojects = new Set(["cho", "yeast", "yeast-beer-fermentation-maturation"]);
const legacyRoutes = {
  "data-information": "subprojects/cho/data-information",
  "data-visualization": "subprojects/cho/data-visualisation",
};

function routeFromHash() {
  const hash = window.location.hash.slice(1);
  const route = legacyRoutes[hash] || hash;
  if (route === "home" || route === "guide" || route === "subprojects") return { page: route, view: route, hash: route };
  const match = route.match(/^subprojects\/(cho|yeast|yeast-beer-fermentation-maturation)\/(data-information|data-visualisation)$/);
  if (!match || !subprojects.has(match[1])) return null;
  const [, subproject, page] = match;
  return { page, subproject, view: subproject === "yeast-beer-fermentation-maturation" ? "empty-subproject" : page, hash: route };
}

function resizeDashboardPlots() {
  window.requestAnimationFrame(() => {
    try {
      const dashboard = byId("data-visualization-view");
      if (!dashboard || dashboard.hidden) return;
      dashboard.querySelectorAll('.collapsible-visual-panel[data-expanded="true"] .panel[data-expanded="true"] .panel-collapsible-content:not([hidden]) .plot').forEach((plot) => {
        try {
          if (plot.data) Plotly.Plots.resize(plot);
        } catch (error) {
          console.error("Unable to resize a dashboard plot.", error);
        }
      });
    } catch (error) {
      console.error("Unable to resize dashboard plots.", error);
    }
  });
}

function showDataInformation(subproject) {
  const dataset = subproject === "cho" ? "cho" : "yeast";
  const container = byId("data-information-view");
  container.dataset.activeDataset = dataset;
  if (window.setDataInformationDataset) window.setDataInformationDataset(dataset);
}

function enterDashboardSubproject(subproject) {
  const cellType = subproject === "cho" ? "CHO" : "yeast";
  state.cellType = cellType;
  state.sourceKind = "inline";
  buildDashboard();
}

function renderSubprojectContext(route) {
  const context = byId("subproject-context-nav");
  context.hidden = !route.subproject;
  if (!route.subproject) return;

  document.querySelectorAll("[data-context-subproject]").forEach((link) => {
    const selected = link.dataset.contextSubproject === route.subproject;
    link.classList.toggle("active", selected);
    if (selected) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });

  const pages = byId("subproject-context-pages");
  pages.hidden = false;
  document.querySelectorAll("[data-context-page]").forEach((link) => {
    const selected = link.dataset.contextPage === route.page;
    link.href = `#subprojects/${route.subproject}/${link.dataset.contextPage}`;
    link.classList.toggle("active", selected);
    if (selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function renderRoute(route) {
  document.querySelectorAll("[data-view]").forEach((view) => {
    view.hidden = view.dataset.view !== route.view;
  });
  renderSubprojectContext(route);
  document.querySelectorAll("[data-top-route]").forEach((link) => {
    const selected = link.dataset.topRoute === (route.subproject ? "subprojects" : route.page);
    link.classList.toggle("active", selected);
    if (selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (route.page === "data-information" && route.subproject !== "yeast-beer-fermentation-maturation") showDataInformation(route.subproject);
  if (route.page === "data-visualisation" && route.subproject !== "yeast-beer-fermentation-maturation") {
    enterDashboardSubproject(route.subproject);
    resizeDashboardPlots();
  }
}

function syncRoute() {
  const route = routeFromHash();
  if (route) {
    if (window.location.hash.slice(1) !== route.hash) window.history.replaceState(null, "", `#${route.hash}`);
    renderRoute(route);
    return;
  }
  window.history.replaceState(null, "", "#home");
  renderRoute(routeFromHash());
}

function initializeApplicationShell() {
  syncRoute();
  window.addEventListener("hashchange", syncRoute);
}

function initializeDashboard() {
  try {
    renderTopLevelControls();
  } catch (error) {
    console.error("Unable to initialize dashboard controls.", error);
  }
}

initializeApplicationShell();

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeDashboard, { once: true });
else initializeDashboard();

document.addEventListener("click", (event) => {
  if (state.openPanelExperimentSelector && !event.target.closest(".panel-experiment-selector")) {
    state.openPanelExperimentSelector.querySelector(".panel-experiment-popover").hidden = true;
    state.openPanelExperimentSelector = null;
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.openPanelExperimentSelector) {
    state.openPanelExperimentSelector.querySelector(".panel-experiment-popover").hidden = true;
    state.openPanelExperimentSelector = null;
  }
});
