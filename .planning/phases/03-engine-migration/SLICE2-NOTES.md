# Phase 3 slice 2 (reader-I/O + dispatcher) — review disposition

Dual adversarial review of the impure layer. **codex: `reject`** with 2 CRITICAL + 8 MAJOR +
1 MINOR — comprehensive and correct. **vibe: no verdict** (hit the $2.00 price limit mid-run;
codex stood as the gate). All codex findings resolved; fixed in parallel (2 agents on the
engine fns + me on dispatcher/worker/open). 161 tests (core 93), typecheck clean.

## CRITICAL — fixed
1. **open/close race** — `engine.worker.ts` fired dispatch without awaiting; open set
   `ctx.active` only after async completion → a slow older open could clobber a newer one.
   Fix: a load GENERATION in the dispatch context (open bumps it + clears active immediately,
   commits only if still current) + the worker entry now SERIALIZES dispatches (the WASM
   reader is single-threaded).
2. **cancel/setCacheConfig fell through to `unsupported` error** → explicit cases: `cancel`
   acks with `cancelled`; `setCacheConfig` is a no-op ack.

## MAJOR — fixed
3. **chrom hard-coded useProfile:true** → representation-aware majority-source pick
   (profile≥centroid), from the cached scan context. Centroid-only files now read peaks.
4. **TIC didn't match Explorer** → cheap path from the promoted per-spectrum TIC column
   (MS1-only, sorted by rt), bounded whole-file fallback (≤50k spectra) only when no promoted
   TIC. Value-parity test vs the browse TIC.
5. **reconstructSpectrum lied about representation** → metadata representation is always
   preserved (fallback to the other source still reports the declared representation); both
   sources empty → named `EmptySpectrumError` (never silent zeros).
6. **selected-spectrum sanitization dropped** → lifted `sanitizePairs` (drop non-finite pairs,
   reconcile ragged lengths, sort by m/z) and applied to both profile + centroid. Value-parity
   test: engine spectrum == old reader's `getSpectrumArrays` within 1e-6.
7. **URL open downloaded the whole file** → `openEngineUrl` uses the reader's URL path (HTTP
   range reads via zip.js), not `fetch().arrayBuffer()`.
8. **errors collapsed to `internal`** → `classifyError` maps `UnsupportedEncodingError` →
   `unsupported` (+ findings carried in the error response), `CorruptFileError` → `parse`,
   network/cors/not-found/format passthrough.
9. **duplicate open paths hazard** (IV `capabilityGate` hard-required `spectrumData()`,
   rejecting chrom-only files the LC tests opened via Explorer's permissive open) → made the
   single `capabilityGate` TOLERATE missing spectrum data (chrom-only files open).
10. **ticColumn never resolved** → `engineScanBreakdown` returns `ticColumn: present|absent`;
    threaded through the dispatcher + `scanBreakdownResult` (contract) so the shell flips
    `CapabilityModel.chromatograms.ticColumn` off "unknown".

## MINOR — fixed
11. **golden tests proved shape, not parity** → added value-parity checks: reconstructed
    spectrum vs old reader, TIC vs browse TIC, MS1-only TIC length, representation-aware pick.

## Still deferred (next slices, documented)
- archive + parquet (the Structure cache-identity spike); imaging render (ion image / optical /
  multi-channel / ROI); real cooperative cancellation (cancel currently acks but the reader
  exposes no AbortSignal — honest stale-drop); `openBlob` source-faithful dedup is now moot
  (one tolerant `capabilityGate`), but the two `open.ts` modules could still be merged.
