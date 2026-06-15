// Unit test for the bulk-stream error discrimination: an EMPTY (0-row-group) parquet is a
// legitimate "no stream" (yield nothing), but ANY other throw (network drop, corrupt
// footer) must propagate — never silently render a blank/partial ion image.
import { describe, it, expect } from "vitest";
import { streamSpectraDataArrays, streamSpectraPeaksArrays, type Reader } from "./openUrl";

async function drain(gen: AsyncGenerator<unknown>): Promise<number> {
  let n = 0;
  for await (const _ of gen) n++;
  return n;
}

function readerThatThrows(where: "spectrumData" | "spectrumPeaks", err: unknown): Reader {
  return {
    [where]: async () => {
      throw err;
    },
  } as unknown as Reader;
}

describe("bulk-stream error discrimination", () => {
  it("swallows the empty-parquet sentinel (yields nothing)", async () => {
    const r = readerThatThrows("spectrumData", new Error("Empty Parquet file"));
    expect(await drain(streamSpectraDataArrays(r))).toBe(0);
    const p = readerThatThrows("spectrumPeaks", new Error("Empty Parquet file"));
    expect(await drain(streamSpectraPeaksArrays(p))).toBe(0);
  });

  it("rethrows a real read failure instead of rendering blank", async () => {
    const r = readerThatThrows("spectrumData", new Error("network error: connection reset"));
    await expect(drain(streamSpectraDataArrays(r))).rejects.toThrow(/connection reset/);
    const p = readerThatThrows("spectrumPeaks", new Error("corrupt parquet footer"));
    await expect(drain(streamSpectraPeaksArrays(p))).rejects.toThrow(/corrupt/);
  });

  it("rethrows a non-Error throw (e.g. a WASM panic value)", async () => {
    const r = readerThatThrows("spectrumData", "wasm panic");
    await expect(drain(streamSpectraDataArrays(r))).rejects.toBe("wasm panic");
  });
});
