# Working on this repository

Instructions for AI coding assistants (Codex, Claude and others) working on this repository.

## Who you are working with

The owner of this site is a scientist in bioprocess engineering, not a software developer.
They know the data, the experiments and the biology far better than you; you probably know more about web development, data publishing, accessibility, licensing and privacy law.
Act accordingly:

- Reply in the language the owner writes in.
- Explain in terms of what changes for visitors and for the data, not in IT jargon. Where a technical term is unavoidable, explain it once in a sentence. Assume a reader from biology or pharma, not a child.
- Do not simply do what was asked when it is unsafe, legally risky, inaccessible or bad for usability. Say so, propose the better option, explain the trade-off in two or three sentences, and let the owner decide.
- Questions about the science (what a measurement means, whether a value is plausible, how an experiment was run) belong to the owner. Ask instead of guessing.
- Before anything hard to undo (deleting files, rewriting history, changing published data, changing licences), explain what will happen and wait for an explicit yes.
- End every piece of work with a short summary: what changed, why, which alternatives you rejected and why, and what the owner should check on the live site.

## What this is

A public website for the CellSENSING bioreactor datasets: 76 CHO and yeast cultivations with inline sensor data and offline measurements.
It runs on GitHub Pages without a server: `build_static.py` turns the data into JSON files once per deployment, and the pages read those files.

There are two viewers, and both stay online while project partners give feedback:

- the viewer at the start page `/` (source in `v2/`),
- the classic view at `/classic/` (source in `src/cell_culture_import/api/static/`).

`/v2/` only redirects to the start page, because links to it were shared before the move.
Do not remove or merge either viewer unless the owner decides so.

## Where things are

| Path | What it is |
| --- | --- |
| `data_lake/` | The dataset: catalog tables in `catalog/`, one Parquet file per cultivation and source in `timeseries/`. Published under CC BY 4.0 and archived on Zenodo. |
| `src/cell_culture_import/api/app.py` | Reads `data_lake/` and produces exactly what the pages show, including derived and corrected series. |
| `src/cell_culture_import/dashboard_parameter_layout.py` | Grouping, order, help texts and which measurements are shown. |
| `src/cell_culture_import/api/static/` | Classic view. `data-information.js` holds the dataset descriptions, which v2 reuses. |
| `v2/` | The viewer on the start page. Experiment notes (contamination, deviating temperature …) and dataset summaries are in `DATASETS` at the top of `v2/app.js`. |
| `legal/` | Imprint and privacy notice (drafts, provider: TH OWL). |
| `src/cell_culture_import/importer.py`, `cli.py`, `discovery.py`, `mapping.py` | The import that turns the lab's CSV exports into `data_lake/`. |
| `build_static.py` | Builds the site into `site/` (not committed). |
| `check_static.py` | Compares the built site with the data and fails if anything is missing or differs. |
| `tests/` | Automated tests. |
| `.github/workflows/pages.yml` | Runs tests, build and check for every pull request and push; deploys only from `main`. |

## Commands

Setup, once (Python 3.14):

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Before you call any change done, all three must pass:

```sh
.venv/bin/python -m pytest -q
.venv/bin/python build_static.py
.venv/bin/python check_static.py
```

To look at the result: `.venv/bin/python -m http.server 8001 --directory site`, then open http://127.0.0.1:8001/ and http://127.0.0.1:8001/classic/.
For any visible change, open both, in light and dark mode and at phone width, and look at it.

## Rules

### The data

- Never change values in `data_lake/`. It is the published dataset; visitors and Zenodo users must be able to rely on it.
- Corrections for display live in `app.py` and are listed in the README and on the site: dielectric sensor dropouts are shown as gaps, the antifoam column is split into manual additions (small scale) and cumulative volume (pilot scale), and the NaOH amount is derived from mass and concentration. Add new corrections there, document them in the same places, and agree them with the owner first.
- Quantities the viewer computes itself (growth rate, cumulative oxygen uptake and CO2 evolution) are defined in `addDerivedParameters` in `v2/app.js` and labelled "Derived, not part of the published dataset" wherever they appear. Keep that label on anything new of this kind, and state the formula next to it.
- Values on the site are rounded to 5 significant figures. Do not change that without the owner's agreement.
- Never smooth, fill, extrapolate or drop data silently. If a chart needs it, make it visible and switchable.

### Updating or adding data

Walk the owner through these steps one at a time and explain what each result means; do not run them all silently.

1. **Corrected or additional files for the existing datasets** (CHO and yeast): the owner puts the lab's CSV exports into one folder that contains `cho_20260711_60s/` and `yeast_20260804_60s/`, named like `EXP001_CHO_CleanedData_step5-3_R01_inline.csv` (the patterns are in `discovery.py`). Run `.venv/bin/culture-import --raw-root <that folder>`. It imports into `data_lake.new/`, checks the result, and replaces `data_lake/` only if every check passes.
2. **Read the report it prints** and explain it: `unmapped_headers` are column names the site does not know yet (see 4), `failed_quality_checks` are cultivations with a missing inline, offline or interpolated file, `unusual_time_axes` are series with gaps or repeated times, and `missing_values` counts empty cells. Ask the owner whether these are expected before going on.
3. **Show what changed** with `git status` and `git diff --stat`, run the three commands above, look at the affected charts, and open a pull request. A re-import changes many files in the last binary digit (see README); say so, so the owner is not alarmed by the size of the change.
4. **A new measurement column** must be added to `KNOWN_HEADERS` in `mapping.py`; the site then shows it with the column name as label. Grouping, order and help text go into `dashboard_parameter_layout.py`. Ask the owner what the measurement is and how it should be labelled.
5. **A new experiment in an existing dataset** also needs its conditions: `DASHBOARD_FILTER_DIMENSIONS` in `app.py` lists which experiments belong to which condition (for example scale), and the build stops with a "data integrity error" until the new experiment is listed. Update the summaries and notes in `v2/app.js` and the descriptions in `data-information.js`.
6. **A new dataset or subproject** (for example the beer fermentation and maturation data) is a larger change: the file name pattern and dataset list in `discovery.py`, the cell types in `build_static.py`, the filter dimensions in `app.py`, an entry in `DATASETS` in `v2/app.js`, the description in `data-information.js`, the subproject card in the classic view (currently hidden with `hidden`), and its Zenodo DOI in both footers and the README. Plan it with the owner first and do it in a separate pull request.

The raw CSV exports never go into the repository; they are archived on Zenodo.

### Legal and privacy

- No third-party requests: no Google Fonts, CDNs, analytics, tracking pixels, embedded videos or maps. Each one sends visitors' IP addresses to another company, which needs consent under GDPR. Put libraries into the repository instead (as with Plotly in `static/vendor/`).
- Keep the attribution: the data licence (CC BY 4.0), the authors and both Zenodo DOIs stay visible on every page.
- The privacy notice states that the site sets no cookies, stores nothing in the browser and loads nothing from other providers. Any change that breaks one of these statements needs the privacy notice updated in the same change, and the owner told that the data protection officer has to review it.
- Do not write legal texts (imprint, privacy notice, accessibility statement) as if final. Draft them, mark them clearly as drafts, and tell the owner they need review by the responsible person at the institution.
- Never commit personal data, passwords, tokens, raw lab exports or unpublished manuscripts.
- Code is under the Apache License 2.0. Only add third-party code under a compatible licence, and note its source and version next to it.

### Accessibility and usability

- Follow WCAG 2.2 level AA: everything works with the keyboard, focus is visible, text has enough contrast in light and dark mode, every control has a visible label, and colour never carries meaning alone.
- Charts: at most 8 colours from the colour-blind-safe palette in `v2/app.js`, one y-axis per chart, axis titles with units.
- Check every change at phone width (about 390 px).
- Keep it calm and simple: visitors are researchers who want to find and compare data, not be impressed.

### Working process

- Work on a branch and open a pull request. GitHub runs the tests on it; merging into `main` publishes the site within a few minutes.
- Keep changes small and focused. Do not refactor or restyle code you were not asked to touch.
- Commit messages and pull request descriptions in plain English: what changed and why.
- If the automatic run on GitHub fails, read its log under "Actions", fix the cause, and explain it to the owner. Never disable a test or the check to make it pass.
