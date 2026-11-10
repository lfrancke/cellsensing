# CellSENSING Data

Interactive viewer for the CellSENSING bioreactor datasets (CHO and yeast cultivations).

Site: https://lfrancke.github.io/cellsensing/

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

Then open http://127.0.0.1:8001/.

## Publish

Every push to `main` runs the tests, rebuilds `site/`, checks it against the API and deploys it to GitHub Pages (`.github/workflows/pages.yml`).
`site/` is build output and is not committed.

To change the data, replace the files under `data_lake/` and push.
The app reads the catalog tables in `data_lake/catalog/` and the series under `data_lake/timeseries/`, nothing else.

Values in the static build are rounded to 5 significant figures, but never to more decimals than the source data has.

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
