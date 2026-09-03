// Corpus smoke for the ims-compact tof → m/z paths against a REAL timsTOF archive. Gated on
// MZPEAK_IMS_ARCHIVE=<path to .mzpeak> and skipped otherwise (the archives are ~100 MB and live
// outside the repo). Works for BOTH archive kinds: chord-only (`ims_calibration` a/b) and the
// per-spectrum exact lane (`per_spectrum: "tof_c0,tof_c1"`), where it additionally checks every
// bound pair against the chord it replaces. Run:
//   MZPEAK_IMS_ARCHIVE=/path/to/2485.mzpeak npx vitest run src/engine/ims-corpus-smoke.test.ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { openEngineFile } from "./open";
import { imsMzExact, imsPairUnboundCount, imsTofToMz, readEngineSpectrum, readImsCalibration, resolveImsCalibration } from "./spectrum";
import { extractChromatogram } from "../reader/explorer/browse";
import { gridXicResolver } from "./chrom";

const ARCHIVE = process.env.MZPEAK_IMS_ARCHIVE;
const maybe = ARCHIVE ? describe : describe.skip;

maybe("ims-compact corpus smoke (MZPEAK_IMS_ARCHIVE)", () => {
  it("reconstructs m/z per spectrum (pair or chord) and windows the XIC on the decoded tof", async () => {
    const bytes = await readFile(ARCHIVE!);
    const file = await openEngineFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ARCHIVE!.split("/").pop());
    const reader = file.reader;
    const cal = readImsCalibration(reader);
    expect(cal).not.toBeNull();
    expect(Number.isFinite(cal!.a) && Number.isFinite(cal!.b)).toBe(true);
    const numSpectra = (reader as unknown as { numSpectra?: number }).numSpectra ?? 0;
    expect(numSpectra).toBeGreaterThan(0);

    // How many of the first 200 spectra bind their own pair, and how far each pair sits from the chord.
    const probe = Math.min(numSpectra, 200);
    let bound = 0, exact = 0, maxRel = 0;
    const chord = imsTofToMz(cal!);
    for (let i = 0; i < probe; i++) {
      const c = resolveImsCalibration(reader, i)!;
      if (!c.spectrumCoeffs) continue;
      bound++;
      if (imsMzExact(c)) exact++;
      const pair = imsTofToMz(c);
      for (const t of [100_000, 300_000, 600_000]) maxRel = Math.max(maxRel, Math.abs(pair(t) / chord(t) - 1));
    }
    // A per-spectrum pair is the SAME calibration re-expressed exactly; the chord drops only C2
    // (= 0 here) and the per-frame temperature term → sub-1e-3 relative, never a different axis.
    if (bound > 0) expect(maxRel).toBeLessThan(1e-3);
    if (!cal!.perSpectrum) expect(bound).toBe(0);
    // The converter's lane is all-or-nothing: a `per_spectrum` archive binds EVERY spectrum's pair
    // (a missing column would silently leave every spectrum on the chord — the smoke must not
    // pass on that), and every bound pair carries the `exact_per_spectrum` claim.
    if (cal!.perSpectrum) { expect(bound).toBe(probe); expect(exact).toBe(cal!.exactPerSpectrum ? probe : 0); }
    // …and an exact_per_spectrum archive never degraded a spectrum to the chord (warned once + counted).
    expect(imsPairUnboundCount(reader)).toBe(0);
    // Independent of the converter's own self-check: when the archive also carries the vendor
    // ModelType-1 rows (`vendor_mz_calibration`) and the per-frame `_tdf_t1` /
    // `_tdf_mz_calibration_id` columns, the bound pair must BE that model re-expressed —
    //   C1_eff = C1·(1 + dC1·(T1_row − T1_frame)/1e6),
    //   c1 = DigitizerTimebase·√C1_eff/1e6,  c0 = (DigitizerDelay − C0)·√C1_eff/1e6
    // (speXtract TdfMzCalibration.h, C2 = 0). Float64 round-trip → 1e-12 relative.
    const meta = (reader as unknown as { store: { fileIndex: { metadata: Record<string, unknown> } } }).store.fileIndex.metadata;
    let vmc = meta["vendor_mz_calibration"];
    if (typeof vmc === "string") vmc = JSON.parse(vmc);
    const spectra = (reader as unknown as { spectrumMetadata: { spectra: { type: { children: { name: string }[] }; getChild(n: string): { get(i: number): unknown } } } }).spectrumMetadata.spectra;
    const colBySuffix = (suf: string) => spectra.type.children.map((c) => c.name).find((n) => n.endsWith(suf));
    const t1Col = colBySuffix("_tdf_t1"), idCol = colBySuffix("_tdf_mz_calibration_id");
    const rows = (vmc as { mz_calibration?: Record<string, number>[] } | undefined)?.mz_calibration;
    let modelChecked = 0, modelMaxRel = 0;
    if (cal!.perSpectrum && rows && t1Col && idCol) {
      for (let i = 0; i < probe; i++) {
        const c = resolveImsCalibration(reader, i)!.spectrumCoeffs!;
        const t1 = Number(spectra.getChild(t1Col).get(i)), id = Number(spectra.getChild(idCol).get(i));
        const r = rows.find((x) => Number(x["Id"]) === id);
        if (!r || r["ModelType"] !== 1 || !Number.isFinite(t1)) continue;
        const c1eff = r["C1"]! * (1 + r["dC1"]! * (r["T1"]! - t1) / 1e6);
        const k1 = r["DigitizerTimebase"]! * Math.sqrt(c1eff) / 1e6;
        const k0 = (r["DigitizerDelay"]! - r["C0"]!) * Math.sqrt(c1eff) / 1e6;
        modelMaxRel = Math.max(modelMaxRel, Math.abs(k1 / c.c1 - 1), Math.abs(k0 / c.c0 - 1));
        modelChecked++;
      }
      expect(modelChecked).toBe(probe);
      expect(modelMaxRel).toBeLessThan(1e-12);
    }
    console.log(`[ims smoke] ${ARCHIVE}: ${numSpectra} spectra; per_spectrum=${JSON.stringify(cal!.perSpectrum)} (source ${cal!.perSpectrumSource}) exact_per_spectrum=${cal!.exactPerSpectrum}; ` +
      `first ${probe}: ${bound} bound their pair (${exact} claimed exact), max |pair/chord − 1| = ${maxRel.toExponential(2)}; ` +
      `vendor ModelType-1 rows: ${modelChecked} frames re-derived, max rel ${modelMaxRel.toExponential(2)}`);

    // A spectrum with a real peak list.
    let i = 0, s = await readEngineSpectrum(reader, 0);
    while (s.mz.length < 10 && i < Math.min(numSpectra, 50) - 1) s = await readEngineSpectrum(reader, ++i);
    expect(s.mz.length).toBeGreaterThanOrEqual(10);
    expect(s.mz.length).toBe(s.intensity.length);
    for (let k = 1; k < s.mz.length; k++) expect(s.mz[k]!).toBeGreaterThanOrEqual(s.mz[k - 1]!);
    expect(s.mz[0]!).toBeGreaterThan(20);
    expect(s.mz[s.mz.length - 1]!).toBeLessThan(5000); // a real m/z axis, not raw tof bins (~1e5)
    expect(s.mobility).toBeDefined();
    for (const v of s.mobility!.values) expect(v > 0.2 && v < 2.5).toBe(true);

    // XIC parity: the window sum on the decoded tof equals the spectrum's own in-window sum.
    let bp = 0;
    for (let k = 1; k < s.intensity.length; k++) if (s.intensity[k]! > s.intensity[bp]!) bp = k;
    const mzBP = s.mz[bp]!, tol = 0.02;
    let want = 0;
    for (let k = 0; k < s.mz.length; k++) if (Math.abs(s.mz[k]! - mzBP) <= tol) want += s.intensity[k]!;
    const timeMin = (reader as unknown as { spectrumMetadata: { spectra: { getChild(n: string): { get(i: number): number } } } })
      .spectrumMetadata.spectra.getChild("time").get(i);
    const tSec = timeMin * 60;
    const pts = await extractChromatogram(reader, {
      mz: mzBP, tolDa: tol, timeRange: [tSec - 0.5, tSec + 0.5], useProfile: false, gridMz: gridXicResolver(reader, false),
    });
    const hit = pts.find((p) => p.index === i);
    expect(hit).toBeDefined();
    expect(hit!.intensity).toBeCloseTo(want, 0);
    console.log(`[ims smoke] spectrum ${i}: ${s.mz.length} peaks, m/z ${s.mz[0]!.toFixed(4)}–${s.mz[s.mz.length - 1]!.toFixed(4)}, ` +
      `pair bound: ${!!resolveImsCalibration(reader, i)!.spectrumCoeffs}; XIC @ ${mzBP.toFixed(4)} ± ${tol}: ${hit!.intensity} (spectrum sum ${want})`);
  }, 300_000);
});
