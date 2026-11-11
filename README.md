# CellSENSING Data

Interactive viewer for the CellSENSING bioreactor datasets (CHO and yeast cultivations).

Site: https://lfrancke.github.io/cellsensing/, with the classic view at https://lfrancke.github.io/cellsensing/classic/.
`/v2/` redirects to the start page, because the new viewer was published there first.

The viewer at the root comes from `v2/`, a static frontend that reads the `data/` files from the build and the dataset descriptions from `static/data-information.js`.
The classic view comes from `src/cell_culture_import/api/static/`; the development server serves it at `/`, the build at `/classic/`.
Imprint and privacy notice are in `legal/`; both are drafts until the TH OWL has reviewed them.

## Run locally

Requires Python 3.14.

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Development server, reading `data_lake/` directly:

```sh
.venv/bin/culture-api
```

Then open http://127.0.0.1:8000/.

Static build, the same files GitHub Pages serves:

```sh
.venv/bin/python build_static.py
.venv/bin/python check_static.py
.venv/bin/python -m http.server 8001 --directory site
```

Then open http://127.0.0.1:8001/ and http://127.0.0.1:8001/classic/.

## Publish

Every pull request and every push to `main` runs the tests, rebuilds `site/` and checks it against the API (`.github/workflows/pages.yml`); only pushes to `main` deploy to GitHub Pages.
Guidance for AI coding assistants is in [AGENTS.md](AGENTS.md).
`site/` is build output and is not committed.

## Updating the data

`data_lake/` is generated from the lab's CSV exports, which are not in this repository:

```sh
.venv/bin/culture-import --raw-root /path/to/exports
```

`/path/to/exports` must contain `cho_20260711_60s/` and `yeast_20260804_60s/` with files named like `EXP001_CHO_CleanedData_step5-3_R01_inline.csv` (the patterns are in `discovery.py`).
The import writes into `data_lake.new/`, checks it, and replaces `data_lake/` only if every check passes; the previous version stays in git.
`CELLSENSING_RAW_ROOT=/path/to/exports .venv/bin/python -m pytest` additionally checks that a fresh import reproduces the committed `data_lake/`.
A re-import with the current pandas changes many values in the last binary digit, because pandas 2, which produced the committed files, parsed some CSV numbers one bit off; the site is unaffected.
The app reads the catalog tables in `data_lake/catalog/` and the series under `data_lake/timeseries/`, nothing else.

Values in the static build are rounded to 5 significant figures, but never to more decimals than the source data has.
Both servers show dielectric sensor dropouts (scans where the conductivity reads 0) as gaps, and the manual antifoam flag as 0/1 instead of the strings `False`/`True`; the files in `data_lake/` keep the original values.

## API

The development server has two endpoints, which `static/data.js` calls and the static build replaces with JSON files under `data/`:

- `GET /api/dashboard-overview?cell_type=CHO&source_kind=inline`
- `GET /api/series/compare?culture_run_id=...&culture_run_id=...&source_kind=inline&parameter_id=ph`

`/api/series/compare` allows at most 60 combinations (culture runs × source kinds × parameters).
Unavailable combinations are reported in `skipped_combinations` instead of failing the request.

Plotly.js is vendored in `src/cell_culture_import/api/static/vendor/`, see the README there before upgrading.

## License

Code: Apache License 2.0, see [LICENSE](LICENSE).

Data in `data_lake/`: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
When using the data, cite the datasets on Zenodo:

- Uhlendorff, S., Fulek, R., Eimler, J., Pein-Hackelbusch, M., Frahm, B. Dataset Based on Chinese Hamster Ovary (CHO) Cultivations including Turbidity, Permittivity, O2 and CO2 Measurements. Zenodo. https://doi.org/10.5281/zenodo.20829177
- Uhlendorff, S., Fulek, R., Eimler, J., Schneider, J., Frahm, B., Pein-Hackelbusch, M. Dataset Based on Inline Monitoring and Offline Analysis of Yeast Cultivations. Zenodo. https://doi.org/10.5281/zenodo.19690247
