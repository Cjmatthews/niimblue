# @niimblue/zpl

Browser-first utilities for parsing ZPL labels into renderer-neutral object specifications.

## Features

- Parse common ZPL text, box, circle, ellipse, diagonal, barcode, and QR fields.
- Choose `exact` or `simplified` import fidelity.
- Decode and encode `^GF` graphics, including hexadecimal, ACS, Z64, and B64 payloads.
- No Fabric, Svelte, or Niimblue application dependency.

## Usage

```ts
import { parseZpl } from "@niimblue/zpl";

const result = parseZpl("^XA^FO20,20^FDHello^FS^XZ", {
  fidelity: "exact",
});

console.log(result.objects);
```

The returned `ZplObjectSpec` values are renderer-neutral. Applications map them
to their own canvas or document model.
