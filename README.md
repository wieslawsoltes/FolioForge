# FolioForge — Editorial Studio

A functioning, local-first desktop-publishing editor written in plain HTML, CSS, JavaScript ES modules, and WGSL. It opens with a six-page editorial publication containing original architectural artwork. The pages are editable document objects, not a screenshot or a DOM mockup.

**Release:** 0.1.0. **Runtime dependencies:** none. **Build required:** no.

## Run

The fastest route is to open **`FolioForge.html`**, the self-contained edition. It includes the application, styles, and both sample images. Its editing and export functions do not require a CDN or a server. Browser policy can restrict local-file GPU and persistence capabilities.

For development and WebGPU integration testing, serve the canonical source directory:

```sh
cd folioforge
python3 -m http.server 8088 --bind 127.0.0.1
```

Open `http://localhost:8088/`. Use an HTTPS origin for hosted deployments. The status bar reports the backend actually in use; WebGPU initialization failure or device loss switches the editor to Canvas 2D. Add `?renderer=canvas` to force the fallback when testing a served edition.

**Live app:** https://wieslawsoltes.github.io/FolioForge/

All application paths are relative and work under the `/FolioForge/` project-site prefix. The `Pages` GitHub Actions workflow runs the kernel tests, regenerates the self-contained edition and portable sample, and deploys the application to GitHub Pages on pushes to `main`. The editor has no runtime CDN dependencies.

The sample artwork is shipped as optimized WebP images; the original editable SVG artwork is retained in `assets/`. Run `python3 tools/prepare-release.py` after changing sources or artwork to regenerate `FolioForge.html` and the portable sample publication.

## Implemented workflows

| Area | Working functionality |
| --- | --- |
| Publication | New, open, portable save, rename, page sizes, margins, bleed guides, facing/single pages, add/duplicate/delete pages, thumbnail navigation, and a reusable parent-page bottom rule. |
| Layout | Select/direct-select, shift-selection, marquee, move, eight resize handles, rotation, constrained transforms, smart snapping, page-to-page dragging, grouping, layer assignment, alignment, stacking within layers, locking, visibility, copy/cut/paste, duplicate, and keyboard nudging. |
| Text | Native textarea story editing, frame and column composition, linked text stories with source offsets, unlinking, overset indicators, balanced columns, fonts, bold/italic, size, leading, tracking, alignment/justification, paragraph spacing, frame insets, named paragraph-style application, and document-wide literal find/replace. |
| Images | PNG/JPEG/WebP/GIF import, drag-and-drop, embedded image data, image frames, replacement, proportional cover/contain, and a resource panel. GIF placement uses the browser-decoded image; this is not an animation authoring system. |
| Shapes | Rectangles, analytic ellipses, directional rules, fill, stroke, rotation, and opacity. |
| Review | Margin and bleed guides, baseline grid, frame edges, clean preview, missing-reference/overset/off-page/low-resolution checks, and renderer diagnostics. |
| Persistence | Validated, versioned `.folio` JSON; embedded-image portable saves; IndexedDB autosave of the latest publication; visible storage-failure feedback; bounded undo/redo history. |
| Export | Current-page PNG at 1×/2×/3×, current-page SVG with positioned text and embedded images, complete `.folio` publication, and browser print/Save as PDF for all pages. |

## First edit

Double-click a text frame, replace its story, and press **Ctrl/Command+Enter** to apply. **Escape** cancels. An editor opened on a threaded frame edits the **entire story**, not just the characters currently visible in that frame. Native textarea editing is an intentional input layer, not a promise of in-canvas rich-text selection.

Use **V** for selection, **A** for direct selection, **T** for type, **F** for an image frame, **R** for a rectangle, **E** for an ellipse, and **L** for a rule. Hold **Space** to pan. **Ctrl/Command+wheel** zooms around the pointer; **Ctrl/Command+0** fits the spread. **W** toggles preview. **?** opens the keyboard reference.

Use **Ctrl/Command+Z** and **Ctrl/Command+Shift+Z** for undo and redo. Copy/paste is an application-local object clipboard; it is not operating-system clipboard interoperability.

## Engine architecture

### Document kernel — `src/core.js`

The document is a versioned graph of pages, ordered layers, page-local nodes, stories, image assets, styles, and a parent configuration. Geometry is stored in PostScript points: 72 points per inch. Story strings use JavaScript UTF-16 offsets; grapheme segmentation prevents long-word fallback from splitting surrogate pairs or supported grapheme clusters.

`DocumentStore.begin/commit/cancel` makes a pointer gesture one atomic history transaction. Validation failure rolls back the entire transaction. Undo/redo snapshots are count-bounded to 80 entries and budgeted to 32 MiB, but one unusually large transaction can itself exceed that budget. Snapshots are document-level rather than structural patches; this is a deliberate simplicity/performance trade-off that matters for large embedded-image publications.

Validation checks format version, page/object/reference invariants, finite geometry, color values, supported text styles, IDs, image-source policy, and text-thread cycles/multiple predecessors. This is defensive validation, not a claim of complete hostile-document security review.

A uniform-grid broadphase indexes rotated axis-aligned object bounds. Picking then transforms the pointer into local object space for rectangle/ellipse hit testing. The camera provides inverse mappings and cursor-anchored zoom.

### Composition — `src/text.js`

The text engine uses browser Canvas text measurement/shaping and explicit frame/column layout. It preserves source start/end offsets for each frame and feeds the remaining story into its successor. Line, paragraph, alignment, and justification decisions are retained in frame-layout records. Optional terminal-frame column balancing uses a bounded search for the smallest column height that fits the content.

Text measurement and layout have caches. The compositor uses greedy wrapping, browser-provided shaping, and grapheme fallback for long words. It is **not** a complete Unicode line-breaking/bidirectional pagination engine, a TeX-style global paragraph optimizer, or an advanced OpenType typesetter.

### Rendering — `src/renderer.js`

The WebGPU path is a real WGSL pipeline, not a canvas with a GPU label. Each instance has a 96-byte storage-buffer record: rectangle, UV rectangle, fill, stroke, transform/kind/stroke parameters, and opacity. A vertex-index quad expands to two triangles; instance data supplies geometry and transformation.

Rectangles and ellipses are shaded analytically. Text is rasterized into retained, resolution-bucketed frame textures using the browser text shaper. Images use retained textures. The renderer batches **consecutive compatible instances** without reordering alpha-composited content. It sets page scissor rectangles, uploads uniforms/instances, and submits a render pass. Text is not an SDF/MSDF/vector-outline GPU renderer.

Rendering is invalidation-driven rather than an idle animation loop. Viewport bounds reject nonvisible pages and objects. Texture creation is cached, upload dimensions respect device limits, and stale GPU resources are retired. The CPU text-raster cache targets 96 MiB; GPU residency is not a strict total-memory-budget implementation. The document traversal itself is still linear in the relevant node collection and should be benchmarked before using very large books.

A separate transparent Canvas overlay draws editing adorners and rulers. A native textarea overlays a selected frame during editing. If WebGPU is unavailable or lost, the same scene data renders through Canvas 2D. The fallback is explicitly shown in the status bar. GPU device restoration currently means fallback, not automatic reconstruction of a fresh WebGPU device.

`Window → Renderer diagnostics` reports CPU build/submit time, submitted draw calls, retained textures, and cache memory. It does **not** report GPU timestamps or a benchmarked frame-rate guarantee.

### UI/controller — `src/app.js`

An imperative controller binds the command registry, pointer gestures, keyboard dispatch, inspector, page thumbnails, layers, resource list, modal dialogs, local persistence, and export operations. Tools create and mutate document nodes. Menus and keyboard shortcuts use the same command implementations.

### File and export services — `src/io.js`

The `.folio` format is JSON with a `format: "folioforge"` discriminator and `version: 1`. Portable saves embed bundled artwork as raster data URLs. Imported arbitrary network URLs or active SVG uploads are not accepted.

PNG and browser printing use the same composed scene via a dedicated export Canvas. SVG serializes placed geometry and composed text positions and embeds image bytes. SVG text requires fonts on the receiving machine; it is not outlined or embedded-font output. Printer output is raster page imagery at 2×, with trim-sized pages.

## Programmatic access

The running controller is exposed as `window.folioforge`. Selected construction and file APIs are available under `window.FolioForgeAPI`.

```js
const app = window.folioforge;
const document = window.FolioForgeAPI.createDocument({
    name: "My publication",
    width: 612,
    height: 792,
    pages: 8,
});
app.store.replace(document);
app.goPage(0);

// A transaction is the unit of undo, persistence invalidation, and inspector refresh.
app.store.transact("Change margins", doc => {
    doc.settings.margin = 48;
});

// Serialize the active page using the actual composed line positions.
const svgBlob = await window.FolioForgeAPI.exportSVG(
    app.doc,
    app.activePage,
    app.textEngine,
);
```

These are v0.1 APIs rather than a stable third-party plugin ABI. Direct document mutation outside a transaction requires explicit refresh/invalidation and forfeits normal undo behavior.

## Verification

```sh
# Kernel tests: Node.js 20+; no npm install necessary.
npm test

# Recreate the standalone HTML from the canonical source.
python3 tools/bundle.py

# Browser checks: install Python Playwright and provide Chromium separately.
python3 tests/browser_smoke.py
```

The delivered build passed **49 kernel tests and 47 browser integration checks**. The browser checks exercise real pointer and keyboard editing, linked-story composition, image import, SVG/PNG generation, document round-trip, page commands, and desktop/laptop/compact layouts. They recorded no uncaught browser exceptions. See `test-results/browser-report.json` and `test-results/core-report.txt`.

**Validation boundary:** the available browser environment blocks origin navigation. The browser suite therefore injects the self-contained application into an in-memory `about:blank` document. It exercised Canvas 2D, **not WebGPU execution**, and it cannot validate IndexedDB persistence across real-origin reloads. Browser print UI and user-facing download completion were not validated; export image/blob generation was. Run the secure-origin smoke checklist in `TESTING.md` before a release.

## Deliberate scope boundaries

This is a working editor and extensible core, **not full Adobe InDesign feature parity or a press-certified replacement**. The current release does not implement INDD/IDML import/export, mixed-format character spans within a frame, tables, footnotes, automatic TOCs/indexes, paragraph keep/widow/orphan rules, full bidirectional/vertical text layout, sophisticated hyphenation, a general Bézier/path editor, arbitrary custom parent-page objects, text wrap around shapes, ICC-managed CMYK/spot colors, overprint/separations, PDF/X, tagged PDFs, or packaged font embedding.

Object clipping is page-based. The pasteboard is a navigation/creation surface, not a general cross-page object-storage model. Parent support is a reusable bottom rule, not a complete parent-document hierarchy. Grouping supplies joint selection/movement; it does not supply an arbitrary nested scene-graph transform editor. Undo history and the application-local clipboard are not persisted across reloads. Autosave keeps the latest publication, not a multi-document library.

The sample illustration is original procedural artwork, not a third-party architectural photograph. System fonts are referenced, not distributed. Adobe and InDesign are names of their respective owner; FolioForge is independent and unaffiliated.

## Source layout

```text
index.html              Desktop workspace shell
styles.css              Dark UI, controls, panels, responsive layout
FolioForge.html          Generated self-contained application
src/core.js             Document model, transactions, camera, spatial index, preflight
src/text.js             Text measurement, frame/column layout, linked stories
src/renderer.js         WGSL instanced compositor and Canvas fallback
src/app.js              Editor/controller, tools, inspector, menus and dialogs
src/io.js               .folio, images, autosave, SVG, PNG/print support
src/demo.js             Editable six-page editorial publication
src/icons.js            Inline SVG toolbar icons
assets/                 Original illustration sources and raster editions
examples/               Portable sample publication
tools/bundle.py         Standalone HTML packager
Tests and diagnostics are under tests/ and test-results/.
```

## Technical references

The implementation was informed by the WebGPU specification, the WebGPU API/adapter/device-loss documentation, and Adobe's workspace and Properties panel descriptions:

- https://www.w3.org/TR/webgpu/
- https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- https://developer.mozilla.org/en-US/docs/Web/API/GPU/requestAdapter
- https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost
- https://helpx.adobe.com/indesign/using/properties-panel.html
- https://helpx.adobe.com/indesign/using/workspace-basics.html

MIT-licensed source and original artwork. See `LICENSE`.
