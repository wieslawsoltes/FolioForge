# Verification record and release checklist

## Executed in this delivery

- `node --test tests/core.test.js`: **49 passed, zero failed**.
- `python3 tests/browser_smoke.py`: **47 passed, zero uncaught browser exceptions**.
- JavaScript syntax checks for every ES module.
- Canvas screenshots inspected at 1600 × 1000, 1280 × 800, and 700 × 700.
- Original sample contains six editable pages and has no reported layout-preflight issues.

The test harness runs the actual generated standalone application without network dependencies. It does not replace canvas drawing with mocked rendering. API-level tests supplement pointer/keyboard interaction tests for composition and export.

## Not validated in the available browser environment

WebGPU execution, GPU shader compilation by a real exposed browser GPUDevice, actual device-loss transition, origin-backed IndexedDB reload persistence, browser print/Save as PDF completion, and completion of browser-managed file downloads. These are implemented paths, not validated release claims.

The environment blocks URL navigation and exposes neither WebGPU nor IndexedDB to the in-memory `about:blank` harness. The application correctly chooses its Canvas fallback. No enterprise browser policies were changed for these tests.

## Secure-origin integration run

Serve this folder on localhost or HTTPS. Confirm each item on the real target browsers and hardware before release:

1. Open the editor, confirm the status bar reads **WebGPU**, and check the console for WGSL compilation, validation, and uncaptured errors. Inspect `Window → Renderer diagnostics` for plausible draw counts.
2. Compare the original sample with `?renderer=canvas`, especially transparent text edges, image cover/contain, ellipse stroke coverage, and page boundaries at fractional zoom and 1×/2× DPR.
3. Exercise pan, pointer-centered zoom, resize, rotate, page-to-page drag, mixed-layer stacking, and 500+ independently editable objects. Measure CPU, GPU, and memory separately. The application has no sustained-FPS claim.
4. Inspect `folioforge.renderer.device.limits`, place a large image, and confirm texture downsampling avoids device-limit violations.
5. In a development test only, call `folioforge.renderer.device.destroy()`. Confirm the backend changes to Canvas 2D, existing document state remains editable, and the overlay remains responsive.
6. Edit a story, wait for the saved indicator, reload, and verify restoration. Repeat with image import. Repeat after denying storage or exceeding quota and verify the warning and portable-save escape route.
7. Save a `.folio` file, open it in a fresh browser profile, and verify all assets are present with no external network calls. Repeat with the standalone HTML edition.
8. Download PNG and SVG and inspect their pixels/object geometry in independent viewers. SVG is editable text and therefore requires the expected fonts on the viewing machine.
9. Print all six pages to a PDF and verify page dimensions, ordering, backgrounds, and trim. Output is raster, RGB/browser-managed, and not a print-production PDF/X contract.
10. Test native text input/IME, keyboard shortcuts on macOS and Windows, focus navigation, screen-reader announcements, and reduced-width UI on actual devices. The canvas workspace is not a fully accessible semantic publishing view.

## Suggested next engineering checks

Property/fuzz tests for document imports, text-thread mutations and source offsets; conformance suites for Unicode line breaking and bidirectional paragraphs; screenshot parity on GPU and fallback paths; deterministic exports across fonts; history memory tests with large embedded assets; CPU/GPU profiling on Apple, Intel, AMD and Nvidia hardware; automated loss/recovery tests; and a security review for hostile files.
