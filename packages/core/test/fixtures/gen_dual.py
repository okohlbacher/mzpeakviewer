#!/usr/bin/env python3
"""Generate a minimal DUAL-STORED mzPeak fixture: 3 spectra, each present BOTH as
profile (spectra_data, point layout) and centroided (spectra_peaks).

Schema/kv-metadata shapes copied from real mzpeak-convert 0.7.7 output (flat layout,
point structs, `spectrum_array_index` kv JSON, `?` counts). Uncompressed ZIP (STORED),
no zip64 needed at this size.
"""
import io, json, sys, zipfile
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

OUT = sys.argv[1] if len(sys.argv) > 1 else "dual.mzpeak"

N_SPEC = 3
PROFILE_PTS = 40
PEAKS = 5

ARRAY_INDEX = {
    "prefix": "point",
    "entries": [
        {"context": "spectrum", "path": "point.mz", "data_type": "MS:1000523",
         "array_type": "MS:1000514", "array_name": "m/z array", "unit": "MS:1000040",
         "buffer_format": "point", "transform": None, "data_processing_id": None,
         "buffer_priority": "primary", "sorting_rank": 0},
        {"context": "spectrum", "path": "point.intensity", "data_type": "MS:1000521",
         "array_type": "MS:1000515", "array_name": "intensity array", "unit": "MS:1000131",
         "buffer_format": "point", "transform": None, "data_processing_id": None,
         "buffer_priority": "primary", "sorting_rank": None},
    ],
}

def point_table(rows):
    idx, mz, inten = zip(*rows)
    struct = pa.StructArray.from_arrays(
        [pa.array(idx, pa.uint64()), pa.array(mz, pa.float64()), pa.array(inten, pa.float32())],
        names=["spectrum_index", "mz", "intensity"],
    )
    return pa.table({"point": struct})

def write_parquet(table, kv):
    buf = io.BytesIO()
    md = {k: v for k, v in kv.items()}
    table = table.replace_schema_metadata({**(table.schema.metadata or {}), **{k.encode(): v.encode() for k, v in md.items()}})
    pq.write_table(table, buf, compression="none", write_page_index=True, write_statistics=True)
    return buf.getvalue()

# ── profile rows: a smooth gaussian-ish trace, 40 pts, m/z 100..500 ──
profile_rows, peak_rows = [], []
rng = np.random.default_rng(7)
for i in range(N_SPEC):
    centers = np.linspace(150 + 40 * i, 450 + 40 * i, PEAKS)
    mzs = np.linspace(100, 500, PROFILE_PTS) + 40 * i
    trace = np.zeros_like(mzs)
    for c, h in zip(centers, [100, 400, 250, 800, 150]):
        trace += h * np.exp(-0.5 * ((mzs - c) / 2.5) ** 2)
    trace += 5.0  # baseline so profile != centroid visually
    for m, y in zip(mzs, trace):
        profile_rows.append((i, float(m), float(y)))
    for c, h in zip(centers, [100, 400, 250, 800, 150]):
        peak_rows.append((i, float(c), float(h)))

data_pq = write_parquet(point_table(profile_rows), {
    "spectrum_count": str(N_SPEC),
    "spectrum_data_point_count": json.dumps([PROFILE_PTS] * N_SPEC),
    "spectrum_array_index": json.dumps(ARRAY_INDEX),
})
peaks_pq = write_parquet(point_table(peak_rows), {
    "spectrum_count": str(N_SPEC),
    "spectrum_data_point_count": json.dumps([PEAKS] * N_SPEC),
    "spectrum_array_index": json.dumps(ARRAY_INDEX),
})

# ── flat spectra_metadata: BOTH counts populated → dual-stored; declared profile ──
meta = pa.table({
    "index": pa.array(range(N_SPEC), pa.uint64()),
    "id": pa.array([f"scan={i+1}" for i in range(N_SPEC)], pa.large_string()),
    "ms_level": pa.array([1] * N_SPEC, pa.uint8()),
    "time": pa.array([0.1 * (i + 1) for i in range(N_SPEC)], pa.float64()),
    "scan_polarity": pa.array([1] * N_SPEC, pa.int8()),
    # spectrum 0+1 declared PROFILE, spectrum 2 declared CENTROID — the golden asserts
    # Auto routing differs by declaration (codex: identical declarations let a swapped
    # facet router pass the test).
    "spectrum_representation": pa.array(["MS:1000128", "MS:1000128", "MS:1000127"], pa.string()),
    "spectrum_type": pa.array(["MS:1000579"] * N_SPEC, pa.string()),
    "lowest_observed_mz": pa.array([100.0 + 40 * i for i in range(N_SPEC)], pa.float64()),
    "highest_observed_mz": pa.array([500.0 + 40 * i for i in range(N_SPEC)], pa.float64()),
    "number_of_data_points": pa.array([PROFILE_PTS] * N_SPEC, pa.uint64()),
    "number_of_peaks": pa.array([PEAKS] * N_SPEC, pa.uint64()),
    "base_peak_mz": pa.array([250.0] * N_SPEC, pa.float64()),
    "base_peak_intensity": pa.array([800.0] * N_SPEC, pa.float32()),
    "total_ion_current": pa.array([1700.0] * N_SPEC, pa.float32()),
    "data_processing_id": pa.array(["dp1"] * N_SPEC, pa.large_string()),
})
meta_pq = write_parquet(meta, {"spectrum_count": str(N_SPEC)})

# scans facet: sorted source_index — SpectrumMetadata.get() feeds this column into
# binarySearchAll unconditionally (codex blocker: omit it and the first read throws).
scans = pa.table({
    "source_index": pa.array(range(N_SPEC), pa.uint64()),
    "scan_index": pa.array(range(N_SPEC), pa.uint64()),
    "scan_start_time": pa.array([0.1 * (i + 1) for i in range(N_SPEC)], pa.float32()),
})
scans_pq = write_parquet(scans, {"spectrum_count": str(N_SPEC)})

COLUMN_MAPPING = [
    {"name": "ms level", "path": "ms_level", "accession": "MS:1000511", "unit": None},
    {"name": "scan start time", "path": "time", "accession": "MS:1000016", "unit": "UO:0000031"},
    {"name": "scan polarity", "path": "scan_polarity", "accession": "MS:1000465", "unit": None},
    {"name": "spectrum representation", "path": "spectrum_representation", "accession": "MS:1000525", "unit": None},
    {"name": "spectrum type", "path": "spectrum_type", "accession": "MS:1000559", "unit": None},
    {"name": "lowest observed m/z", "path": "lowest_observed_mz", "accession": "MS:1000528", "unit": "MS:1000040"},
    {"name": "highest observed m/z", "path": "highest_observed_mz", "accession": "MS:1000527", "unit": "MS:1000040"},
    {"name": "number of data points", "path": "number_of_data_points", "accession": "MS:1003060", "unit": None},
    {"name": "number of peaks", "path": "number_of_peaks", "accession": "MS:1003059", "unit": None},
    {"name": "base peak m/z", "path": "base_peak_mz", "accession": "MS:1000504", "unit": "MS:1000040"},
    {"name": "base peak intensity", "path": "base_peak_intensity", "accession": "MS:1000505", "unit": "MS:1000131"},
    {"name": "total ion current", "path": "total_ion_current", "accession": "MS:1000285", "unit": "MS:1000131"},
]

index = {
    "files": [
        {"name": "spectra_data.parquet", "data_kind": "data_arrays", "entity_type": "spectrum", "column_mapping": [], "parameters": []},
        {"name": "spectra_peaks.parquet", "data_kind": "peaks", "entity_type": "spectrum", "column_mapping": [], "parameters": []},
        {"name": "spectra_metadata.parquet", "data_kind": "metadata", "entity_type": "spectrum", "column_mapping": COLUMN_MAPPING, "parameters": []},
        {"name": "spectra_metadata_scans.parquet", "data_kind": "scans", "entity_type": "spectrum", "column_mapping": [
            {"name": "scan start time", "path": "scan_start_time", "accession": "MS:1000016", "unit": "UO:0000031"},
        ], "parameters": []},
    ],
    "metadata": {
        "version": "0.9.0",
        "run": {"id": "dual_fixture_run"},
        "file_description": {"contents": []},
    },
}

with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_STORED) as z:
    z.writestr("spectra_data.parquet", data_pq)
    z.writestr("spectra_peaks.parquet", peaks_pq)
    z.writestr("spectra_metadata.parquet", meta_pq)
    z.writestr("spectra_metadata_scans.parquet", scans_pq)
    z.writestr("mzpeak_index.json", json.dumps(index, indent=1))

import os
print(f"wrote {OUT}: {os.path.getsize(OUT)} bytes")
