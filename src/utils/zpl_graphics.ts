export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

const ACS_COUNTS: Record<string, number> = {};
for (let i = 0; i < 19; i++) {
  ACS_COUNTS[String.fromCharCode(71 + i)] = i + 1;
}
for (let i = 0; i < 20; i++) {
  ACS_COUNTS[String.fromCharCode(103 + i)] = (i + 1) * 20;
}

export const gbRoundingToRx = (width: number, height: number, roundingIndex: number): number => {
  if (width <= 0 || height <= 0) return 0;
  const index = Math.max(0, Math.min(8, roundingIndex));
  return (Math.min(width, height) / 2) * (index / 8);
};

export const rxToGbRounding = (width: number, height: number, rx: number): number => {
  const maxRx = Math.min(width, height) / 2;
  if (maxRx <= 0 || rx <= 0) return 0;
  return Math.max(0, Math.min(8, Math.round((rx / maxRx) * 8)));
};

export type GfaParsed = {
  compression: string;
  byteCount: number;
  total: number;
  bytesPerRow: number;
  payload: string;
};

export const parseGfaArgs = (args: string): GfaParsed | undefined => {
  const match = args.trim().match(/^([ABC])\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,([\s\S]*)$/i);
  if (!match) return undefined;
  const bytesPerRow = Number.parseInt(match[4], 10);
  const total = Number.parseInt(match[3], 10) || Number.parseInt(match[2], 10);
  if (!Number.isFinite(bytesPerRow) || bytesPerRow < 1 || !Number.isFinite(total) || total < 1) {
    return undefined;
  }
  return {
    compression: match[1]!.toUpperCase(),
    byteCount: Number.parseInt(match[2], 10) || total,
    total,
    bytesPerRow,
    payload: match[5]!.trim(),
  };
};

const inflateZlib = async (data: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Z64 decompression is not supported in this environment");
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const decodeBase64 = (value: string): Uint8Array => {
  const clean = value.replace(/\s+/g, "");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
};

const decodeZ64 = async (payload: string): Promise<Uint8Array | undefined> => {
  const match = payload.replace(/\s+/g, "").match(/^:Z64:([A-Za-z0-9+/=]+):?([0-9A-Fa-f]{4})?$/i);
  if (!match) return undefined;
  return inflateZlib(decodeBase64(match[1]!));
};

const decodeB64 = (payload: string): Uint8Array | undefined => {
  const match = payload.replace(/\s+/g, "").match(/^:B64:([A-Za-z0-9+/=]+):?([0-9A-Fa-f]{4})?$/i);
  if (!match) return undefined;
  return decodeBase64(match[1]!);
};

export const decodeAcsOrHex = (payload: string, bytesPerRow: number, total: number): Uint8Array => {
  const out = new Uint8Array(total);
  let outPos = 0;
  let highNibble: number | null = null;
  let repeat = 0;
  let rowBytes = 0;
  let prevRowStart = 0;

  const writeByte = (value: number) => {
    if (outPos >= out.length) return;
    out[outPos++] = value & 0xff;
    rowBytes++;
    if (rowBytes >= bytesPerRow) {
      prevRowStart = outPos - bytesPerRow;
      rowBytes = 0;
    }
  };

  const flushNibble = () => {
    if (highNibble === null) return;
    writeByte(highNibble << 4);
    highNibble = null;
  };

  const writeNibbles = (nibble: number, times: number) => {
    for (let i = 0; i < times; i++) {
      if (highNibble === null) {
        highNibble = nibble;
      } else {
        writeByte((highNibble << 4) | nibble);
        highNibble = null;
      }
    }
  };

  const padRow = () => {
    flushNibble();
    while (rowBytes > 0 && rowBytes < bytesPerRow && outPos < out.length) {
      writeByte(0);
    }
  };

  for (const ch of payload) {
    if (/\s/.test(ch)) continue;
    const count = ACS_COUNTS[ch];
    if (count !== undefined) {
      repeat += count;
      continue;
    }
    if (/[0-9A-Fa-f]/.test(ch)) {
      writeNibbles(Number.parseInt(ch, 16), repeat > 0 ? repeat : 1);
      repeat = 0;
      continue;
    }
    if (ch === ",") {
      padRow();
      if (outPos >= bytesPerRow) {
        for (let i = 0; i < bytesPerRow && outPos < out.length; i++) {
          writeByte(out[prevRowStart + i]!);
        }
      }
      continue;
    }
    if (ch === ":" || ch === "!") {
      flushNibble();
      while (outPos < out.length) writeByte(0);
      break;
    }
  }

  flushNibble();
  return out;
};

export const unpackGfaBytesToRgba = (
  bytes: Uint8Array,
  bytesPerRow: number,
  invert: boolean,
): RgbaImage => {
  const height = bytesPerRow > 0 ? Math.max(1, Math.ceil(bytes.length / bytesPerRow)) : 1;
  const width = bytesPerRow * 8;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byte = bytes[y * bytesPerRow + Math.floor(x / 8)] ?? 0;
      const bitOn = ((byte >> (7 - (x % 8))) & 1) === 1;
      const black = invert ? !bitOn : bitOn;
      const i = (y * width + x) * 4;
      if (black) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
  }

  return { width, height, data };
};

export const decodeGfaArgs = async (args: string, invert = false): Promise<RgbaImage | undefined> => {
  const parsed = parseGfaArgs(args);
  if (!parsed || parsed.compression === "B") return undefined;

  let bytes: Uint8Array | undefined;
  const compact = parsed.payload.replace(/\s+/g, "");
  if (compact.toUpperCase().startsWith(":Z64:")) {
    bytes = await decodeZ64(parsed.payload);
  } else if (compact.toUpperCase().startsWith(":B64:")) {
    bytes = decodeB64(parsed.payload);
  } else {
    bytes = decodeAcsOrHex(parsed.payload, parsed.bytesPerRow, parsed.total);
  }

  if (!bytes || bytes.length === 0) return undefined;
  const packed = bytes.length === parsed.total ? bytes : bytes.slice(0, parsed.total);
  if (packed.length < parsed.total) {
    const padded = new Uint8Array(parsed.total);
    padded.set(packed);
    return unpackGfaBytesToRgba(padded, parsed.bytesPerRow, invert);
  }
  return unpackGfaBytesToRgba(packed, parsed.bytesPerRow, invert);
};

export const packRgbaToGfa = (image: RgbaImage): string | undefined => {
  const { width, height, data } = image;
  if (width < 1 || height < 1) return undefined;

  const bytesPerRow = Math.ceil(width / 8);
  const rows: string[] = [];

  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(bytesPerRow);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3] ?? 0;
      if (alpha < 32) continue;
      const gray = (data[i] ?? 0) * 0.299 + (data[i + 1] ?? 0) * 0.587 + (data[i + 2] ?? 0) * 0.114;
      if (gray < 160) {
        row[Math.floor(x / 8)] |= 0x80 >> x % 8;
      }
    }
    rows.push([...row].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(""));
  }

  const hex = rows.join("");
  const total = bytesPerRow * height;
  return `^GFA,${total},${total},${bytesPerRow},${hex}`;
};

export const packImageToGfa = (imageData: ImageData): string | undefined => packRgbaToGfa(imageData);
