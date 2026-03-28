# af3-matrix

A lightweight internal tool for organizing and analyzing matrix-based protein–protein interaction screens using AlphaFold Server (AF3).

It is designed to replace repetitive manual workflows by enabling batch job generation, structured result parsing, and region-specific interface analysis across many protein pairs.

## Overview

AlphaFold Server is powerful, but screening multiple protein–protein combinations requires:

- manually configuring each job
- tracking submissions across daily quotas
- downloading and organizing results
- inspecting each model individually (often in Chimera or PyMOL)

Streamlining this process into a single workflow, this program:

1. Defines proteins and interaction matrix
2. Generates AF3-compatible JSON jobs in bulk
3. Uploads AF3 results
4. Automatically parses all predictions
5. Ranks interactions based on confidence, interface properties, and residue targeting

## Key Features

### Matrix-Based Screening
- Define bait x prey interaction matrices
- Supports small screens and expanded combinatorial sets

### AF3 Job Generation
- Bulk export of AF3-compatible JSON files
- Batch splitting to respect daily submission limits

### Multi-Model Parsing
- Processes all 5 AF3 predictions per job
- Extracts confidence metrics (e.g., ipTM, ranking_score)

### Interface Detection
- Identifies inter-chain contacts using distance cutoffs
- Computes interface size and contact density

### Region-Aware Analysis
- Annotate residue ranges of interest (e.g., catalytic or regulatory regions)
- Quantifies:
  - % of region involved in interface
  - % of interface localized to region

### Interaction Ranking
- Combines:
  - AF3 confidence metrics
  - interface geometry
  - region overlap
- Produces ranked heatmaps for rapid prioritization

### Visualization
- Matrix/heatmap view of all interactions
- Pair-level inspection with structure viewer (Mol*)

## Intended Use

This tool is designed for:

- internal screening workflows
- hypothesis generation
- prioritization of protein–protein interactions

It is **not** intended to directly predict binding affinity or replace experimental validation.

## Installation (Local Development)

```bash
git clone https://github.com/sarthaktexas/af3-matrix.git
cd af3-matrix
npm install
npm run dev
```

## Workflow
1.	Upload or define protein sequences
2.	Select bait and prey sets
3.	Annotate residue regions of interest
4.	Generate AF3 job batches
5.	Submit jobs via AlphaFold Server (manual step)
6.	Upload AF3 result ZIP files
7.	Explore ranked interaction matrix

## Notes
-	Requires manual interaction with AlphaFold Server (Google account + daily job limits)
-	Designed to operate locally without cloud infrastructure
-	Optimized for rapid iteration in research environments

## License

Licensed for the [Falzone Lab](https://falzonelab.com).

This software is intended for internal/research use.
If you would like to use or adapt this tool, please cite appropriately.

## Citation

If you use af3-matrix in your work, please cite:

Mohanty, S. af3-matrix: Matrix-Based Protein–Protein Interaction Screening and Region-Aware Interface Analysis Using AlphaFold Server; GitHub, 2026. https://github.com/sarthaktexas/af3-matrix
