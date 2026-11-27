# UPC Finder (web)

Photo of a 7-Eleven handheld pick screen → scannable UPC barcode, in the browser. Web edition of the UPC Finder
Android app, with the same matching rules.

## Features

- **Camera or screenshot** — snap the handheld screen or pick an image. Installed as an app (Add to Home screen),
  you can also *Share* a screenshot straight to UPC Finder.
- **On-device OCR** (Tesseract.js, runs in your browser) reads the item name, size and category, and auto-crops the
  product photo. Everything stays editable.
- **Online lookup** in Open Food Facts, Open Beauty Facts and Open Products Facts, ranked by a Match Confidence
  Score (brand, title, size with unit conversion). Weak guesses (< 50%) are listed for checking, never shown as the
  answer. One-tap Google / UPCitemdb searches as a fallback.
- **Scannable barcode** — UPC-A / EAN-13 / EAN-8 drawn with whole-pixel bars on a white pad; *Full* mode fills the
  screen with white for the store scanner, and the screen is kept awake while a barcode is shown.
- **Your own database** (IndexedDB, works offline): history, favorites, barcodes you **scan from the product** or
  **type in** (check digit verified), and **Wrong barcode** to block a bad match for an item for good (with Undo).

## Differences from the Android app

| | Android | Web |
|---|---|---|
| OCR | ML Kit (more accurate on photos) | Tesseract.js, two passes |
| Screen brightness | Set to max automatically | Browsers can't change brightness: use *Full* mode and turn brightness up |
| UPCitemdb / web search | Queried automatically | Opened as links (they block requests from websites) |

## Develop

No build step — plain ES modules.

```sh
npx serve .                      # or any static server; use http://localhost for camera + offline mode
node --test tests/core.test.mjs  # matching, parsing, GTIN and barcode tests
```

Data you save stays in your browser on your device; nothing is uploaded except the item name sent to the
product databases when you search.
