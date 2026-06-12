# Phase 3 slice 1 (pure engine layer) — review disposition

Built the pure layer (EngineClient + 6 adapters) in parallel (4 agents), then ran a dual
adversarial review (codex + vibe, both `reject`). The two reviewers **converged hard** —
high-signal. All findings resolved + tested. core 65 + contracts 49 + ui-kit 19 green.

## Convergent (both codex + vibe) — fixed
- **selectSpectrum hangs forever** (codex C1 / vibe C5): a superseded/stale select deleted
  its resolver without settling → the awaiting caller hung + the resolver leaked. Fix:
  a new select SUPERSEDES the prior (rejects with `SupersededError`); the stale-drop branch
  rejects too. Added select-failure correlation: `error` now carries optional `selectId`
  (contract) and the client routes select errors by it.
- **ionImage dropped presenceMask** (codex M1 / vibe C2): a present pixel with intensity 0
  was wrongly treated as absent. Fix: `computeIonImageStats(img, presenceMask?)` mirrors IV
  (skip `presenceMask[k]===0`; present 0 counts toward min). Tested.
- **grid dropped coordinateBase** (codex M2 / vibe C3): originX/Y defaulted to 0 → off-by-one
  pixel coords. Fix: `GridInput.coordinateBase` (required); origin carries it. base-0/base-1 tests.
- **browse null-vs-zero** (codex M3 / vibe C1+M9): absent msLevel/tic encoded as 0, colliding
  with real 0. Fix: msLevel absent → `MSLEVEL_ABSENT` (-1), tic absent → NaN. Tested real-0 preserved.
- **spectrum transfer-after-alias** (codex M5 / vibe C4): toF64/toF32 returned the input by
  reference → transferring it could detach a reader/cache buffer. Fix: always copy. Tested.

## codex-only — fixed
- **close didn't invalidate in-flight** (C2): `closeActive()` now bumps the generation;
  `EngineClient.close()` rejects all pending with `EngineClosedError`. Tested.
- **pre-ready buffering replayed stale opens** (M6): a new `open` supersedes a pending one
  (rejects + drops it from the outbox) — single-open engine can't run two. Tested.
- **layout "unknown"** (MINOR2): added to the contract + core capability layout union.
- **unattributed errors dropped**: now surface on the client's `error` event channel. Tested.

## Dismissed
- codex/vibe "response before handler registered" race (vibe #6): the handler is registered
  (`pendingByRequestId.set`) BEFORE `send()`, and a response can't precede the send — safe.

## Deferred to slice 2 (documented, not bugs in this slice)
- **spectrum reconstruction/source-routing** (codex M4): `adaptSpectrum` takes ALREADY-
  reconstructed mz/intensity + a representation indicator. The real profile-vs-centroid
  source selection + array sanitization (Explorer browse.ts / IV arrays.ts) belongs in a
  pure, parity-tested reconstruction helper the HANDLER calls — built in slice 2 against the
  golden fixtures (where the real reader output is available).
- **chrom defensive truncation** (codex MINOR1 / vibe M8): kept (fail-graceful posture); the
  handler should pass aligned axes. Documented.

vibe ran with `--max-turns 50` this round and produced a full verdict (vs the turn-limited
Phase-2 run).
