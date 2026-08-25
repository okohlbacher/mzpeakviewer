#!/usr/bin/env python3
"""Trim a 3-spectrum fixture out of a real chunk-layout mzPeak whose peaks facet is
Numpress-encoded WITHOUT a physical mz_chunk_values column (mzpeak-convert >=0.7.10
omits it when every chunk is Numpress) — the layout that null-crashed the reader
("null is not an object (evaluating 'o.get')", ChunkLayoutReader.processSelectedRows).

Numpress chunk rows are self-contained, so rows are copied verbatim; parquet kv
metadata (spectrum_array_index — which STILL declares chunk.mz_chunk_values) and the
schema (which does NOT have it) are preserved exactly. Requires the source export:

  python3 gen_chunked_numpress.py <source.mzpeak> chunked-numpress.mzpeak
"""
import io, json, sys, zipfile
import pyarrow.parquet as pq
import pyarrow.compute as pc

SRC, OUT = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "chunked-numpress.mzpeak"
KEEP = 3  # spectra 0..2

z = zipfile.ZipFile(SRC)

def trim(member, index_col, keep):
    pf = pq.ParquetFile(io.BytesIO(z.read(member)))
    t = pf.read()
    kv = {k: v for k, v in (pf.metadata.metadata or {}).items() if k != b"ARROW:schema"}
    if t.num_rows:
        col = t.column(index_col) if index_col in t.column_names else None
        if col is None:  # struct layout: point/chunk child 0
            struct = t.column(0)
            idx = pc.struct_field(struct, [0])
            mask = pc.less(idx, keep)
            t = t.filter(mask)
        else:
            t = t.filter(pc.less(col, keep))
    t = t.replace_schema_metadata({**(t.schema.metadata or {}), **kv})
    buf = io.BytesIO()
    pq.write_table(t, buf, compression="none", write_page_index=True, write_statistics=True)
    return buf.getvalue()

members = {}
for name in z.namelist():
    if name == "mzpeak_index.json":
        members[name] = z.read(name)
    elif name.endswith(".parquet"):
        idx_col = "index" if "metadata.parquet" in name and "scans" not in name and "precursors" not in name and "selected" not in name else "source_index"
        members[name] = trim(name, idx_col, KEEP)

with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_STORED) as out:
    for name, data in members.items():
        out.writestr(name, data)
import os
print(f"wrote {OUT}: {os.path.getsize(OUT)} bytes")
