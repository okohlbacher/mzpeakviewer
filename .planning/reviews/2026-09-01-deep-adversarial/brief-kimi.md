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

YOUR ASSIGNMENT (kimi): FRESH-EYES pass over the WHOLE codebase, weighted to the
app shell + store. Read: app/src/**/*.{ts,tsx} (store.ts, urlSync.ts, views/*,
localFile.ts especially), packages/contracts/src/**/*.ts, and skim
packages/core/src/engine for cross-layer contract breaks.

NUMBERED ATTACK QUESTIONS (answer each explicitly):
1. app/src/localFile.ts + views/Idle.tsx submit wiring (NEW today): attack
   localPathOf with adversarial inputs — file://localhost/..., file:// with a
   non-empty host, URL-encoded '+', Windows UNC \\server\share, a path with '?'
   or '#', "file:" with 1 or 3+ slashes. Which inputs open the WRONG file or
   fall through to a bogus HTTP fetch?
2. app/src/store.ts select/reselect/open token machinery: any remaining path
   where a stale async continuation commits into a newer file's state, or where
   spectrumLoading can stick true/false wrongly? Check selectPixel,
   reselectWithSource, addStoredChromById, ensureWavelengthLoaded,
   loadWavelengthMatrix.
3. app/src/urlSync.ts: dia= hydration (can a deep link add DUPLICATE cards on
   re-hydration?), applyViewState explicitView routing, currentShareUrl mapping
   (diaXic only mirrors the ACTIVE card — is that honest?), scan resolution
   fallback.
4. packages/contracts/src/url/grammar.ts: break the round-trip fixpoint — find a
   canonical ViewState whose serialize→parse→resolve→serialize differs. Attack
   num() (toPrecision(8): exponent-notation outputs? negatives? zero?), diaOf,
   chromOf('ix:...'), channelOf colors with '=' or '&'.
5. Views: Chromatograms dia form validation, Spectra jump-to-first-non-empty
   (browse.tic NaN semantics), Wavelength matrix retry gate, StudyDesign cache
   key — any user-visible wrong-data path?
6. Cross-layer: does anything in app/ still assume seconds-vs-minutes wrongly,
   or read a field the wire contract no longer guarantees?
