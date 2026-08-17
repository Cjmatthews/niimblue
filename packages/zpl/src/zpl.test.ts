import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  decodeAcsOrHex,
  decodeGfaArgs,
  gbRoundingToRx,
  packRgbaToGfa,
  parseGfaArgs,
  rxToGbRounding,
  unpackGfaBytesToRgba,
} from "./graphics.js";
import { parseZpl } from "./parse.js";

describe("ZPL box rounding", () => {
  it("maps index 0 to no corner radius", () => {
    expect(gbRoundingToRx(200, 100, 0)).toBe(0);
    const result = parseZpl("^XA^FO0,0^GB200,100,2,B,0^FS^XZ");
    const rect = result.objects.find((obj) => obj.kind === "rect");
    expect(rect).toMatchObject({ kind: "rect", width: 200, height: 100, rx: 0 });
  });

  it("maps index 8 to a full pill on the shorter side", () => {
    expect(gbRoundingToRx(200, 100, 8)).toBe(50);
    expect(rxToGbRounding(200, 100, 50)).toBe(8);
    const result = parseZpl("^XA^FO0,0^GB200,100,2,B,8^FS^XZ");
    const rect = result.objects.find((obj) => obj.kind === "rect");
    expect(rect).toMatchObject({ kind: "rect", rx: 50 });
  });

  it("maps index 4 to half of the maximum radius", () => {
    expect(gbRoundingToRx(80, 80, 4)).toBe(20);
    expect(rxToGbRounding(80, 80, 20)).toBe(4);
    const result = parseZpl("^XA^FO10,10^GB80,80,2,B,4^FS^XZ");
    const rect = result.objects.find((obj) => obj.kind === "rect");
    expect(rect).toMatchObject({ kind: "rect", left: 10, top: 10, rx: 20 });
  });
});

describe("ZPL diagonals and ellipses", () => {
  it("imports ^GD left and right diagonals", () => {
    const left = parseZpl("^XA^FO0,0^GD80,40,3,B,L^FS^XZ").objects[0];
    expect(left).toMatchObject({
      kind: "line",
      width: 80,
      height: 40,
      strokeWidth: 3,
      orientation: "L",
    });

    const right = parseZpl("^XA^FO5,6^GD80,40,3,B,R^FS^XZ").objects[0];
    expect(right).toMatchObject({
      kind: "line",
      left: 5,
      top: 6,
      orientation: "R",
    });
  });

  it("imports ^GE as an ellipse", () => {
    const result = parseZpl("^XA^FO5,5^GE120,60,2,B^FS^XZ");
    expect(result.objects[0]).toMatchObject({
      kind: "ellipse",
      left: 5,
      top: 5,
      rx: 60,
      ry: 30,
      strokeWidth: 2,
      filled: false,
    });
  });
});

describe("ZPL graphics", () => {
  it("round-trips uncompressed hex GFA", async () => {
    const width = 8;
    const height = 2;
    const data = new Uint8ClampedArray(width * height * 4);
    data[3] = 255;
    const i = (1 * width + 7) * 4;
    data[i + 3] = 255;

    const command = packRgbaToGfa({ width, height, data });
    expect(command).toBe("^GFA,2,2,1,8001");

    const parsed = parseGfaArgs(command!.slice(3));
    expect(parsed).toMatchObject({ compression: "A", total: 2, bytesPerRow: 1, payload: "8001" });

    const decoded = await decodeGfaArgs(command!.slice(3));
    expect(decoded?.width).toBe(8);
    expect(decoded?.height).toBe(2);
    expect(decoded?.data[3]).toBe(255);
    expect(decoded?.data[i + 3]).toBe(255);
    expect(decoded?.data[7]).toBe(0);
  });

  it("decodes Z64 graphic payloads", async () => {
    const raw = Uint8Array.from([0x80, 0x01]);
    const b64 = deflateSync(raw).toString("base64");
    const decoded = await decodeGfaArgs(`A,2,2,1,:Z64:${b64}:0000`);
    expect(decoded?.width).toBe(8);
    expect(decoded?.height).toBe(2);
    expect(decoded?.data[3]).toBe(255);
    expect(decoded?.data[(1 * 8 + 7) * 4 + 3]).toBe(255);
  });

  it("inverts graphics when ^FR is set", async () => {
    const bytes = decodeAcsOrHex("FF", 1, 1);
    const normal = unpackGfaBytesToRgba(bytes, 1, false);
    const inverted = unpackGfaBytesToRgba(bytes, 1, true);
    expect(normal.data[3]).toBe(255);
    expect(inverted.data[3]).toBe(0);
  });

  it("parses ^GF into a graphic spec", () => {
    const result = parseZpl("^XA^FO12,8^GFA,1,1,1,FF^FS^XZ");
    expect(result.objects[0]).toMatchObject({
      kind: "graphic",
      left: 12,
      top: 8,
      args: "A,1,1,1,FF",
      invert: false,
    });
    expect(result.warnings.some((w) => w.includes("^GF"))).toBe(false);
  });
});

describe("ZPL simplified vs exact", () => {
  it("uses the rounding index as pixel rx in simplified mode", () => {
    const exact = parseZpl("^XA^FO0,0^GB200,100,2,B,8^FS^XZ");
    const simple = parseZpl("^XA^FO0,0^GB200,100,2,B,8^FS^XZ", { fidelity: "simplified" });
    expect(exact.objects[0]).toMatchObject({ kind: "rect", rx: 50 });
    expect(simple.objects[0]).toMatchObject({ kind: "rect", rx: 8 });
  });

  it("imports ^GD as a horizontal bar in simplified mode", () => {
    const simple = parseZpl("^XA^FO0,0^GD80,40,3,B,L^FS^XZ", { fidelity: "simplified" });
    expect(simple.objects[0]).toMatchObject({
      kind: "rect",
      width: 80,
      height: 3,
      strokeWidth: 3,
      rx: 0,
    });
    expect(simple.warnings.some((w) => w.includes("^GD"))).toBe(true);
  });

  it("skips ^GE and ^GF in simplified mode", () => {
    const simple = parseZpl("^XA^FO0,0^GE120,60,2,B^FS^FO12,8^GFA,1,1,1,FF^FS^XZ", { fidelity: "simplified" });
    expect(simple.objects).toHaveLength(0);
    expect(simple.warnings.some((w) => w.includes("^GE"))).toBe(true);
    expect(simple.warnings.some((w) => w.includes("^GF"))).toBe(true);
  });
});

describe("ZPL label size", () => {
  it("returns ^PW and ^LL", () => {
    const result = parseZpl("^XA^PW400^LL240^FO0,0^GB10,10,10^FS^XZ");
    expect(result.labelWidth).toBe(400);
    expect(result.labelHeight).toBe(240);
  });
});
