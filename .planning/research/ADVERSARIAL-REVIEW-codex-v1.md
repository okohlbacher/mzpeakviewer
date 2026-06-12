   414	          height: "var(--control-h)",
   415	          cursor: "pointer",
   416	          appearance: "none",
   417	          backgroundImage: SELECT_CHEVRON,
   418	          backgroundRepeat: "no-repeat",
   419	          backgroundPosition: "right 0.5rem center",
   420	        }}
   421	      >
   422	        {options.map((o) => (
   423	          <option key={o.value} value={o.value} disabled={o.disabled}>
   424	            {o.label}
   425	          </option>
   426	        ))}
   427	      </select>
   428	    </label>
   429	  );
   430	}
   431	
   432	export function AppHeader({ left, right }: { left: ReactNode; right: ReactNode }) {
   433	  return (
   434	    <header
   435	      style={{
   436	        display: "flex",
   437	        alignItems: "center",
   438	        justifyContent: "space-between",
   439	        gap: "1rem",
   440	        height: 52,
   441	        padding: "0 1rem",
   442	        background: "var(--surface-page)",
   443	        borderBottom: "1px solid var(--border-default)",
   444	        flexShrink: 0,
   445	      }}
   446	    >
   447	      <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", minWidth: 0 }}>
   448	        {left}
   449	      </div>
   450	      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
   451	        {right}
   452	      </div>
   453	    </header>
   454	  );
   455	}

codex
Verdict: **reject**

1. **Phase 2 is materially under-scoped.** Explorer’s Structure path is not “plain objects over a worker boundary”; it uses live `reader.store`, parquet handles, Arrow vector type inspection, a `WeakMap` keyed by the reader, and dynamic `hyparquet` column reads. See [parquetDeep.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/reader/parquetDeep.ts:52), [archive.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/reader/archive.ts:156), [store.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/state/store.ts:922).  
   **Fix:** Add a real worker protocol for archive listing, parquet footer, deep column, histogram sampling, member reads, cancellation, paging, and transfer lists before claiming feasibility.

2. **The phase order is circular.** Phase 2 says both shells call one engine, but the protocol depends on Phase 3 decisions: unified store shape, view state, notices, lazy chunk boundaries, and deep-link replay. Explorer’s current deep-link apply logic is tab/action-order dependent in [App.tsx](/Users/kohlbach/Claude/mzPeakExplorer/src/ui/App.tsx:132); IV’s view is local app state in [App.tsx](/Users/kohlbach/Claude/mzPeakIV/src/ui/App.tsx:67).  
   **Fix:** Insert a protocol/store skeleton phase before engine migration, or split Phase 2 into engine core plus shell adapters.

3. **IV’s worker is not a sufficient engine base for Explorer.** The current request union lacks Explorer’s scan breakdown, XIC/stored chromatograms, archive/structure, study metadata, raw member download, and deep parquet sampling. See [protocol.ts](/Users/kohlbach/Claude/mzPeakIV/src/worker/protocol.ts:42) and the worker switch in [mzPeakWorker.ts](/Users/kohlbach/Claude/mzPeakIV/src/worker/mzPeakWorker.ts:1341).  
   **Fix:** Enumerate the full superset protocol and mark Phase 2 done only when both old apps are backed by it with parity tests.

4. **The “main thread pure UI” target ignores real browser policy code.** Explorer’s store reads `location` and `sessionStorage`, owns cache policy, and still calls `alert`; Structure creates object URLs, anchors, and new tabs. See [store.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/state/store.ts:66), [store.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/state/store.ts:511), [StructureTab.tsx](/Users/kohlbach/Claude/mzPeakExplorer/src/ui/StructureTab.tsx:395).  
   **Fix:** Define what remains UI policy versus worker engine; do not pretend “worker owns everything.”

5. **Old IV links are not preserved.** IV treats `?scan=N` as a 1-based displayed index, while Explorer treats `scan` as a native scan number parsed from the id. See [IV App.tsx](/Users/kohlbach/Claude/mzPeakIV/src/ui/App.tsx:82), [IV App.tsx](/Users/kohlbach/Claude/mzPeakIV/src/ui/App.tsx:145), [Explorer store.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/state/store.ts:577).  
   **Fix:** `/IV/` redirects must translate legacy `scan=N` to `spectrum=N-1` or carry a legacy flag. “Near identity” is wrong.

6. **URL ambiguity is broader than `ion` versus `xic`.** `tab/view` can conflict with generated params; Explorer currently applies both spectrum and chromatogram and then reasserts tab. `chrom` accepts numeric index or id. `optical` and `overlay` mix view selection with resource selection. See [Explorer App.tsx](/Users/kohlbach/Claude/mzPeakExplorer/src/ui/App.tsx:141), [shareView.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/ui/shareView.ts:65).  
   **Fix:** Add a conflict matrix, canonicalization rules, and regression tests for mixed-mode params.

7. **The `/IV/ -> /view/` 301 plan is deployment-fiction for one target.** Explorer deploys to both GitHub Pages project pages and mzpeak.org; GitHub Pages workflows publish static `dist` only, while mzpeak.org is a separate rsync deploy. See [ARCHITECTURE.md](/Users/kohlbach/Claude/mzPeakExplorer/ARCHITECTURE.md:78), [CLAUDE.md](/Users/kohlbach/Claude/mzPeakExplorer/CLAUDE.md:19), [deploy.yml](/Users/kohlbach/Claude/mzPeakIV/.github/workflows/deploy.yml:36).  
   **Fix:** Specify separate redirect mechanisms for mzpeak.org and GitHub Pages, including query preservation tests.

8. **Sidebar IA throws away valid capabilities.** The rule “Chromatograms only when not imaging” is unjustified. Explorer already exposes `numChromatograms` independently from `isImaging`; an imaging file can still have stored chromatograms or RT-like metadata. See [summary.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/reader/summary.ts:50) and [imaging.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/reader/imaging.ts:52).  
   **Fix:** Gate nav by actual capabilities, not a single `isImaging` boolean. Provide diagnostics and override paths for mis-detected files.

9. **Accessibility is under-specified and current patterns are weak.** Existing Structure rows use `div role="button"` with click only, no keyboard handling; SideNav is just buttons in a `nav`, not tabs. The proposed nested accordion plus tab model will make this worse unless designed explicitly. See [StructureTab.tsx](/Users/kohlbach/Claude/mzPeakExplorer/src/ui/StructureTab.tsx:443), [components.tsx](/Users/kohlbach/Claude/mzPeakExplorer/src/ui/components.tsx:220).  
   **Fix:** Add keyboard/ARIA acceptance criteria and tests for accordion expansion, roving focus, active view, and deep-link auto-expansion.

10. **Structured-clone and transfer costs are hand-waved.** IV already notes `Map` deep-cloning for grid data and transfers only some typed arrays. Structure member reads can return up to 256 MB today; workerizing that without transfer/paging will hurt. See [protocol.ts](/Users/kohlbach/Claude/mzPeakIV/src/worker/protocol.ts:134), [store.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/state/store.ts:927).  
   **Fix:** Define clone/transfer rules per message, size caps, paging for large arrays, and ownership rules for buffers the worker must keep.

11. **Savings are overstated.** The big files are behavior-heavy worker/store/panel code, not easy duplicate UI. Current source is about 14.4k LOC in IV and 9.1k in Explorer by `src` line count, and unification will add protocol/adapters/tests before it removes much.  
   **Fix:** Reframe savings as reader/deploy/design-system consolidation first; treat LOC reduction as a measured outcome after Phase 3, not a promise.

12. **Missing safety plan.** There is no explicit compatibility harness, performance budget, memory budget, canary, rollback, or old-link corpus before decommission.  
   **Fix:** Add a phase before single deploy: golden output tests for both engines, e2e for imaging and LC files, static-host redirect tests, worker cancellation tests, and a rollback path keeping old `/IV/` and `/view/` artifacts deployable.
tokens used
263.480
Verdict: **reject**

1. **Phase 2 is materially under-scoped.** Explorer’s Structure path is not “plain objects over a worker boundary”; it uses live `reader.store`, parquet handles, Arrow vector type inspection, a `WeakMap` keyed by the reader, and dynamic `hyparquet` column reads. See [parquetDeep.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/reader/parquetDeep.ts:52), [archive.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/reader/archive.ts:156), [store.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/state/store.ts:922).  
   **Fix:** Add a real worker protocol for archive listing, parquet footer, deep column, histogram sampling, member reads, cancellation, paging, and transfer lists before claiming feasibility.

2. **The phase order is circular.** Phase 2 says both shells call one engine, but the protocol depends on Phase 3 decisions: unified store shape, view state, notices, lazy chunk boundaries, and deep-link replay. Explorer’s current deep-link apply logic is tab/action-order dependent in [App.tsx](/Users/kohlbach/Claude/mzPeakExplorer/src/ui/App.tsx:132); IV’s view is local app state in [App.tsx](/Users/kohlbach/Claude/mzPeakIV/src/ui/App.tsx:67).  
   **Fix:** Insert a protocol/store skeleton phase before engine migration, or split Phase 2 into engine core plus shell adapters.

3. **IV’s worker is not a sufficient engine base for Explorer.** The current request union lacks Explorer’s scan breakdown, XIC/stored chromatograms, archive/structure, study metadata, raw member download, and deep parquet sampling. See [protocol.ts](/Users/kohlbach/Claude/mzPeakIV/src/worker/protocol.ts:42) and the worker switch in [mzPeakWorker.ts](/Users/kohlbach/Claude/mzPeakIV/src/worker/mzPeakWorker.ts:1341).  
   **Fix:** Enumerate the full superset protocol and mark Phase 2 done only when both old apps are backed by it with parity tests.

4. **The “main thread pure UI” target ignores real browser policy code.** Explorer’s store reads `location` and `sessionStorage`, owns cache policy, and still calls `alert`; Structure creates object URLs, anchors, and new tabs. See [store.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/state/store.ts:66), [store.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/state/store.ts:511), [StructureTab.tsx](/Users/kohlbach/Claude/mzPeakExplorer/src/ui/StructureTab.tsx:395).  
   **Fix:** Define what remains UI policy versus worker engine; do not pretend “worker owns everything.”

5. **Old IV links are not preserved.** IV treats `?scan=N` as a 1-based displayed index, while Explorer treats `scan` as a native scan number parsed from the id. See [IV App.tsx](/Users/kohlbach/Claude/mzPeakIV/src/ui/App.tsx:82), [IV App.tsx](/Users/kohlbach/Claude/mzPeakIV/src/ui/App.tsx:145), [Explorer store.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/state/store.ts:577).  
   **Fix:** `/IV/` redirects must translate legacy `scan=N` to `spectrum=N-1` or carry a legacy flag. “Near identity” is wrong.

6. **URL ambiguity is broader than `ion` versus `xic`.** `tab/view` can conflict with generated params; Explorer currently applies both spectrum and chromatogram and then reasserts tab. `chrom` accepts numeric index or id. `optical` and `overlay` mix view selection with resource selection. See [Explorer App.tsx](/Users/kohlbach/Claude/mzPeakExplorer/src/ui/App.tsx:141), [shareView.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/ui/shareView.ts:65).  
   **Fix:** Add a conflict matrix, canonicalization rules, and regression tests for mixed-mode params.

7. **The `/IV/ -> /view/` 301 plan is deployment-fiction for one target.** Explorer deploys to both GitHub Pages project pages and mzpeak.org; GitHub Pages workflows publish static `dist` only, while mzpeak.org is a separate rsync deploy. See [ARCHITECTURE.md](/Users/kohlbach/Claude/mzPeakExplorer/ARCHITECTURE.md:78), [CLAUDE.md](/Users/kohlbach/Claude/mzPeakExplorer/CLAUDE.md:19), [deploy.yml](/Users/kohlbach/Claude/mzPeakIV/.github/workflows/deploy.yml:36).  
   **Fix:** Specify separate redirect mechanisms for mzpeak.org and GitHub Pages, including query preservation tests.

8. **Sidebar IA throws away valid capabilities.** The rule “Chromatograms only when not imaging” is unjustified. Explorer already exposes `numChromatograms` independently from `isImaging`; an imaging file can still have stored chromatograms or RT-like metadata. See [summary.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/reader/summary.ts:50) and [imaging.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/reader/imaging.ts:52).  
   **Fix:** Gate nav by actual capabilities, not a single `isImaging` boolean. Provide diagnostics and override paths for mis-detected files.

9. **Accessibility is under-specified and current patterns are weak.** Existing Structure rows use `div role="button"` with click only, no keyboard handling; SideNav is just buttons in a `nav`, not tabs. The proposed nested accordion plus tab model will make this worse unless designed explicitly. See [StructureTab.tsx](/Users/kohlbach/Claude/mzPeakExplorer/src/ui/StructureTab.tsx:443), [components.tsx](/Users/kohlbach/Claude/mzPeakExplorer/src/ui/components.tsx:220).  
   **Fix:** Add keyboard/ARIA acceptance criteria and tests for accordion expansion, roving focus, active view, and deep-link auto-expansion.

10. **Structured-clone and transfer costs are hand-waved.** IV already notes `Map` deep-cloning for grid data and transfers only some typed arrays. Structure member reads can return up to 256 MB today; workerizing that without transfer/paging will hurt. See [protocol.ts](/Users/kohlbach/Claude/mzPeakIV/src/worker/protocol.ts:134), [store.ts](/Users/kohlbach/Claude/mzPeakExplorer/src/state/store.ts:927).  
   **Fix:** Define clone/transfer rules per message, size caps, paging for large arrays, and ownership rules for buffers the worker must keep.

11. **Savings are overstated.** The big files are behavior-heavy worker/store/panel code, not easy duplicate UI. Current source is about 14.4k LOC in IV and 9.1k in Explorer by `src` line count, and unification will add protocol/adapters/tests before it removes much.  
   **Fix:** Reframe savings as reader/deploy/design-system consolidation first; treat LOC reduction as a measured outcome after Phase 3, not a promise.

12. **Missing safety plan.** There is no explicit compatibility harness, performance budget, memory budget, canary, rollback, or old-link corpus before decommission.  
   **Fix:** Add a phase before single deploy: golden output tests for both engines, e2e for imaging and LC files, static-host redirect tests, worker cancellation tests, and a rollback path keeping old `/IV/` and `/view/` artifacts deployable.
