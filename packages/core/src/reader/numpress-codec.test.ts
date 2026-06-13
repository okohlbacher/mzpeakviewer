// Encode→decode round-trip for all three Numpress codecs. The decoders are what the
// reader now uses (Linear was already wired; SLOF + PIC newly wired in data.ts). PIC
// is lossless for integers; Linear/SLOF are fixed-point lossy within a tight bound.
import { describe, it, expect } from "vitest";
import {
  encodeLinear, decodeLinear, optimalLinearFixedPoint,
  encodeSlof, decodeSlof, optimalSlofFixedPoint,
  encodePic, decodePic,
  NativeAppender,
} from "../../../../vendor/mzpeakts/lib/src/numpress";

describe("Numpress codec round-trips", () => {
  it("Linear (m/z-like ascending) decodes within fixed-point tolerance", () => {
    const data = [100.0, 100.5005, 200.1234, 300.7, 400.9001, 401.0, 850.55, 851.0];
    const fp = optimalLinearFixedPoint(Float64Array.from(data), data.length);
    const enc = new Uint8Array(data.length * 6 + 16);
    const n = encodeLinear(Float64Array.from(data), data.length, enc, fp);
    const app = new NativeAppender();
    decodeLinear(enc.subarray(0, n), n, app);
    const out = app.build();
    expect(out.length).toBe(data.length);
    for (let i = 0; i < data.length; i++) expect(Math.abs(out[i] - data[i])).toBeLessThan(1e-3);
  });

  it("SLOF (intensity-like, log) decodes within relative tolerance", () => {
    const data = [0, 1, 10, 1000, 50000, 123.4, 999999, 7];
    const fp = optimalSlofFixedPoint(Float64Array.from(data), data.length);
    const enc = new Uint8Array(8 + data.length * 2 + 8);
    const n = encodeSlof(Float64Array.from(data), data.length, enc, fp);
    const app = new NativeAppender();
    decodeSlof(enc.subarray(0, n), n, app);
    const out = app.build();
    expect(out.length).toBe(data.length);
    for (let i = 0; i < data.length; i++) {
      const tol = Math.max(1e-6, Math.abs(data[i]) * 2e-3); // ~0.2% rel for the log codec
      expect(Math.abs(out[i] - data[i])).toBeLessThan(tol);
    }
  });

  it("PIC (positive integers) decodes losslessly", () => {
    const data = [0, 1, 5, 100, 65535, 3, 1000000, 42];
    const enc = new Uint8Array(data.length * 6 + 16);
    const n = encodePic(Float64Array.from(data), data.length, enc);
    const app = new NativeAppender();
    decodePic(enc.subarray(0, n), n, app);
    const out = app.build();
    expect(out.length).toBe(data.length);
    for (let i = 0; i < data.length; i++) expect(out[i]).toBe(data[i]);
  });
});
