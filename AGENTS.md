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

- the classic view at `/` (`src/cell_culture_import/api/static/`),
- the new viewer at `/v2/` (`v2/`).

Do not remove or merge either viewer unless the owner decides so.

## Where things are

| Path | What it is |
| --- | --- |
| `data_lake/` | The dataset: catalog tables in `catalog/`, one Parquet file per cultivation and source in `timeseries/`. Published under CC BY 4.0 and archived on Zenodo. |
| `src/cell_culture_import/api/app.py` | Reads `data_lake/` and produces exactly what the pages show, including derived and corrected series. |
| `src/cell_culture_import/dashboard_parameter_layout.py` | Grouping, order, help texts and which measurements are shown. |
| `src/cell_culture_import/api/static/` | Classic view. `data-information.js` holds the dataset descriptions, which v2 reuses. |
| `v2/` | New viewer. Experiment notes (contamination, deviating temperature …) are in `DATASETS` at the top of `v2/app.js`. |
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

To look at the result: `.venv/bin/python -m http.server 8001 --directory site`, then open http://127.0.0.1:8001/ and http://127.0.0.1:8001/v2/.
For any visible change, open both, in light and dark mode and at phone width, and look at it.

## Rules

### The data

- Never change values in `data_lake/`. It is the published dataset; visitors and Zenodo users must be able to rely on it.
- Corrections for display live in `app.py` and are listed in the README and on the site: dielectric sensor dropouts are shown as gaps, the antifoam column is split into manual additions (small scale) and cumulative volume (pilot scale), and the NaOH amount is derived from mass and concentration. Add new corrections there, document them in the same places, and agree them with the owner first.
- Values on the site are rounded to 5 significant figures. Do not change that without the owner's agreement.
- Never smooth, fill, extrapolate or drop data silently. If a chart needs it, make it visible and switchable.
- Adding new experiments or a new subproject needs the import pipeline that turns the lab's CSV exports into `data_lake/`. It is not part of this repository; ask the maintainer before attempting it.

### Legal and privacy

- No third-party requests: no Google Fonts, CDNs, analytics, tracking pixels, embedded videos or maps. Each one sends visitors' IP addresses to another company, which needs consent under GDPR. Put libraries into the repository instead (as with Plotly in `static/vendor/`).
- Keep the attribution: the data licence (CC BY 4.0), the authors and both Zenodo DOIs stay visible on every page.
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
