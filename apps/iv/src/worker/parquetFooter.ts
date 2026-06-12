/**
 * parquetFooter.ts — minimal Thrift compact decoder for Parquet FileMetaData.
 *
 * parquet-wasm exposes ColumnChunkMetaData.fileOffset() which returns
 * ColumnChunk.file_offset — this is 0 when metadata is stored inline in the
 * footer. The actual column data byte offset is ColumnMetaData.data_page_offset
 * (Thrift field 9), which parquet-wasm does NOT expose in its JavaScript API.
 *
 * This module reads the raw Parquet footer bytes (already fetched by
 * ParquetFile.fromFile) and decodes just enough Thrift compact binary to
 * extract data_page_offset + total_compressed_size for each target column path.
 */

/** Information extracted from the Parquet footer for one column chunk. */
export interface ColInfo {
  path: string;           // dot-joined column path, e.g. "scan.IMS_1000050_position_x"
  dataPageOffset: number; // offset of first data page within the Parquet file
  dictPageOffset: number; // offset of dictionary page (0 if absent)
  compressedSize: number; // total compressed size (dict + data pages)
  uncompressedSize: number;
  numValues: number;
  parquetType: number;  // Parquet Type enum: BOOLEAN=0, INT32=1, INT64=2, FLOAT=4, DOUBLE=5
  codec: number;        // CompressionCodec enum: UNCOMPRESSED=0, SNAPPY=1, GZIP=2, ZSTD=6
  encodings: number[];  // list of Encoding values actually present
}

// ---------------------------------------------------------------------------
// Thrift compact binary reader
// ---------------------------------------------------------------------------

class TR {
  pos = 0;
  data: Uint8Array;
  constructor(data: Uint8Array) { this.data = data; }

  /** Read one byte. */
  byte(): number { return this.data[this.pos++]; }

  /** Read unsigned varint. */
  uvarint(): number {
    let result = 0, shift = 0;
    while (true) {
      const b = this.byte();
      result |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return result >>> 0;
      shift += 7;
    }
  }

  /** Read unsigned varint as BigInt (for i64). */
  uvarint64(): bigint {
    let result = 0n, shift = 0n;
    while (true) {
      const b = BigInt(this.byte());
      result |= (b & 0x7fn) << shift;
      if (!(b & 0x80n)) return result;
      shift += 7n;
    }
  }

  /** Read zigzag i32. */
  i32(): number {
    const zz = this.uvarint();
    return ((zz >>> 1) ^ -(zz & 1)) | 0;
  }

  /** Read zigzag i64 as number (safe for values < 2^53). */
  i64(): number {
    const zz = this.uvarint64();
    return Number(zz >> 1n ^ -(zz & 1n));
  }

  /** Read binary/string as string. */
  str(): string {
    const len = this.uvarint();
    const bytes = this.data.subarray(this.pos, this.pos + len);
    this.pos += len;
    return new TextDecoder().decode(bytes);
  }

  /** Skip binary/string. */
  skipStr() { const len = this.uvarint(); this.pos += len; }

  /** Read list header → [elemType, count]. */
  listHeader(): [number, number] {
    const b = this.byte();
    const type = b & 0x0f;
    const countNibble = (b >> 4) & 0x0f;
    const count = countNibble === 0x0f ? this.uvarint() : countNibble;
    return [type, count];
  }

  /** Skip a value of given Thrift compact type. */
  skipType(type: number) {
    switch (type) {
      case 1: case 2: break;                         // bool (already in header)
      case 3: this.pos++; break;                     // byte
      case 4: this.uvarint(); break;                 // i16
      case 5: this.uvarint(); break;                 // i32
      case 6: this.uvarint64(); break;               // i64
      case 7: this.pos += 8; break;                  // double
      case 8: this.skipStr(); break;                 // string/binary
      case 9: case 10: {                              // list/set: (count<<4)|elemType
        const [t, n] = this.listHeader();
        for (let i = 0; i < n; i++) this.skipType(t);
        break;
      }
      case 11: {
        // Thrift compact MAP: count (varint) FIRST, then (keyType<<4)|valType byte.
        // If count == 0, the type byte is omitted (Apache Thrift compact spec §map).
        const count = this.uvarint();
        if (count > 0) {
          const typeByte = this.byte();
          const keyType = (typeByte >> 4) & 0x0f;
          const valType = typeByte & 0x0f;
          for (let i = 0; i < count; i++) {
            this.skipType(keyType);
            this.skipType(valType);
          }
        }
        break;
      }
      case 12: this.skipStruct(); break;             // struct
    }
  }

  /** Skip all fields of a struct until STOP (0x00). */
  skipStruct() {
    let prevId = 0;
    while (true) {
      const b = this.byte();
      if (b === 0) return; // STOP
      const type = b & 0x0f;
      const deltaNibble = (b >> 4) & 0x0f;
      if (deltaNibble !== 0) {
        prevId += deltaNibble;
      } else {
        // long-form: next 2 bytes are field id (i16 LE)
        prevId = this.byte() | (this.byte() << 8);
      }
      this.skipType(type);
    }
  }
}

// ---------------------------------------------------------------------------
// Parquet FileMetaData decoder (just enough to get ColumnMetaData)
// ---------------------------------------------------------------------------

/**
 * Parse raw Parquet footer bytes (Thrift compact FileMetaData) and return
 * per-column-path data_page_offset + sizes for every column in row group 0.
 *
 * @param footerBytes  Raw Thrift-encoded FileMetaData bytes (no length/magic)
 * @returns Map from dot-joined column path → ColInfo
 */
export function decodeFooter(footerBytes: Uint8Array): Map<string, ColInfo> {
  const result = new Map<string, ColInfo>();
  const r = new TR(footerBytes);

  // FileMetaData struct
  let prevId = 0;
  while (r.pos < footerBytes.length) {
    const b = r.byte();
    if (b === 0) break; // STOP

    const type = b & 0x0f;
    const deltaNibble = (b >> 4) & 0x0f;
    if (deltaNibble !== 0) {
      prevId += deltaNibble;
    } else {
      prevId = r.byte() | (r.byte() << 8);
    }

    if (prevId === 2 && type === 9) {
      // field 2: schema (list<SchemaElement>) — skip entirely
      const [, n] = r.listHeader();
      for (let i = 0; i < n; i++) r.skipStruct();
    } else if (prevId === 3 && type === 6) {
      // field 3: num_rows (i64) — skip
      r.i64();
    } else if (prevId === 4 && type === 9) {
      // field 4: row_groups (list<RowGroup>) — we only care about row group 0
      const [, rgCount] = r.listHeader();
      for (let rgi = 0; rgi < rgCount; rgi++) {
        const colInfos = rgi === 0 ? result : null;
        decodeRowGroup(r, colInfos);
      }
    } else {
      r.skipType(type);
    }
  }

  return result;
}

function decodeRowGroup(r: TR, colInfos: Map<string, ColInfo> | null) {
  let prevId = 0;
  while (true) {
    const b = r.byte();
    if (b === 0) return;
    const type = b & 0x0f;
    const deltaNibble = (b >> 4) & 0x0f;
    if (deltaNibble !== 0) prevId += deltaNibble;
    else prevId = r.byte() | (r.byte() << 8);

    if (prevId === 1 && type === 9) {
      // field 1: columns (list<ColumnChunk>)
      const [, n] = r.listHeader();
      for (let i = 0; i < n; i++) {
        decodeColumnChunk(r, colInfos);
      }
    } else {
      r.skipType(type);
    }
  }
}

function decodeColumnChunk(r: TR, colInfos: Map<string, ColInfo> | null) {
  let prevId = 0;
  while (true) {
    const b = r.byte();
    if (b === 0) return;
    const type = b & 0x0f;
    const deltaNibble = (b >> 4) & 0x0f;
    if (deltaNibble !== 0) prevId += deltaNibble;
    else prevId = r.byte() | (r.byte() << 8);

    if (prevId === 3 && type === 12) {
      // field 3: meta_data (ColumnMetaData struct)
      decodeColumnMetaData(r, colInfos);
    } else {
      r.skipType(type);
    }
  }
}

function decodeColumnMetaData(r: TR, colInfos: Map<string, ColInfo> | null) {
  const info: Partial<ColInfo> = {
    dataPageOffset: 0, dictPageOffset: 0,
    compressedSize: 0, uncompressedSize: 0, numValues: 0,
    parquetType: 5, codec: 0, encodings: [],
  };
  const path: string[] = [];
  let prevId = 0;

  while (true) {
    const b = r.byte();
    if (b === 0) break;
    const type = b & 0x0f;
    const deltaNibble = (b >> 4) & 0x0f;
    if (deltaNibble !== 0) prevId += deltaNibble;
    else prevId = r.byte() | (r.byte() << 8);

    switch (prevId) {
      case 1: info.parquetType = r.i32(); break;         // Type enum
      case 2: {
        // encodings (list<Encoding>) — elemType ignored; we iterate as i32 enums.
        const [, n] = r.listHeader();
        for (let i = 0; i < n; i++) {
          (info.encodings ??= []).push(r.i32());
        }
        break;
      }
      case 3: {
        // path_in_schema (list<string>)
        const [, n] = r.listHeader();
        for (let i = 0; i < n; i++) path.push(r.str());
        break;
      }
      case 4: info.codec = r.i32(); break;               // CompressionCodec enum
      case 5: info.numValues = r.i64(); break;
      case 6: info.uncompressedSize = r.i64(); break;
      case 7: info.compressedSize = r.i64(); break;
      case 8: r.skipType(type); break;                   // key_value_metadata: map<Encoding,i64> — skip correctly
      case 9: info.dataPageOffset = r.i64(); break;      // data_page_offset
      case 10: r.i64(); break;                           // index_page_offset — NOT dict, skip
      case 11: info.dictPageOffset = r.i64(); break;     // dictionary_page_offset (field 11, not 10!)
      default: r.skipType(type); break;
    }
  }

  if (colInfos && path.length > 0) {
    const dotPath = path.join('.');
    colInfos.set(dotPath, {
      path: dotPath,
      dataPageOffset: info.dataPageOffset ?? 0,
      dictPageOffset: info.dictPageOffset ?? 0,
      compressedSize: info.compressedSize ?? 0,
      uncompressedSize: info.uncompressedSize ?? 0,
      numValues: info.numValues ?? 0,
      parquetType: info.parquetType ?? 5,
      codec: info.codec ?? 0,
      encodings: info.encodings ?? [],
    });
  }
}

/**
 * Read the raw Parquet footer bytes from a blob using its size.
 * Makes 2 range requests: last 8 bytes (magic + footer length), then the footer.
 */
export async function readParquetFooter(
  blob: { size: number; slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> } },
): Promise<Uint8Array> {
  // Read last 8 bytes: [footer_len: 4 bytes LE] [PAR1: 4 bytes]
  const tailBuf = await blob.slice(blob.size - 8, blob.size).arrayBuffer();
  const tail = new DataView(tailBuf);
  const footerLen = tail.getUint32(0, true /* little-endian */);
  if (footerLen > 100_000_000) throw new Error(`Parquet footer too large: ${footerLen}`);

  // Read footer bytes
  const footerStart = blob.size - 8 - footerLen;
  const footerBuf = await blob.slice(footerStart, footerStart + footerLen).arrayBuffer();
  return new Uint8Array(footerBuf);
}
