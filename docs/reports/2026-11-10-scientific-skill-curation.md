<a id="科研专属技能逐目录清理清单"></a>

# Directory-by-directory cleanup inventory for research-specific skills

Dependency classification baseline: `4ca339592668581c1dc36abc9097fc9bf0aa1650`. This table records the exact source-directory scope; see the [main report](./2026-11-10-research-retirement.md) for actual execution/test results. Retiring specialized distributed resources does not delete user-installed or modified files or uninstall Python packages.

<a id="追加的-49-个专属目录"></a>

## Additional 49 specialized directories

All directories are under `apps/electron/default-skills/`. Total: 402 Git files and 5,090,292 raw source bytes. These counts are not compressed installer size or runtime memory savings. Script imports, resource references, and retained-skill dependencies were checked per directory; no retained path was found to require loading these directories. No standalone LICENSE/NOTICE files appeared in these 49 directories; licenses for original projects and retained resources remain preserved.

| Directory | File count | Raw bytes |
|---|---:|---:|
| `anndata` | 6 | 62,908 |
| `arboreto` | 5 | 24,822 |
| `astropy` | 8 | 64,564 |
| `biopython` | 8 | 95,095 |
| `bioservices` | 8 | 104,385 |
| `cirq` | 7 | 75,329 |
| `clinical-decision-support` | 22 | 370,052 |
| `clinical-reports` | 32 | 386,618 |
| `cobrapy` | 3 | 50,245 |
| `datamol` | 7 | 52,296 |
| `deepchem` | 6 | 68,841 |
| `deeptools` | 8 | 84,305 |
| `esm` | 5 | 76,429 |
| `etetoolkit` | 6 | 84,491 |
| `flowio` | 2 | 27,271 |
| `fluidsim` | 7 | 36,873 |
| `geniml` | 6 | 37,095 |
| `gget` | 7 | 97,591 |
| `gtars` | 7 | 30,389 |
| `histolab` | 6 | 70,071 |
| `iso-13485-certification` | 9 | 193,430 |
| `latex-posters` | 13 | 234,378 |
| `matchms` | 5 | 63,166 |
| `medchem` | 4 | 50,725 |
| `molecular-dynamics` | 2 | 20,363 |
| `molfeat` | 4 | 54,751 |
| `neurokit2` | 13 | 179,052 |
| `neuropixels-analysis` | 18 | 142,834 |
| `pennylane` | 8 | 95,636 |
| `phylogenetics` | 3 | 28,277 |
| `polars-bio` | 7 | 61,835 |
| `pptx-posters` | 8 | 134,376 |
| `pydeseq2` | 4 | 48,259 |
| `pydicom` | 6 | 50,122 |
| `pylabrobot` | 7 | 83,122 |
| `pyopenms` | 7 | 70,307 |
| `pysam` | 5 | 55,007 |
| `pytdc` | 7 | 74,531 |
| `qiskit` | 9 | 73,120 |
| `qutip` | 6 | 51,830 |
| `rdkit` | 7 | 86,407 |
| `rowan` | 1 | 36,930 |
| `scanpy` | 6 | 50,201 |
| `scientific-writing` | 13 | 277,997 |
| `scikit-bio` | 2 | 33,333 |
| `scvelo` | 3 | 23,388 |
| `scvi-tools` | 9 | 97,382 |
| `treatment-plans` | 23 | 457,166 |
| `venue-templates` | 27 | 362,697 |

The first three capability packs and first five workflow directories were retired in the execution batch: `lit-search`, `lit-review`, `research-gap`; `lit-search-report`, `literature-review-result`, `litreview`, `paper-source-selection`, `review-proposer`. The two skill batches total 54 directories, leaving 45 in distribution.

<a id="保留的-35-个通用技能"></a>

## Retained 35 general-purpose skills

`aeon`, `consciousness-council`, `dask`, `docx`, `find-skills`, `geopandas`, `markdown-mermaid-writing`, `markitdown`, `matplotlib`, `networkx`, `pdf`, `polars`, `pptx`, `pymc`, `pymoo`, `pytorch-lightning`, `scikit-learn`, `scikit-survival`, `seaborn`, `shap`, `simpy`, `skill-creator`, `stable-baselines3`, `statistical-analysis`, `statsmodels`, `sympy`, `timesfm-forecasting`, `tool-builder`, `torch-geometric`, `transformers`, `umap-learn`, `vaex`, `what-if-oracle`, `xlsx`, `zarr-python`

Cover PDF/Office, visualization, data processing, general modeling, machine learning, process simulation, and skill/tool building. Retain functional dependencies and their respective licenses.

<a id="保留的-10-个跨用途或不确定技能"></a>

## Retained 10 cross-purpose or uncertain skills

`exploratory-data-analysis`, `get-available-resources`, `hypogenic`, `hypothesis-generation`, `infographics`, `open-notebook`, `optimize-for-gpu`, `scientific-brainstorming`, `scientific-critical-thinking`, `scientific-schematics`

These cover general exploratory analysis, hardware resource checks, hypothesis/critical thinking, experiment notes, or schematics. `scientific-schematics` is also referenced by retained hypothesis generation; deleting based on scientific in the name would break general capabilities, so it is retained for now.

<a id="安全与依赖边界"></a>

## Safety and dependency boundaries

- Remove three optional recommendations for deleted specialized skills from retained documents, preserving general illustration, hypothesis expression, and formatting guidance.
- seed/copy/upgrade skip retired built-in names; runtime projection excludes only released copies matching the exact trusted layout and full fingerprint.
- Preserve unknown, modified, extra-attachment, symlink, and unusual-layout resources as user resources; do not delete automatically.
- Bound directory inspection and body reads; do not recursively read arbitrary user attachments to decide retirement.
- Retain root LICENSE/NOTICE and LICENSE.txt for docx, pdf, pptx, skill-creator, and xlsx.
- User-created specialized skills and old project instructions belong to the user-configuration boundary; do not delete or modify unknown old versions based on names.
