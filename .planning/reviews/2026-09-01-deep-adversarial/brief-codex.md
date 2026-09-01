You are doing an ADVERSARIAL correctness review of mzPeakViewer, a client-side
mass-spectrometry data viewer (npm monorepo: packages/contracts, packages/core,
packages/ui-kit, app; vendored reader in vendor/mzpeakts/lib). HEAD is 8f697aa,
working tree clean. REVIEW ONLY — do not modify any file.

DOMAIN INVARIANTS (violations of these are the findings we care most about):
- mzPeak = uncompressed ZIP of Parquet files + mzpeak_index.json. Two signal
  facets: spectra_data (profile; chunk OR point layout) and spectra_peaks
  (centroid; point layout). Files can be DUAL-STORED (same spectrum in both
  facets). The metadata-declared representation (MS:1000525) must NEVER be
  rewritten; sourceUsed/altAvailable are separate provenance fields.
- File `time` columns are MINUTES (UO:0000031); the wire contract (BrowseIndex.rt,
  FileStats.rtRange, all chromatogram time axes) is SECONDS. A producer that
  forgets ×60, or a path that applies it twice, is a top-severity bug.
- ONE Web Worker owns the reader; requests serialize through a mutex. Every
  async continuation that touches per-file state must be guarded by the open
  generation (app: getOpenSeq()/currentOpenSeq; worker: ctx.gen). An unguarded
  continuation pollutes the NEXT file's state after a fast file switch.
- Remote opens use HTTP range reads (zip.js). Reads through mzpeakts RemoteBlob
  are serialized PER SOURCE on purpose (parquet-wasm's async reader corrupts when
  page-read completions arrive out of issue order — real, reproduced). Do NOT
  propose removing that; DO hunt for read paths that bypass RemoteBlob/chainRead.
- URL grammar (packages/contracts/src/url/grammar.ts) must be a fixpoint:
  serialize(resolve(parseSearch(q))) === q for canonical q. Cross-mode params are
  dropped with an info notice, never an error.
- The spectrum prefetch cache stamps sourceUsed/altAvailable provenance; forced
  (non-auto) reads bypass cache writes. KNOWN+DOCUMENTED residual (do not
  re-report): on a fast local open of a dual file, spectrum 0 can be served
  before the peaks drain stamps altAvailable, hiding the Signal toggle until
  navigation.
- Known-failing tests to NOT re-report: 11 core golden tests against the legacy
  nested-format fixture imaging.mzpeak (P3 backlog item: fixture regeneration).

CONTEXT: a full adversarial review ran earlier at baseline v0.8.8; its P0/P1
findings were fixed today across v0.9.0–v0.9.2. That means TODAY'S FIX CODE has
had the least soak time — treat it as the most suspect code in the tree.

DELIVERABLE: a ranked findings list. For each finding: severity (P0 correctness /
P1 user-visible / P2 hygiene), exact file:line, a CONCRETE failing input or
sequence, and an explicit judgement: "would this bite on real data, or is it
theoretical?". Verify claims against the actual code before asserting. If an
area you examined is fine, say so in one line — do not pad. Do not report style
nits, formatting, or missing comments.

YOUR ASSIGNMENT (codex): the ENGINE + READER layer and today's fix wave.
Read: packages/core/src/engine/*.ts, packages/core/src/reader/**/*.ts,
packages/core/src/worker/dispatch.ts, packages/core/src/client/EngineClient.ts,
vendor/mzpeakts/lib/src/*.ts. Also run `git log --oneline v0.8.8..HEAD` and
`git diff v0.8.8..HEAD --stat` to see the fix wave; the diffs themselves are fair game.

NUMBERED ATTACK QUESTIONS (answer each explicitly):
1. engine/chrom.ts extractAllLevels (dual-facet merge for all-level XICs): can it
   double-count a dual-stored spectrum? What happens for rows with representation
   null/unknown, and for a file whose minority facet read returns points for
   indices the metadata says belong to the majority? Is the final time sort correct
   when times are NaN?
2. engine/chrom.ts buildTic + pickUseProfileForLevel: with MS1 rows of MIXED
   representation (some profile, some centroid), is the single-facet TIC fallback
   wrong, and does the cheap promoted-TIC path mask it?
3. RT units: summary.ts scanByColumns, reader/explorer/browse.ts
   (extractChromatogram in AND out, getStoredChromatogram): any path where the
   ×60 or ÷60 is applied twice or missed? Check wavelength paths too
   (engine/wavelength.ts timeSec).
4. EngineClient.ts error listener + ready flag: can a worker 'error' event fire
   between construction and ready in a way that mislabels, double-rejects, or
   leaks pending entries? Does rejectAllPending clear the pending map?
5. engine/spectrum.ts prefetch provenance stamping: besides the documented
   spectrum-0 residual, are there OTHER stamp races or cache-poisoning paths
   (e.g. forced reads, mobility files, early-stopped drains)?
6. mzpeakts store.ts chainRead/RemoteBlob: any deadlock or unbounded chain growth?
   Any read path that bypasses RemoteBlob (direct reader.readUint8Array callers,
   zip.js entry.getData, metadata loads) and thus still races?
7. worker/dispatch.ts: startSpectrumPrefetch gating, wavelengthMatrix transfer
   copy, archiveMemberBytes cap — is any transfer-after-cache or gen-guard hole
   left?
8. The term_marker merge (vendor/mzpeakts lib/src/record.ts + store.ts): does
   param(null) for marker columns break any downstream consumer that assumes
   param.value is non-null?
