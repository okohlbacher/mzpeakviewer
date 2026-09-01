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

YOUR ASSIGNMENT (vibe): SECOND OPINION on the highest-risk seams. Read:
packages/contracts/src/url/grammar.ts, packages/contracts/src/protocol.ts,
app/src/urlSync.ts, app/src/store.ts, packages/core/src/engine/chrom.ts,
packages/core/src/engine/spectrum.ts, app/src/localFile.ts.

NUMBERED ATTACK QUESTIONS (answer each explicitly):
1. Protocol/wire vs implementation drift: does every request type in protocol.ts
   have a dispatch case, and does every response shape match what EngineClient
   returns? (deepColumn was removed today — look for dangling references.)
2. grammar.ts round-trip: same fixpoint attack as above, PLUS: does serialize
   emit params resolve() cannot read back under BOTH modes (imaging vs lc)?
   chromatograms-on-imaging was just allowed — chase every consequence.
3. chrom.ts engineExtractChrom: the rt window semantics across tic/xic/dia/stored
   — is rt applied consistently pre/post extraction? Can a stored chromatogram id
   containing ',' or ':' break canonicalChrom round-trip?
4. spectrum.ts reconstructSpectrum forced-source fallback: when forceSource is
   set but that facet is EMPTY for this spectrum, the code falls through — is
   sourceUsed then truthful everywhere it is consumed (store badge, cache)?
5. localFile.ts: same adversarial-input attack as kimi (report only what you
   independently find).
Disagree with the other reviewers freely; we want disagreements, not consensus.
