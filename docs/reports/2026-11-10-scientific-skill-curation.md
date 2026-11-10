# 科研专属技能逐目录清理清单

依赖分类基线：`4ca339592668581c1dc36abc9097fc9bf0aa1650`。本表记录精确的源目录范围，实际执行/测试结果见[主报告](./2026-11-10-research-retirement.md)。专业分发资源退役不删除用户已安装或修改的文件，不卸载 Python 包。

## 追加的 49 个专属目录

各目录均位于 `apps/electron/default-skills/`。合计 402 个 Git 文件、5,090,292 原始源字节。计数不是压缩安装包体积或运行内存收益。逐目录核对了脚本 import、资源引用和保留技能依赖；没有发现保留路径必须加载这些目录。独立 LICENSE/NOTICE 文件未在这 49 个目录中出现，原项目与保留资源的许可证继续保留。

| 目录 | 文件数 | 原始字节 |
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

前三个能力包和首五个工作流目录已在运行批次退役：`lit-search`、`lit-review`、`research-gap`；`lit-search-report`、`literature-review-result`、`litreview`、`paper-source-selection`、`review-proposer`。技能两批合计 54 个目录，分发余下 45 个。

## 保留的 35 个通用技能

`aeon`, `consciousness-council`, `dask`, `docx`, `find-skills`, `geopandas`, `markdown-mermaid-writing`, `markitdown`, `matplotlib`, `networkx`, `pdf`, `polars`, `pptx`, `pymc`, `pymoo`, `pytorch-lightning`, `scikit-learn`, `scikit-survival`, `seaborn`, `shap`, `simpy`, `skill-creator`, `stable-baselines3`, `statistical-analysis`, `statsmodels`, `sympy`, `timesfm-forecasting`, `tool-builder`, `torch-geometric`, `transformers`, `umap-learn`, `vaex`, `what-if-oracle`, `xlsx`, `zarr-python`

涵盖 PDF/Office、可视化、数据处理、普通建模、机器学习、流程模拟、技能/工具构建等。保留功能依赖与各自许可证。

## 保留的 10 个跨用途或不确定技能

`exploratory-data-analysis`, `get-available-resources`, `hypogenic`, `hypothesis-generation`, `infographics`, `open-notebook`, `optimize-for-gpu`, `scientific-brainstorming`, `scientific-critical-thinking`, `scientific-schematics`

这些内容覆盖通用探索分析、硬件资源检查、假设/批判思考、实验笔记或示意图。`scientific-schematics` 也被保留的假设生成引用，用名字包含 scientific 作为删除条件会破坏通用能力，因此暂保留。

## 安全与依赖边界

- 移除保留文档对已删专属技能的三个可选推荐，保持通用图示、假设表达与格式指南。
- seed/copy/upgrade 跳过退役内置名称，运行投影仅排除精确受信布局与完整指纹匹配的已发布副本。
- 未知、修改、额外附件、符号链接和异常布局按用户资源保留，不自动删除。
- 目录检查和正文读取均有边界，不能递归读取用户任意附件来决定退役。
- 根 LICENSE/NOTICE 及 docx、pdf、pptx、skill-creator、xlsx 的 LICENSE.txt 均保留。
- 用户自建专业技能和旧项目指令属于用户配置边界，未知旧版本不据名称删改。
