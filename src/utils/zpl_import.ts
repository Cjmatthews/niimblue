import * as fabric from "fabric";
import { OBJECT_DEFAULTS, OBJECT_DEFAULTS_TEXT, OBJECT_DEFAULTS_VECTOR } from "$/defaults";
import { Barcode, type BarcodeCoding } from "$/fabric-object/barcode";
import { QRCode, type ErrorCorrectionLevel } from "$/fabric-object/qrcode";
import { TextboxExt } from "$/fabric-object/textbox-ext";

export type ZplObjectSpec =
  | {
      kind: "text";
      left: number;
      top: number;
      text: string;
      fontSize: number;
      angle: number;
      width?: number;
      originY: fabric.TOriginY;
    }
  | {
      kind: "rect";
      left: number;
      top: number;
      width: number;
      height: number;
      strokeWidth: number;
      filled: boolean;
      rx: number;
      angle: number;
    }
  | {
      kind: "circle";
      left: number;
      top: number;
      radius: number;
      strokeWidth: number;
      filled: boolean;
    }
  | {
      kind: "barcode";
      left: number;
      top: number;
      text: string;
      encoding: BarcodeCoding;
      height: number;
      printText: boolean;
      scaleFactor: number;
      angle: number;
    }
  | {
      kind: "qrcode";
      left: number;
      top: number;
      text: string;
      size: number;
      ecl: ErrorCorrectionLevel;
      angle: number;
    };

export type ZplParseResult = {
  objects: ZplObjectSpec[];
  warnings: string[];
  labelWidth?: number;
  labelHeight?: number;
};

type Orientation = "N" | "R" | "I" | "B";

type PendingKind = "text" | "barcode" | "ean13" | "qrcode" | "box" | "circle";

const DATA_COMMANDS = new Set(["FD", "FV", "SN"]);

const angleFromOrientation = (o: Orientation): number => {
  if (o === "R") return 90;
  if (o === "I") return 180;
  if (o === "B") return 270;
  return 0;
};

const parseNumber = (value: string | undefined, fallback = 0): number => {
  if (value === undefined || value === "") return fallback;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
};

const parseParams = (args: string): string[] => args.split(",").map((part) => part.trim());

const THREE_LETTER_COMMANDS = new Set(["JUS", "JMA", "JMB", "JMC", "TBN", "TFR"]);

const tokenizeZpl = (zpl: string): { cmd: string; args: string }[] => {
  const tokens: { cmd: string; args: string }[] = [];
  const source = zpl.replace(/\r\n/g, "\n");
  let i = 0;

  while (i < source.length) {
    const marker = source[i];
    if (marker !== "^" && marker !== "~") {
      i++;
      continue;
    }

    i++;
    let letters = "";
    while (i < source.length && /[A-Za-z]/.test(source[i]!) && letters.length < 3) {
      letters += source[i]!.toUpperCase();
      i++;
    }

    if (letters.length === 0) {
      continue;
    }

    let cmd = letters;
    if (letters.startsWith("A") && letters !== "A") {
      cmd = "A";
      i -= letters.length - 1;
    } else if (letters.length === 3 && !THREE_LETTER_COMMANDS.has(letters)) {
      cmd = letters.slice(0, 2);
      i -= 1;
    }

    let args = "";
    while (i < source.length && source[i] !== "^" && source[i] !== "~") {
      args += source[i];
      i++;
    }

    tokens.push({ cmd, args });
  }

  return tokens;
};

const decodeFieldData = (raw: string, hexIndicator: string | null): string => {
  let text = raw.replace(/\\&\n?/g, "\n").replace(/\\&/g, "\n");
  if (hexIndicator) {
    const escaped = hexIndicator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hexRe = new RegExp(`${escaped}([0-9A-Fa-f]{2})`, "g");
    text = text.replace(hexRe, (_all, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  }
  return text;
};

const parseQrPayload = (raw: string): { text: string; ecl: ErrorCorrectionLevel } => {
  let text = raw.trim();
  let ecl: ErrorCorrectionLevel = "M";

  if (text.length >= 1 && "HQLM".includes(text[0]!.toUpperCase())) {
    const code = text[0]!.toUpperCase();
    ecl = (code === "H" || code === "Q" || code === "L" ? code : "M") as ErrorCorrectionLevel;
    text = text.slice(1);
  }

  if (text.length >= 1 && "AM".includes(text[0]!.toUpperCase())) {
    text = text.slice(1);
  }

  if (text.startsWith(",")) {
    text = text.slice(1);
  }

  return { text, ecl };
};

const parseFont = (
  args: string,
): { orientation?: Orientation; height?: number; width?: number } => {
  const trimmed = args.trim();
  const match = trimmed.match(/^([0-9A-Z])?([NRIB])?(?:,)?(\d+)?(?:,(\d+))?/i);
  if (!match) return {};
  const orientation = match[2]?.toUpperCase() as Orientation | undefined;
  return {
    orientation: orientation === "N" || orientation === "R" || orientation === "I" || orientation === "B" ? orientation : undefined,
    height: match[3] ? Number.parseInt(match[3], 10) : undefined,
    width: match[4] ? Number.parseInt(match[4], 10) : undefined,
  };
};

export const parseZpl = (zpl: string): ZplParseResult => {
  const warnings: string[] = [];
  const objects: ZplObjectSpec[] = [];
  const tokens = tokenizeZpl(zpl);

  if (tokens.length === 0) {
    return { objects, warnings: ["No ZPL commands found. Commands start with ^, for example ^XA ... ^XZ."] };
  }

  let homeX = 0;
  let homeY = 0;
  let x = 0;
  let y = 0;
  let originY: fabric.TOriginY = "top";
  let fontHeight = 20;
  let orientation: Orientation = "N";
  let moduleWidth = 2;
  let barcodeHeight = 50;
  let hexIndicator: string | null = null;
  let fieldWidth: number | undefined;
  let labelWidth: number | undefined;
  let labelHeight: number | undefined;

  let pendingKind: PendingKind = "text";
  let pendingBarcodePrintText = true;
  let pendingBarcodeHeight = barcodeHeight;
  let pendingBarcodeOrientation: Orientation = "N";
  let pendingQrMag = 4;
  let pendingQrOrientation: Orientation = "N";
  let pendingBox: { width: number; height: number; thickness: number; rounding: number } | undefined;
  let pendingCircle: { diameter: number; thickness: number } | undefined;
  let pendingData = "";
  let skipped = new Set<string>();

  const resetField = () => {
    pendingKind = "text";
    pendingData = "";
    pendingBox = undefined;
    pendingCircle = undefined;
    fieldWidth = undefined;
    originY = "top";
  };

  const emitField = () => {
    const left = Math.round(homeX + x);
    const top = Math.round(homeY + y);
    const angle = angleFromOrientation(pendingKind === "barcode" || pendingKind === "ean13" ? pendingBarcodeOrientation : pendingKind === "qrcode" ? pendingQrOrientation : orientation);

    if (pendingKind === "box" && pendingBox) {
      const { width, height, thickness, rounding } = pendingBox;
      if (width > 0 && height > 0) {
        objects.push({
          kind: "rect",
          left,
          top,
          width,
          height,
          strokeWidth: Math.max(1, thickness),
          filled: thickness >= Math.min(width, height) / 2,
          rx: rounding,
          angle: angleFromOrientation(orientation),
        });
      }
      resetField();
      return;
    }

    if (pendingKind === "circle" && pendingCircle) {
      const radius = pendingCircle.diameter / 2;
      if (radius > 0) {
        objects.push({
          kind: "circle",
          left,
          top,
          radius,
          strokeWidth: Math.max(1, pendingCircle.thickness),
          filled: pendingCircle.thickness >= radius,
        });
      }
      resetField();
      return;
    }

    const text = decodeFieldData(pendingData, hexIndicator);
    if (!text && (pendingKind === "text" || pendingKind === "barcode" || pendingKind === "ean13" || pendingKind === "qrcode")) {
      resetField();
      return;
    }

    if (pendingKind === "qrcode") {
      const qr = parseQrPayload(text);
      const size = Math.max(40, pendingQrMag * 21);
      objects.push({
        kind: "qrcode",
        left,
        top,
        text: qr.text,
        size,
        ecl: qr.ecl,
        angle,
      });
      resetField();
      return;
    }

    if (pendingKind === "ean13" || pendingKind === "barcode") {
      const digits = text.replace(/\D/g, "");
      const encoding: BarcodeCoding = pendingKind === "ean13" && digits.length >= 12 ? "EAN13" : "CODE128B";
      const barcodeText = encoding === "EAN13" ? digits.slice(0, 13) : text;
      objects.push({
        kind: "barcode",
        left,
        top,
        text: barcodeText,
        encoding,
        height: Math.max(20, pendingBarcodeHeight + (pendingBarcodePrintText ? 16 : 0)),
        printText: pendingBarcodePrintText,
        scaleFactor: Math.max(1, Math.round(moduleWidth)),
        angle,
      });
      resetField();
      return;
    }

    objects.push({
      kind: "text",
      left,
      top,
      text,
      fontSize: Math.max(8, fontHeight),
      angle: angleFromOrientation(orientation),
      width: fieldWidth,
      originY,
    });
    resetField();
  };

  for (const { cmd, args } of tokens) {
    if (cmd === "XA") {
      resetField();
      continue;
    }
    if (cmd === "XZ") {
      continue;
    }
    if (cmd === "FX") {
      continue;
    }
    if (cmd === "CI" || cmd === "PR" || cmd === "MD" || cmd === "JUS" || cmd === "LR" || cmd === "PQ" || cmd === "MM" || cmd === "LS") {
      continue;
    }

    if (cmd === "PW") {
      labelWidth = parseNumber(parseParams(args)[0]);
      continue;
    }
    if (cmd === "LL") {
      labelHeight = parseNumber(parseParams(args)[0]);
      continue;
    }
    if (cmd === "LH") {
      const [hx, hy] = parseParams(args);
      homeX = parseNumber(hx);
      homeY = parseNumber(hy);
      continue;
    }
    if (cmd === "FO") {
      const [fx, fy] = parseParams(args);
      x = parseNumber(fx);
      y = parseNumber(fy);
      originY = "top";
      continue;
    }
    if (cmd === "FT") {
      const [fx, fy] = parseParams(args);
      x = parseNumber(fx);
      y = parseNumber(fy);
      originY = "bottom";
      continue;
    }
    if (cmd === "FW") {
      const value = args.trim().toUpperCase() as Orientation;
      if (value === "N" || value === "R" || value === "I" || value === "B") {
        orientation = value;
      }
      continue;
    }
    if (cmd === "CF") {
      const [, h] = parseParams(args);
      if (h) fontHeight = parseNumber(h, fontHeight);
      continue;
    }
    if (cmd === "A") {
      const font = parseFont(args);
      if (font.orientation) orientation = font.orientation;
      if (font.height) fontHeight = font.height;
      continue;
    }
    if (cmd === "BY") {
      const [w, , h] = parseParams(args);
      moduleWidth = parseNumber(w, moduleWidth);
      if (h) barcodeHeight = parseNumber(h, barcodeHeight);
      continue;
    }
    if (cmd === "FH") {
      hexIndicator = args.trim().charAt(0) || "_";
      continue;
    }
    if (cmd === "FB") {
      fieldWidth = parseNumber(parseParams(args)[0]);
      continue;
    }
    if (cmd === "FR") {
      continue;
    }
    if (cmd === "GB") {
      const [w, h, t, , r] = parseParams(args);
      pendingKind = "box";
      pendingBox = {
        width: parseNumber(w),
        height: parseNumber(h),
        thickness: parseNumber(t, 1),
        rounding: parseNumber(r),
      };
      continue;
    }
    if (cmd === "GC") {
      const [d, t] = parseParams(args);
      pendingKind = "circle";
      pendingCircle = {
        diameter: parseNumber(d),
        thickness: parseNumber(t, 1),
      };
      continue;
    }
    if (cmd === "GD") {
      const [w, h, t] = parseParams(args);
      pendingKind = "box";
      pendingBox = {
        width: parseNumber(w),
        height: Math.max(1, parseNumber(t, 1)),
        thickness: parseNumber(t, 1),
        rounding: 0,
      };
      warnings.push(`Diagonal line (^GD) imported as a bar (${parseNumber(w)}×${parseNumber(h)}).`);
      continue;
    }
    if (cmd === "BC" || cmd === "B3" || cmd === "BU" || cmd === "B8" || cmd === "B2") {
      const [o, h, f] = parseParams(args);
      pendingKind = "barcode";
      pendingBarcodeOrientation =
        o && "NRIB".includes(o.toUpperCase()) ? (o.toUpperCase() as Orientation) : orientation;
      pendingBarcodeHeight = parseNumber(h, barcodeHeight);
      pendingBarcodePrintText = !f || f.toUpperCase() !== "N";
      if (cmd !== "BC") {
        warnings.push(`Barcode ^${cmd} is mapped to Code 128.`);
      }
      continue;
    }
    if (cmd === "BE") {
      const [o, h, f] = parseParams(args);
      pendingKind = "ean13";
      pendingBarcodeOrientation =
        o && "NRIB".includes(o.toUpperCase()) ? (o.toUpperCase() as Orientation) : orientation;
      pendingBarcodeHeight = parseNumber(h, barcodeHeight);
      pendingBarcodePrintText = !f || f.toUpperCase() !== "N";
      continue;
    }
    if (cmd === "BQ") {
      const [o, , mag] = parseParams(args);
      pendingKind = "qrcode";
      pendingQrOrientation = o && "NRIB".includes(o.toUpperCase()) ? (o.toUpperCase() as Orientation) : orientation;
      pendingQrMag = Math.max(1, parseNumber(mag, 4));
      continue;
    }
    if (DATA_COMMANDS.has(cmd)) {
      pendingData = args;
      continue;
    }
    if (cmd === "FS") {
      emitField();
      continue;
    }
    if (cmd === "GF") {
      warnings.push("Embedded graphics (^GF) are not converted to objects. Use Import as image for those.");
      skipped.add(cmd);
      continue;
    }

    skipped.add(cmd);
  }

  if (pendingKind !== "text" || pendingData || pendingBox || pendingCircle) {
    emitField();
  }

  if (skipped.size > 0) {
    warnings.push(`Skipped unsupported commands: ${[...skipped].map((c) => `^${c}`).join(", ")}`);
  }

  if (objects.length === 0 && warnings.length === 0) {
    warnings.push("No drawable fields were found in the ZPL.");
  }

  return { objects, warnings, labelWidth, labelHeight };
};

export const addZplObjectsToCanvas = (canvas: fabric.Canvas, specs: ZplObjectSpec[]): fabric.FabricObject[] => {
  const created: fabric.FabricObject[] = [];

  for (const spec of specs) {
    if (spec.kind === "text") {
      const textProps = {
        ...OBJECT_DEFAULTS_TEXT,
        left: spec.left,
        top: spec.top,
        fontSize: spec.fontSize,
        angle: spec.angle,
        originX: "left" as fabric.TOriginX,
        originY: spec.originY,
        textAlign: "left" as const,
      };

      const obj =
        spec.width && spec.width > 0
          ? new TextboxExt(spec.text, { ...textProps, width: spec.width })
          : new fabric.IText(spec.text, textProps);
      canvas.add(obj);
      created.push(obj);
      continue;
    }

    if (spec.kind === "rect") {
      const obj = new fabric.Rect({
        ...OBJECT_DEFAULTS_VECTOR,
        left: spec.left,
        top: spec.top,
        width: spec.width,
        height: spec.height,
        rx: spec.rx,
        ry: spec.rx,
        angle: spec.angle,
        fill: spec.filled ? "black" : "transparent",
        stroke: spec.filled ? "black" : "black",
        strokeWidth: spec.filled ? 0 : spec.strokeWidth,
      });
      canvas.add(obj);
      created.push(obj);
      continue;
    }

    if (spec.kind === "circle") {
      const obj = new fabric.Circle({
        ...OBJECT_DEFAULTS_VECTOR,
        left: spec.left,
        top: spec.top,
        radius: spec.radius,
        fill: spec.filled ? "black" : "transparent",
        strokeWidth: spec.filled ? 0 : spec.strokeWidth,
      });
      canvas.add(obj);
      created.push(obj);
      continue;
    }

    if (spec.kind === "barcode") {
      const obj = new Barcode({
        ...OBJECT_DEFAULTS,
        left: spec.left,
        top: spec.top,
        height: spec.height,
        encoding: spec.encoding,
        printText: spec.printText,
        scaleFactor: spec.scaleFactor,
        angle: spec.angle,
        originX: "left",
        originY: "top",
        text: spec.text,
      });
      canvas.add(obj);
      created.push(obj);
      continue;
    }

    const obj = new QRCode({
      ...OBJECT_DEFAULTS,
      left: spec.left,
      top: spec.top,
      width: spec.size,
      height: spec.size,
      text: spec.text,
      ecl: spec.ecl,
      angle: spec.angle,
      originX: "left",
      originY: "top",
    });
    canvas.add(obj);
    created.push(obj);
  }

  canvas.requestRenderAll();
  return created;
};
