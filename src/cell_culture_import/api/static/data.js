// Data access for the dashboard. The static build (data-source="static" on <html>)
// reads pre-generated JSON, otherwise the FastAPI backend serves the same shapes.
const staticData = document.documentElement.dataset.source === "static";
const dataRoot = `${document.documentElement.dataset.root ?? ""}data`;
// Lets the dashboard opened from disk (file://) talk to a locally running API.
const apiBaseUrl = window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "";
const timeCache = new Map();

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(payload.detail ?? payload));
  return payload;
}

async function fetchStatic(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function seriesDir(cultureRunId, sourceKind) {
  return `${dataRoot}/series/${cultureRunId.split(":").map(encodeURIComponent).join("/")}/${sourceKind}`;
}

function staticTime(cultureRunId, sourceKind) {
  const key = `${cultureRunId}|${sourceKind}`;
  if (!timeCache.has(key)) {
    const request = fetchStatic(`${seriesDir(cultureRunId, sourceKind)}/time.json`).then((payload) => payload.t);
    request.catch(() => timeCache.delete(key));
    timeCache.set(key, request);
  }
  return timeCache.get(key);
}

async function loadOverview(cellType, sourceKind) {
  if (staticData) return fetchStatic(`${dataRoot}/overview/${encodeURIComponent(cellType)}-${encodeURIComponent(sourceKind)}.json`);
  const query = new URLSearchParams({ cell_type: cellType, source_kind: sourceKind });
  return fetchJson(`${apiBaseUrl}/api/dashboard-overview?${query}`);
}

// Returns traces in the shape of /api/series/compare for one parameter across culture runs.
async function loadTraces(cultureRunIds, sourceKind, parameter) {
  if (!staticData) {
    const query = new URLSearchParams({ source_kind: sourceKind, parameter_id: parameter.parameter_id });
    cultureRunIds.forEach((cultureRunId) => query.append("culture_run_id", cultureRunId));
    return (await fetchJson(`${apiBaseUrl}/api/series/compare?${query}`)).traces;
  }
  return Promise.all(cultureRunIds.map(async (cultureRunId) => {
    const [time, series] = await Promise.all([
      staticTime(cultureRunId, sourceKind),
      fetchStatic(`${seriesDir(cultureRunId, sourceKind)}/${encodeURIComponent(parameter.parameter_id)}.json`),
    ]);
    return {
      culture_run_id: cultureRunId,
      reactor_id: cultureRunId.split(":")[2],
      source_kind: sourceKind,
      parameter_id: parameter.parameter_id,
      display_name: parameter.display_name,
      unit: parameter.unit,
      time_hours: time,
      values: series.v,
    };
  }));
}
