import { DocumentStore, Camera, SpatialIndex, createDocument, makeNode, defaultTextStyle, uid, clone, clamp, PT_PER_MM, worldPoint, localPoint, bounds, intersects, preflight, escapeXML } from './core.js';
import { TextEngine, fontString } from './text.js';
import { Renderer } from './renderer.js';
import { createDemo } from './demo.js';
import { icon } from './icons.js';
import { Persistence, downloadBlob, readImageFile, saveDocument, openDocument, exportSVG, printDocument, safeName } from './io.js';
const $ = (s, root = document) => root.querySelector(s), $$ = (s, root = document) => [...root.querySelectorAll(s)];
const field = (label, key, value, { suffix = '', min = '', max = '', step = '1', style = false, full = false } = {}) => `<label class="${full ? 'full' : ''}">${label}<div class="suffix-field"><input type="number" ${style ? 'data-style' : 'data-prop'}="${key}" value="${Number(value || 0).toFixed(step === '1' ? 1 : 2)}" ${min !== '' ? `min="${min}"` : ''} ${max !== '' ? `max="${max}"` : ''} step="${step}" aria-label="${label}">${suffix ? `<span>${suffix}</span>` : ''}</div></label>`;
const palette = ['#f4f1e8', '#ffffff', '#343e2e', '#637056', '#aab29a', '#d4c9ac', '#c38c73', '#e6a295', '#242b23'];
const MENU = {
    File: [['new', 'New publication…', '⌘ N', 'pageAdd'], ['open', 'Open publication…', '⌘ O', 'folder'], ['save', 'Save publication', '⌘ S', 'save'], null, ['placeImage', 'Place images…', '⌘ D', 'image'], null, ['export', 'Export…', '⌘ E', 'download'], ['print', 'Print / Save as PDF…', '', 'printer']],
    Edit: [['undo', 'Undo', '⌘ Z', 'undo'], ['redo', 'Redo', '⇧ ⌘ Z', 'redo'], null, ['cut', 'Cut', '⌘ X'], ['copy', 'Copy', '⌘ C', 'copy'], ['paste', 'Paste', '⌘ V'], ['duplicate', 'Duplicate', '⌘ J'], ['delete', 'Delete', '⌫', 'trash'], null, ['selectAll', 'Select all on spread', '⌘ A'], ['find', 'Find & replace…', '⌘ F', 'search']],
    Layout: [['addPage', 'Add page', '', 'pageAdd'], ['duplicatePage', 'Duplicate current page', '', 'copy'], ['deletePage', 'Delete current page', '', 'trash'], null, ['goToPage', 'Go to page…'], ['documentSetup', 'Document setup…', '', 'settings'], ['facing', 'Toggle facing pages'], ['parent', 'Toggle parent rule']],
    Type: [['editText', 'Edit story…', '⌘ Y', 'text'], ['thread', 'Thread selected frames', '', 'thread'], ['unlink', 'Unlink text thread'], null, ['bold', 'Bold', '⌘ B', 'bold'], ['italic', 'Italic', '⌘ I', 'italic']],
    Object: [['group', 'Group', '⌘ G'], ['ungroup', 'Ungroup', '⇧ ⌘ G'], null, ['bringFront', 'Bring to front', ']', 'front'], ['sendBack', 'Send to back', '[', 'back'], ['lock', 'Lock selection', '⌘ L', 'lock'], ['unlockAll', 'Unlock all on spread'], null, ['fitImage', 'Fill frame proportionally'], ['containImage', 'Fit content proportionally']],
    View: [['fit', 'Fit spread', '⌘ 0', 'fit'], ['actualSize', 'Actual size', '⌘ 1'], ['zoomIn', 'Zoom in', '+', 'plus'], ['zoomOut', 'Zoom out', '−', 'minus'], null, ['guides', 'Toggle margin guides', '⌘ ;', 'grid'], ['grid', 'Toggle baseline grid'], ['frames', 'Toggle frame edges'], ['snap', 'Toggle smart snapping'], ['preview', 'Toggle preview', 'W', 'eye']],
    Window: [['pagesPanel', 'Toggle Pages panel'], ['propertiesPanel', 'Toggle Properties panel'], ['preflight', 'Preflight…'], ['diagnostics', 'Renderer diagnostics…'], null, ['shortcuts', 'Keyboard shortcuts…', '?', 'help'], ['about', 'About FolioForge…', '', 'info']]
};
class FolioForge {
    constructor() {
        this.store = new DocumentStore(createDemo());
        this.textEngine = new TextEngine();
        this.camera = new Camera();
        this.spatial = new SpatialIndex();
        this.persistence = new Persistence();
        this.selection = new Set();
        this.tool = 'select';
        this.activePageIndex = 1;
        this.panel = 'properties';
        this.guides = true;
        this.grid = false;
        this.frameEdges = false;
        this.snapping = true;
        this.preview = false;
        this.drag = null;
        this.editing = null;
        this.clipboard = null;
        this.dirty = false;
        this.frameRequested = false;
        this.thumbVersion = 0;
        this.width = 0;
        this.height = 0;
        this.defaultFill = '#aab29a';
        this.snapLines = [];
        this.overrides = {};
        this.stage = $('#stage');
        this.overlay = $('#overlay');
        this.overlayCtx = this.overlay.getContext('2d');
        this.renderer = new Renderer($('#artwork'), this.textEngine, () => this.invalidate(), (mode, reason) => { this.backend = mode; this.backendReason = reason; $('#backend-status').innerHTML = `<span class="status-dot ${mode === 'Canvas 2D' ? 'warning' : ''}"></span>${mode}`; });
        this.setupUI();
        this.setupEvents();
        this.store.addEventListener('change', e => this.documentChanged(e.detail.reason));
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.stage);
        this.init();
    }
    async init() { const saved = await this.persistence.read(); if (saved) {
        try {
            this.store.replace(saved);
            this.activePageIndex = Math.min(1, this.doc.pages.length - 1);
        }
        catch (e) {
            this.toast('The saved session could not be restored. Opening the sample.');
        }
    } await document.fonts.ready; await this.renderer.initialize(new URLSearchParams(location.search).get('renderer') === 'canvas'); this.refresh(true); this.resize(); this.fit(); this.ready = true; window.dispatchEvent(new CustomEvent('folioforge-ready')); }
    get doc() { return this.store.doc; }
    get selected() { return this.doc.nodes.filter(n => this.selection.has(n.id)); }
    get primary() { return this.store.getNode([...this.selection].at(-1)); }
    get activePage() { return this.doc.pages[clamp(this.activePageIndex, 0, this.doc.pages.length - 1)]; }
    spreads() { if (!this.doc.settings.facing)
        return this.doc.pages.map(p => [p]); const out = [[this.doc.pages[0]]]; for (let i = 1; i < this.doc.pages.length; i += 2)
        out.push(this.doc.pages.slice(i, i + 2)); return out; }
    placements() { const spread = this.spreads().find(s => s.some(p => p.id === this.activePage.id)) || [this.activePage]; return spread.map((p, i) => ({ ...p, x: i * this.doc.settings.width, y: 0, w: this.doc.settings.width, h: this.doc.settings.height })); }
    setupUI() {
        $('#menubar').innerHTML = Object.keys(MENU).map(k => `<button class="menu-button" data-menu="${k}">${k}</button>`).join('');
        const tools = [['select', 'cursor', 'Selection tool (V)'], ['direct', 'direct', 'Direct selection · ignore groups (A)'], null, ['text', 'text', 'Type tool (T)'], ['image', 'frame', 'Image frame (F)'], ['rect', 'rect', 'Rectangle (R)'], ['ellipse', 'ellipse', 'Ellipse (E)'], ['line', 'line', 'Line (L)'], null, ['hand', 'hand', 'Hand (H / hold Space)'], ['zoom', 'zoom', 'Zoom (Z)']];
        $('#tools').innerHTML = tools.map(t => t ? `<button class="tool-button ${t[0] === 'select' ? 'active' : ''}" data-tool="${t[0]}" title="${t[2]}" aria-label="${t[2]}">${icon(t[1])}</button>` : '<div class="tool-divider"></div>').join('');
        this.hydrateIcons();
    }
    hydrateIcons(root = document) { $$('[data-icon]', root).forEach(e => { e.innerHTML = icon(e.dataset.icon); e.removeAttribute('data-icon'); }); }
    setupEvents() {
        document.addEventListener('click', e => { const command = e.target.closest('[data-command]'), tool = e.target.closest('[data-tool]'), menu = e.target.closest('[data-menu]'), panel = e.target.closest('[data-panel]'), align = e.target.closest('[data-align]'), swatch = e.target.closest('[data-swatch]'), style = e.target.closest('[data-paragraph-style]'); if (menu) {
            this.showMenu(menu.dataset.menu, menu);
            return;
        } if (!e.target.closest('#menu-popover'))
            this.closeMenu(); if (command) {
            e.preventDefault();
            this.run(command.dataset.command);
        } if (tool)
            this.setTool(tool.dataset.tool); if (panel) {
            this.panel = panel.dataset.panel;
            this.renderInspector();
        } if (align)
            this.changeStyle({ align: align.dataset.align }); if (swatch)
            this.setColor(swatch.dataset.swatch); if (style)
            this.applyStyle(style.dataset.paragraphStyle); });
        document.addEventListener('change', e => { try {
            const t = e.target;
            if (t.dataset.prop)
                this.changeProperty(t.dataset.prop, t.type === 'checkbox' ? t.checked : Number(t.value));
            if (t.dataset.style)
                this.changeStyle({ [t.dataset.style]: t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value });
            if (t.dataset.setting)
                this.changeSetting(t.dataset.setting, t.type === 'checkbox' ? t.checked : Number(t.value));
            if (t.dataset.color)
                this.setColor(t.value, t.dataset.color);
            if (t.dataset.fit)
                this.changeProperty('fit', t.value);
            if (t.dataset.layerSelect)
                this.changeProperty('layerId', t.value);
        }
        catch (error) {
            this.toast(error.message);
            this.updateControls();
            this.renderInspector();
        } });
        $('#tool-fill').addEventListener('input', e => this.defaultFill = e.target.value);
        $('#tool-fill').addEventListener('change', e => this.setColor(e.target.value));
        $('#file-open').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f)
            try {
                this.stopEditing(true);
                this.store.replace(await openDocument(f));
                this.selection.clear();
                this.activePageIndex = 0;
                this.refresh(true);
                this.fit();
                this.toast('Publication opened.');
            }
            catch (error) {
                this.toast(error.message);
            } e.target.value = ''; });
        $('#image-open').addEventListener('change', e => { this.placeFiles([...e.target.files]); e.target.value = ''; });
        this.overlay.addEventListener('pointerdown', e => this.pointerDown(e));
        this.overlay.addEventListener('pointermove', e => this.pointerMove(e));
        this.overlay.addEventListener('pointerup', e => this.pointerUp(e));
        this.overlay.addEventListener('pointercancel', () => { this.store.cancel(); this.drag = null; this.invalidate(); });
        this.overlay.addEventListener('dblclick', e => { const hit = this.hitAt(e); if (hit?.node?.type === 'text')
            this.startEditing(hit.node);
        else if (hit?.node?.type === 'image') {
            this.select([hit.node.id]);
            this.run('placeImage');
        } });
        this.overlay.addEventListener('contextmenu', e => { e.preventDefault(); const h = this.hitAt(e); if (h && !this.selection.has(h.node.id))
            this.select([h.node.id]); this.showContextMenu(e.clientX, e.clientY); });
        this.stage.addEventListener('wheel', e => { e.preventDefault(); if (this.editing)
            this.stopEditing(true); if (e.ctrlKey || e.metaKey) {
            const p = this.eventPoint(e);
            this.camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * .008));
        }
        else {
            this.camera.x -= e.shiftKey ? e.deltaY : e.deltaX;
            this.camera.y -= e.shiftKey ? 0 : e.deltaY;
        } this.invalidate(); }, { passive: false });
        this.stage.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        this.stage.addEventListener('drop', e => { e.preventDefault(); this.dropLocation = this.hitAt(e)?.local; this.placeFiles([...e.dataTransfer.files]); });
        document.addEventListener('keydown', e => this.keyDown(e));
        document.addEventListener('keyup', e => { if (e.code === 'Space') {
            this.spaceDown = false;
            this.updateCursor();
        } });
        window.addEventListener('blur', () => { this.spaceDown = false; if (this.drag) {
            this.store.cancel();
            this.drag = null;
        } this.updateCursor(); });
        $('#modal-close').onclick = () => $('#modal').close();
        $('#modal').addEventListener('click', e => { if (e.target === $('#modal') && e.clientX < $('#modal').getBoundingClientRect().left)
            $('#modal').close(); });
        $('#page-thumbs').addEventListener('click', e => { const page = e.target.closest('[data-page]'); if (page)
            this.goPage(this.doc.pages.findIndex(p => p.id === page.dataset.page)); });
        $('#inspector-content').addEventListener('click', e => { const eye = e.target.closest('[data-layer-eye]'), lock = e.target.closest('[data-layer-lock]'), node = e.target.closest('[data-node-id]'); if (eye)
            this.store.transact('Layer visibility', d => { const l = d.layers.find(l => l.id === eye.dataset.layerEye); l.visible = !l.visible; }); if (lock)
            this.store.transact('Layer lock', d => { const l = d.layers.find(l => l.id === lock.dataset.layerLock); l.locked = !l.locked; }); if (node) {
            const n = this.store.getNode(node.dataset.nodeId);
            if (n) {
                this.goPage(this.doc.pages.findIndex(p => p.id === n.pageId));
                this.select([n.id]);
            }
        } });
        window.addEventListener('beforeunload', e => { if (this.dirty) {
            e.preventDefault();
            e.returnValue = '';
        } });
    }
    documentChanged(reason) { this.selection = new Set([...this.selection].filter(id => this.store.getNode(id))); this.activePageIndex = clamp(this.activePageIndex, 0, this.doc.pages.length - 1); this.dirty = true; $('#save-status').textContent = 'Saving to this browser…'; $('#dirty-mark').textContent = '•'; clearTimeout(this.saveTimer); const revision = this.store.revision; this.saveTimer = setTimeout(async () => { try {
        await this.persistence.write(clone(this.doc));
        if (this.store.revision === revision) {
            this.dirty = false;
            $('#save-status').innerHTML = `${icon('check', 11)} All changes saved locally`;
            $('#dirty-mark').textContent = '';
        }
    }
    catch (error) {
        $('#save-status').textContent = 'Autosave unavailable — use File → Save';
        if (!this.storageErrorNotified) {
            this.storageErrorNotified = true;
            this.toast('Browser storage is unavailable. Save a .folio file to keep your work.');
        }
    } }, 550); this.refresh(); }
    refresh(initial = false) { $('#document-name').textContent = this.doc.name; document.title = this.doc.name + ' — FolioForge'; $('#page-count').textContent = `${this.doc.pages.length} pages`; $('#spread-count').textContent = `${this.spreads().length} spreads`; $('#parent-status').textContent = this.doc.masters?.A?.enabled ? 'Bottom rule applied' : 'No parent elements'; this.textEngine.compose(this.doc); this.spatial.rebuild(this.doc.layers.flatMap(l => this.doc.nodes.filter(n => n.layerId === l.id))); this.renderInspector(); this.updateControls(); this.renderPageList(); this.updatePreflight(); this.invalidate(); }
    resize() { const r = this.stage.getBoundingClientRect(); this.width = r.width; this.height = r.height; const dpr = window.devicePixelRatio || 1; this.renderer.resize(this.width, this.height, dpr); this.overlay.width = Math.round(this.width * dpr); this.overlay.height = Math.round(this.height * dpr); for (const [id, w, h] of [['ruler-top', this.width, 21], ['ruler-left', 21, this.height]]) {
        const c = $('#' + id);
        c.width = w * dpr;
        c.height = h * dpr;
        c.style.width = w + 'px';
        c.style.height = h + 'px';
    } if (!this.hasFit && this.width > 0) {
        this.fit();
        this.hasFit = true;
    }
    else
        this.invalidate(); }
    fit() { const p = this.placements(); this.camera.fit({ x: 0, y: 0, w: p.length * this.doc.settings.width, h: this.doc.settings.height }, this.width, this.height, 48); this.invalidate(); }
    invalidate() { if (this.frameRequested)
        return; this.frameRequested = true; requestAnimationFrame(() => { this.frameRequested = false; this.textEngine.compose(this.doc); const ps = this.placements(); this.renderer.render(this.doc, ps, this.camera); this.drawOverlay(ps); this.drawRulers(ps); this.updateViewStatus(ps); }); }
    updateViewStatus(ps) { $('#zoom-value').textContent = Math.round(this.camera.zoom * 100) + '%'; const indexes = ps.map(p => this.doc.pages.findIndex(q => q.id === p.id) + 1); $('#page-status').textContent = `${indexes.join('–')} / ${this.doc.pages.length}`; $('#stage-label').textContent = `${indexes.length > 1 ? 'SPREAD' : 'PAGE'} ${indexes.map(i => String(i).padStart(2, '0')).join(' — ')}`; $('#selection-status').textContent = this.selection.size ? `${this.selection.size} ${this.selection.size === 1 ? 'object' : 'objects'} selected` : 'No selection'; }
    drawRulers(ps) { const dpr = window.devicePixelRatio || 1, z = this.camera.zoom; const step = z < .25 ? 200 : z < .5 ? 100 : z < 1 ? 50 : z < 2 ? 20 : 10; for (const horizontal of [true, false]) {
        const canvas = $(horizontal ? '#ruler-top' : '#ruler-left'), c = canvas.getContext('2d'), length = horizontal ? this.width : this.height;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.fillStyle = '#333834';
        c.fillRect(0, 0, horizontal ? length : 21, horizontal ? 21 : length);
        c.font = '8px Arial';
        c.fillStyle = '#a0aa98';
        c.strokeStyle = '#69725f';
        c.lineWidth = .5;
        const origin = horizontal ? this.camera.x : this.camera.y;
        for (let v = Math.floor(-origin / z / (step / 5)) * (step / 5); origin + v * z < length; v += step / 5) {
            const screen = origin + v * z;
            const major = Math.abs(v / step - Math.round(v / step)) < .001;
            c.beginPath();
            if (horizontal) {
                c.moveTo(screen, 21);
                c.lineTo(screen, major ? 12 : 17);
                if (major)
                    c.fillText(Math.round(v), screen + 3, 9);
            }
            else {
                c.moveTo(21, screen);
                c.lineTo(major ? 12 : 17, screen);
                if (major) {
                    c.save();
                    c.translate(8, screen + 4);
                    c.rotate(-Math.PI / 2);
                    c.fillText(Math.round(v), 0, 0);
                    c.restore();
                }
            }
            c.stroke();
        }
    } }
    drawOverlay(ps) {
        const c = this.overlayCtx, dpr = window.devicePixelRatio || 1, z = this.camera.zoom;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, this.width, this.height);
        const rect = (x, y, w, h) => { const p = this.camera.toScreen(x, y); return { x: p.x, y: p.y, w: w * z, h: h * z }; };
        if (!this.preview) {
            for (const p of ps) {
                if (this.guides) {
                    const bleed = this.doc.settings.bleed;
                    if (bleed > 0) {
                        const br = rect(p.x - bleed, p.y - bleed, p.w + bleed * 2, p.h + bleed * 2);
                        c.strokeStyle = '#d9867840';
                        c.lineWidth = .55;
                        c.strokeRect(br.x, br.y, br.w, br.h);
                    }
                    const m = this.doc.settings.margin, r = rect(p.x + m, p.y + m, p.w - m * 2, p.h - m * 2);
                    c.strokeStyle = '#dc85ba58';
                    c.lineWidth = .65;
                    c.strokeRect(r.x, r.y, r.w, r.h);
                }
                if (this.grid) {
                    c.strokeStyle = '#99c2da28';
                    c.lineWidth = .5;
                    for (let y = this.doc.settings.margin; y < p.h; y += 14) {
                        const a = this.camera.toScreen(p.x, y), b = this.camera.toScreen(p.x + p.w, y);
                        c.beginPath();
                        c.moveTo(a.x, a.y);
                        c.lineTo(b.x, b.y);
                        c.stroke();
                    }
                }
                for (const n of this.store.nodesOnPage(p.id)) {
                    if (this.frameEdges && (n.type === 'text' || n.type === 'image'))
                        this.drawNodeOutline(c, n, p, '#abcde43a', .7);
                    const layout = this.textEngine.layouts.get(n.id);
                    if (layout?.overflow && !n.nextId) {
                        const a = worldPoint(n, n.w, n.h), r = rect(p.x + a.x, p.y + a.y, 0, 0);
                        c.fillStyle = '#df8a75';
                        c.fillRect(r.x - 6, r.y - 6, 9, 9);
                        c.fillStyle = '#fff';
                        c.font = 'bold 10px Arial';
                        c.fillText('+', r.x - 5, r.y + 2);
                    }
                }
            }
        }
        if (!this.preview) {
            for (const n of this.selected) {
                const p = ps.find(p => p.id === n.pageId);
                if (!p)
                    continue;
                this.drawNodeOutline(c, n, p, '#e3b0a1', 1);
                const handles = this.nodeHandles(n, p);
                for (const h of handles) {
                    c.fillStyle = '#f5ebd9';
                    c.strokeStyle = '#b87969';
                    c.lineWidth = 1;
                    if (h.name === 'rotate') {
                        const top = handles.find(h => h.name === 'n');
                        c.beginPath();
                        c.moveTo(top.x, top.y);
                        c.lineTo(h.x, h.y);
                        c.stroke();
                        c.beginPath();
                        c.arc(h.x, h.y, 3.7, 0, Math.PI * 2);
                        c.fill();
                        c.stroke();
                    }
                    else {
                        c.fillRect(h.x - 3, h.y - 3, 6, 6);
                        c.strokeRect(h.x - 3, h.y - 3, 6, 6);
                    }
                }
                if (n.type === 'text' && n.nextId) {
                    const next = this.store.getNode(n.nextId), np = ps.find(p => p.id === next?.pageId);
                    if (np) {
                        const a = this.camera.toScreen(p.x + n.x + n.w, p.y + n.y + n.h), b = this.camera.toScreen(np.x + next.x, np.y + next.y);
                        c.beginPath();
                        c.setLineDash([4, 3]);
                        c.strokeStyle = '#8bafcf';
                        c.moveTo(a.x, a.y);
                        c.lineTo(b.x, b.y);
                        c.stroke();
                        c.setLineDash([]);
                    }
                }
            }
        }
        if (this.drag?.type === 'marquee' || this.drag?.type === 'create') {
            const a = this.drag.start, b = this.drag.current || a;
            c.fillStyle = '#e8bb9f12';
            c.strokeStyle = '#e8bb9f';
            c.setLineDash([4, 3]);
            c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
            c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
            c.setLineDash([]);
        }
        for (const line of this.snapLines) {
            c.strokeStyle = '#e997cc';
            c.lineWidth = .8;
            const a = this.camera.toScreen(line.x1, line.y1), b = this.camera.toScreen(line.x2, line.y2);
            c.beginPath();
            c.moveTo(a.x, a.y);
            c.lineTo(b.x, b.y);
            c.stroke();
        }
    }
    drawNodeOutline(c, n, page, stroke, width) { const points = [[0, 0], [n.w, 0], [n.w, n.h], [0, n.h]].map(([x, y]) => worldPoint(n, x, y)).map(p => this.camera.toScreen(p.x + page.x, p.y + page.y)); c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath(); c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
    nodeHandles(n, p) { const positions = [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5], ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5], ['rotate', .5, -22 / (this.camera.zoom * n.h)]]; return positions.map(([name, x, y]) => { const v = worldPoint(n, x * n.w, y * n.h), s = this.camera.toScreen(v.x + p.x, v.y + p.y); return { name, ...s }; }); }
    eventPoint(e) { const r = this.overlay.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    hitAt(e) { const p = this.eventPoint(e), w = this.camera.toWorld(p.x, p.y), page = this.placements().find(q => w.x >= q.x && w.y >= q.y && w.x <= q.x + q.w && w.y <= q.y + q.h); if (!page)
        return null; const local = { x: w.x - page.x, y: w.y - page.y }; const node = this.spatial.point(page.id, local.x, local.y).find(n => this.store.selectable(n)); return { page, local, node }; }
    pointerDown(e) {
        if (e.button === 2)
            return;
        if (this.editing)
            this.stopEditing(true);
        this.closeMenu();
        this.overlay.focus();
        const start = this.eventPoint(e);
        this.overlay.setPointerCapture(e.pointerId);
        if (this.spaceDown || this.tool === 'hand' || e.button === 1) {
            e.preventDefault();
            this.drag = { type: 'pan', start, camera: { x: this.camera.x, y: this.camera.y } };
            this.updateCursor('grabbing');
            return;
        }
        if (this.tool === 'zoom') {
            this.camera.zoomAt(start.x, start.y, e.altKey ? .8 : 1.25);
            this.invalidate();
            return;
        }
        const hit = this.hitAt(e);
        if (this.tool === 'select' || this.tool === 'direct') {
            if (!this.preview && this.selection.size === 1) {
                const n = this.primary, p = this.placements().find(p => p.id === n.pageId);
                if (p && this.store.selectable(n)) {
                    const handle = this.nodeHandles(n, p).find(h => Math.hypot(h.x - start.x, h.y - start.y) < 8);
                    if (handle) {
                        this.store.begin(handle.name === 'rotate' ? 'Rotate object' : 'Resize object');
                        this.drag = { type: handle.name === 'rotate' ? 'rotate' : 'resize', handle: handle.name, start, node: clone(n), page: p };
                        return;
                    }
                }
            }
            if (hit?.node) {
                const n = hit.node;
                this.activePageIndex = this.doc.pages.findIndex(p => p.id === hit.page.id);
                let ids = this.tool === 'select' && n.groupId ? this.doc.nodes.filter(q => q.groupId === n.groupId && this.store.selectable(q)).map(q => q.id) : [n.id];
                if (e.shiftKey) {
                    for (const id of ids)
                        this.selection.has(id) ? this.selection.delete(id) : this.selection.add(id);
                    this.select([...this.selection]);
                }
                else if (!this.selection.has(n.id))
                    this.select(ids);
                if (this.selection.size) {
                    if (e.altKey) {
                        this.select(this.store.duplicateNodes([...this.selection], 0));
                    }
                    this.store.begin('Move objects');
                    this.drag = { type: 'move', start, nodes: this.selected.map(clone), page: hit.page };
                }
            }
            else {
                if (!e.shiftKey)
                    this.select([]);
                this.drag = { type: 'marquee', start, current: start, previous: [...this.selection] };
            }
        }
        else if (hit) {
            this.activePageIndex = this.doc.pages.findIndex(p => p.id === hit.page.id);
            if (this.tool === 'text' && hit.node?.type === 'text') {
                this.startEditing(hit.node);
                return;
            }
            this.drag = { type: 'create', start, current: start, page: hit.page, tool: this.tool };
        }
        this.invalidate();
    }
    pointerMove(e) {
        const pos = this.eventPoint(e);
        if (!this.drag) {
            if (this.tool === 'select' && this.selection.size === 1) {
                const n = this.primary, p = this.placements().find(p => p.id === n.pageId), h = p && this.nodeHandles(n, p).find(h => Math.hypot(h.x - pos.x, h.y - pos.y) < 8);
                this.updateCursor(h ? h.name === 'rotate' ? 'crosshair' : `${({ n: 'ns', s: 'ns', e: 'ew', w: 'ew', nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw' })[h.name]}-resize` : null);
            }
            return;
        }
        const d = this.drag;
        d.current = pos;
        const dx = (pos.x - d.start.x) / this.camera.zoom, dy = (pos.y - d.start.y) / this.camera.zoom;
        if (d.type === 'pan') {
            this.camera.x = d.camera.x + pos.x - d.start.x;
            this.camera.y = d.camera.y + pos.y - d.start.y;
        }
        if (d.type === 'move') {
            let x = dx, y = dy;
            if (e.shiftKey) {
                if (Math.abs(x) > Math.abs(y))
                    y = 0;
                else
                    x = 0;
            }
            this.snapLines = [];
            if (this.snapping && !e.ctrlKey && !e.metaKey && d.nodes.length === 1) {
                const n = d.nodes[0], s = this.snap(n.x + x, n.y + y, n, d.page);
                x += s.dx;
                y += s.dy;
            }
            for (const original of d.nodes) {
                const n = this.store.getNode(original.id);
                n.x = original.x + x;
                n.y = original.y + y;
            }
            this.updateControls();
        }
        if (d.type === 'resize') {
            const n = this.store.getNode(d.node.id), o = d.node, w = this.camera.toWorld(pos.x, pos.y), local = localPoint(o, w.x - d.page.x, w.y - d.page.y);
            let x0 = 0, y0 = 0, x1 = o.w, y1 = o.h;
            if (d.handle.includes('w'))
                x0 = Math.min(local.x, o.w - 2);
            if (d.handle.includes('e'))
                x1 = Math.max(2, local.x);
            if (d.handle.includes('n'))
                y0 = Math.min(local.y, o.h - 2);
            if (d.handle.includes('s'))
                y1 = Math.max(2, local.y);
            if (e.shiftKey) {
                const ratio = o.w / o.h;
                if (d.handle.includes('s'))
                    y1 = y0 + (x1 - x0) / ratio;
                else if (d.handle.includes('n'))
                    y0 = y1 - (x1 - x0) / ratio;
            }
            const center = worldPoint(o, (x0 + x1) / 2, (y0 + y1) / 2);
            n.w = clamp(x1 - x0, 2, 20000);
            n.h = clamp(y1 - y0, 2, 20000);
            n.x = center.x - n.w / 2;
            n.y = center.y - n.h / 2;
            this.updateControls();
        }
        if (d.type === 'rotate') {
            const n = this.store.getNode(d.node.id), center = this.camera.toScreen(d.page.x + n.x + n.w / 2, d.page.y + n.y + n.h / 2);
            const a = Math.atan2(pos.y - center.y, pos.x - center.x) - Math.atan2(d.start.y - center.y, d.start.x - center.x);
            n.rotation = d.node.rotation + a * 180 / Math.PI;
            if (e.shiftKey)
                n.rotation = Math.round(n.rotation / 15) * 15;
            this.updateControls();
        }
        this.invalidate();
    }
    snap(x, y, n, p) { const threshold = 5 / this.camera.zoom; let dx = 0, dy = 0, bx = threshold, by = threshold; const tx = [0, this.doc.settings.margin, p.w / 2, p.w - this.doc.settings.margin, p.w], ty = [0, this.doc.settings.margin, p.h / 2, p.h - this.doc.settings.margin, p.h]; for (const q of this.store.nodesOnPage(p.id)) {
        if (q.id === n.id || this.selection.has(q.id) || q.locked)
            continue;
        tx.push(q.x, q.x + q.w / 2, q.x + q.w);
        ty.push(q.y, q.y + q.h / 2, q.y + q.h);
    } for (const a of [x, x + n.w / 2, x + n.w])
        for (const target of tx)
            if (Math.abs(target - a) < bx) {
                bx = Math.abs(target - a);
                dx = target - a;
                this.snapX = target;
            } for (const a of [y, y + n.h / 2, y + n.h])
        for (const target of ty)
            if (Math.abs(target - a) < by) {
                by = Math.abs(target - a);
                dy = target - a;
                this.snapY = target;
            } if (bx < threshold)
        this.snapLines.push({ x1: p.x + this.snapX, y1: 0, x2: p.x + this.snapX, y2: p.h }); if (by < threshold)
        this.snapLines.push({ x1: p.x, y1: this.snapY, x2: p.x + p.w, y2: this.snapY }); return { dx, dy }; }
    pointerUp(e) {
        const d = this.drag;
        if (!d)
            return;
        this.drag = null;
        this.snapLines = [];
        try {
            if (d.type === 'move') {
                for (const n of this.selected) {
                    const source = this.placements().find(p => p.id === n.pageId);
                    if (!source)
                        continue;
                    const cx = source.x + n.x + n.w / 2, cy = n.y + n.h / 2, target = this.placements().find(p => cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h);
                    if (target && target.id !== n.pageId) {
                        n.x += source.x - target.x;
                        n.pageId = target.id;
                    }
                }
            }
            if (['move', 'resize', 'rotate'].includes(d.type))
                this.store.commit();
            if (d.type === 'marquee') {
                const a = this.camera.toWorld(d.start.x, d.start.y), b = this.camera.toWorld((d.current || d.start).x, (d.current || d.start).y);
                const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
                const ids = [...d.previous];
                for (const p of this.placements())
                    for (const n of this.store.nodesOnPage(p.id)) {
                        const b = bounds(n);
                        b.x += p.x;
                        b.y += p.y;
                        if (this.store.selectable(n) && intersects(box, b) && box.w > 2 && box.h > 2)
                            ids.push(n.id);
                    }
                this.select(ids);
            }
            if (d.type === 'create') {
                const a = this.camera.toWorld(d.start.x, d.start.y), b = this.camera.toWorld((d.current || d.start).x, (d.current || d.start).y);
                let x = Math.min(a.x, b.x) - d.page.x, y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
                if (w < 5 && h < 5) {
                    w = d.tool === 'text' ? 240 : 160;
                    h = d.tool === 'text' ? 100 : 140;
                }
                let rotation = 0;
                if (d.tool === 'line') {
                    const vx = b.x - a.x, vy = b.y - a.y;
                    w = Math.hypot(vx, vy) || 160;
                    h = 1;
                    x = (a.x + b.x) / 2 - d.page.x - w / 2;
                    y = (a.y + b.y) / 2 - .5;
                    rotation = Math.atan2(vy, vx) * 180 / Math.PI;
                }
                else if (e.shiftKey && ['rect', 'ellipse'].includes(d.tool)) {
                    w = h = Math.max(w, h);
                }
                const n = makeNode(d.tool, d.page.id, { x, y, w: Math.max(2, w), h: Math.max(1, h), rotation, fill: d.tool === 'text' ? 'none' : this.defaultFill });
                this.store.transact(`Create ${d.tool}`, doc => { if (d.tool === 'text') {
                    n.storyId = uid('story');
                    n.layerId = 'type';
                    if (!doc.layers.some(l => l.id === 'type'))
                        n.layerId = doc.layers[0].id;
                    n.style = { ...defaultTextStyle, ...this.overrides, fontSize: this.overrides.fontSize || 18 };
                    doc.stories[n.storyId] = { text: 'Your story starts here.' };
                }
                else
                    n.layerId = doc.layers[0].id; if (d.tool === 'image') {
                    n.assetId = null;
                    n.fit = 'cover';
                } doc.nodes.push(n); });
                this.setTool('select');
                this.select([n.id]);
                if (d.tool === 'text')
                    this.startEditing(n);
                if (d.tool === 'image')
                    this.run('placeImage');
            }
        }
        catch (error) {
            this.toast(error.message);
            this.store.cancel();
        }
        this.spatial.rebuild(this.doc.layers.flatMap(l => this.doc.nodes.filter(n => n.layerId === l.id)));
        this.updateCursor();
        this.invalidate();
    }
    updateCursor(override) { const cursors = { select: 'default', direct: 'default', text: 'text', image: 'crosshair', rect: 'crosshair', ellipse: 'crosshair', line: 'crosshair', hand: 'grab', zoom: 'zoom-in' }; this.overlay.style.cursor = override || (this.spaceDown ? 'grab' : cursors[this.tool]); }
    setTool(tool) { this.stopEditing(true); this.tool = tool; $$('[data-tool]').forEach(e => e.classList.toggle('active', e.dataset.tool === tool)); this.updateCursor(); this.invalidate(); }
    select(ids) { this.selection = new Set(ids); this.updateControls(); this.renderInspector(); this.invalidate(); }
    goPage(index) { this.stopEditing(true); this.activePageIndex = clamp(index, 0, this.doc.pages.length - 1); this.selection.clear(); this.renderInspector(); this.updateControls(); this.markActivePages(); this.fit(); }
    markActivePages() { const id = this.activePage.id; $$('[data-page]').forEach(e => e.classList.toggle('active', e.dataset.page === id)); }
    updateControls() { const n = this.primary, s = { ...defaultTextStyle, ...n?.style, ...(!n ? this.overrides : {}) }; for (const key of ['x', 'y', 'w', 'h']) {
        const input = $('#control-' + key);
        input.value = (n?.[key] ?? (key === 'w' ? this.doc.settings.width : key === 'h' ? this.doc.settings.height : 0)).toFixed(1);
        input.disabled = !n;
    } $('#control-font').value = s.fontFamily; $('#control-weight').value = s.fontWeight; $('#control-size').value = s.fontSize; $('#control-leading').value = s.leading; $$('[data-align]').forEach(e => e.classList.toggle('active', e.dataset.align === s.align)); $$('[data-command="undo"]').forEach(e => e.disabled = !this.store.undoStack.length); $$('[data-command="redo"]').forEach(e => e.disabled = !this.store.redoStack.length); }
    changeProperty(key, value) { if (!this.selection.size)
        return; if (typeof value === 'number') {
        if (!Number.isFinite(value))
            return;
        const ranges = { w: [1, 20000], h: [1, 20000], x: [-100000, 100000], y: [-100000, 100000], opacity: [0, 1], rotation: [-3600, 3600], strokeWidth: [0, 100] };
        if (ranges[key])
            value = clamp(value, ...ranges[key]);
    } this.store.transact('Change ' + key, () => { for (const n of this.selected)
        if (key === 'locked' || this.store.selectable(n))
            n[key] = value; }); }
    changeStyle(values) { const numeric = { fontSize: [1, 1000], leading: [.5, 10], columns: [1, 12], gutter: [0, 1000], inset: [0, 500], tracking: [-20, 100], paragraphSpace: [0, 500] }; for (const [key, v] of Object.entries(values)) {
        if (key in numeric) {
            if (!Number.isFinite(v))
                return;
            values[key] = clamp(v, ...numeric[key]);
            if (key === 'columns')
                values[key] = Math.round(values[key]);
        }
    } const frames = this.selected.filter(n => n.type === 'text' && this.store.selectable(n)); if (!frames.length) {
        Object.assign(this.overrides, values);
        this.updateControls();
        return;
    } this.store.transact('Text formatting', () => { for (const n of frames) {
        Object.assign(n.style, values);
        n.styleId = null;
    } }); }
    changeSetting(key, value) { this.store.transact('Document settings', d => { if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw Error('Enter a valid value.');
        value = clamp(value, key === 'margin' || key === 'bleed' ? 0 : 72, key === 'margin' ? Math.min(d.settings.width, d.settings.height) / 2 - 1 : key === 'bleed' ? 100 : 14400);
    } d.settings[key] = value; }); if (key === 'width' || key === 'height' || key === 'facing')
        this.fit(); }
    setColor(value, target) { if (!this.selected.length) {
        this.defaultFill = value;
        return;
    } this.store.transact('Apply color', () => { for (const n of this.selected) {
        if (target === 'text' || (!target && n.type === 'text'))
            n.style.color = value === 'none' ? '#343e2e' : value;
        else
            n[target || 'fill'] = value;
    } }); }
    applyStyle(id) { const style = this.doc.styles.find(s => s.id === id); if (!style)
        return; this.store.transact('Apply paragraph style', () => { for (const n of this.selected.filter(n => n.type === 'text')) {
        const { id: _, name, ...values } = style;
        n.style = { ...values };
        n.styleId = id;
    } }); }
    renderInspector() {
        const root = $('#inspector-content');
        $$('[data-panel]').forEach(e => e.classList.toggle('active', e.dataset.panel === this.panel));
        if (this.panel === 'layers') {
            root.innerHTML = `<div class="inspector-section"><h3>Layers <span class="section-eyebrow">${this.doc.layers.length} LAYERS</span></h3><p class="selection-desc">Back-to-front order. Toggle visibility or lock layers without changing the artwork.</p></div>` + this.doc.layers.slice().reverse().map(l => `<div class="layer-row"><button class="icon-button small" data-layer-eye="${l.id}" title="Toggle ${escapeXML(l.name)} visibility" style="opacity:${l.visible ? 1 : .35}">${icon('eye', 14)}</button><button class="icon-button small" data-layer-lock="${l.id}" title="Toggle layer lock">${icon(l.locked ? 'lock' : 'unlock', 13)}</button><span class="layer-color" style="background:${l.color}"></span><span class="name">${escapeXML(l.name)}</span><span class="section-eyebrow">${this.doc.nodes.filter(n => n.layerId === l.id).length}</span></div>` + this.doc.nodes.filter(n => n.layerId === l.id && this.placements().some(p => p.id === n.pageId)).slice().reverse().map(n => `<button class="layer-node ${this.selection.has(n.id) ? 'active' : ''}" data-node-id="${n.id}">${icon(n.type === 'text' ? 'text' : n.type === 'image' ? 'image' : 'rect', 13)}${escapeXML(n.name)}</button>`).join('')).join('');
            return;
        }
        if (this.panel === 'links') {
            root.innerHTML = `<div class="inspector-section"><h3>Image resources <span class="section-eyebrow">${Object.keys(this.doc.assets).length} ASSETS</span></h3><button class="section-button" data-command="placeImage">${icon('image', 15)}Place an image</button></div>` + Object.entries(this.doc.assets).map(([id, a]) => `<div class="link-entry"><img src="${escapeXML(a.src)}" alt=""><span>${escapeXML(a.name)}<small>${a.width} × ${a.height} px · ${this.doc.nodes.filter(n => n.assetId === id).length} placements</small><small>${a.src.startsWith('data:') ? 'Embedded in document' : 'Bundled artwork'}</small></span></div>`).join('');
            return;
        }
        const n = this.primary, multi = this.selection.size > 1;
        let html = '';
        if (!n) {
            const s = this.doc.settings;
            html += `<section class="inspector-section"><div class="object-title"><span class="object-symbol">${icon('pages', 18)}</span><div><div class="selection-kind">Document</div><div class="selection-desc">Print publication · Facing pages ${s.facing ? 'on' : 'off'}</div></div></div></section><section class="inspector-section"><h3>Page setup <span class="section-eyebrow">POINTS</span></h3><div class="field-grid"><label>Width<div class="suffix-field"><input data-setting="width" type="number" value="${s.width.toFixed(1)}" min="72" max="14400"><span>pt</span></div></label><label>Height<div class="suffix-field"><input data-setting="height" type="number" value="${s.height.toFixed(1)}" min="72" max="14400"><span>pt</span></div></label><label>Margins<div class="suffix-field"><input data-setting="margin" type="number" value="${s.margin}" min="0"><span>pt</span></div></label><label>Bleed<div class="suffix-field"><input data-setting="bleed" type="number" value="${s.bleed}" min="0" max="100"><span>pt</span></div></label></div><label class="toggle-row"><input type="checkbox" data-setting="facing" ${s.facing ? 'checked' : ''}> Facing pages</label></section><section class="inspector-section"><h3>Layout aids</h3><div class="quick-grid"><button data-command="guides" class="${this.guides ? 'active' : ''}">${icon('grid', 14)} Guides ${this.guides ? 'on' : 'off'}</button><button data-command="snap">${icon('fit', 14)} Snap ${this.snapping ? 'on' : 'off'}</button></div><label class="toggle-row"><input type="checkbox" id="grid-toggle" ${this.grid ? 'checked' : ''}> Show baseline grid</label></section>`;
        }
        else {
            html += `<section class="inspector-section"><div class="object-title"><span class="object-symbol">${icon(n.type === 'text' ? 'text' : n.type === 'image' ? 'image' : 'rect', 18)}</span><div><div class="selection-kind">${multi ? `${this.selection.size} objects` : n.type === 'text' ? 'Text frame' : n.type === 'image' ? 'Image frame' : n.type === 'ellipse' ? 'Ellipse' : 'Shape'}</div><div class="selection-desc">${multi ? 'Multiple selection' : escapeXML(n.name)}</div></div></div></section><section class="inspector-section"><h3>Transform <span class="section-eyebrow">POINTS</span></h3><div class="field-grid">${field('X position', 'x', n.x, { suffix: 'pt' })}${field('Y position', 'y', n.y, { suffix: 'pt' })}${field('Width', 'w', n.w, { suffix: 'pt', min: 1 })}${field('Height', 'h', n.h, { suffix: 'pt', min: 1 })}${field('Rotation', 'rotation', n.rotation, { suffix: '°' })}${field('Opacity', 'opacity', n.opacity, { min: 0, max: 1, step: '.01' })}</div><div class="align-buttons"><button data-command="alignLeft" title="Align selection left">${icon('alignLeft', 16)}</button><button data-command="alignCenter" title="Center selection horizontally">${icon('alignCenter', 16)}</button><button data-command="alignRight" title="Align selection right">${icon('alignRight', 16)}</button><button data-command="alignTop" title="Align selection top">${icon('top', 16)}</button><button data-command="alignBottom" title="Align selection bottom">${icon('bottom', 16)}</button></div></section>`;
            if (n.type === 'text') {
                const s = n.style;
                html += `<section class="inspector-section"><h3>Character ${icon('text', 14)}</h3><div class="field-grid"><label class="full">Font family<select data-style="fontFamily">${['Georgia', 'Arial', 'Times New Roman', 'Verdana', 'Courier New'].map(f => `<option ${f === s.fontFamily ? 'selected' : ''}>${f}</option>`).join('')}</select></label>${field('Size', 'fontSize', s.fontSize, { suffix: 'pt', min: 1, max: 1000, style: true })}${field('Leading', 'leading', s.leading, { min: .5, max: 10, step: '.05', style: true })}${field('Tracking', 'tracking', s.tracking, { suffix: 'pt', step: '.1', style: true })}<label>Weight<select data-style="fontWeight"><option value="400" ${s.fontWeight === '400' ? 'selected' : ''}>Regular</option><option value="700" ${s.fontWeight === '700' ? 'selected' : ''}>Bold</option></select></label></div><div class="align-buttons">${[['left', 'alignLeft'], ['center', 'alignCenter'], ['right', 'alignRight'], ['justify', 'justify']].map(([a, i]) => `<button data-align="${a}" class="${s.align === a ? 'active' : ''}" title="${a}">${icon(i, 16)}</button>`).join('')}<button data-command="italic" class="${s.italic ? 'active' : ''}" title="Italic">${icon('italic', 16)}</button></div></section><section class="inspector-section"><h3>Text frame</h3><div class="field-grid">${field('Columns', 'columns', s.columns, { min: 1, max: 12, style: true })}${field('Gutter', 'gutter', s.gutter, { suffix: 'pt', min: 0, style: true })}${field('Inset', 'inset', s.inset, { suffix: 'pt', min: 0, style: true })}${field('Paragraph space', 'paragraphSpace', s.paragraphSpace, { suffix: 'pt', min: 0, style: true })}</div><label class="toggle-row"><input type="checkbox" data-style="balanceColumns" ${s.balanceColumns ? 'checked' : ''}> Balance columns</label><button class="section-button" data-command="editText" style="margin-top:14px">${icon('text', 14)} Edit story</button><p class="thread-note">${n.nextId ? 'Linked to a continuation frame.' : this.doc.nodes.some(q => q.nextId === n.id) ? 'Receives text from another frame.' : 'Select two text frames to thread a story.'}</p></section>`;
            }
            html += `<section class="inspector-section"><h3>Appearance</h3>${n.type === 'text' ? this.colorRow('Text', n.style.color, 'text') : this.colorRow('Fill', n.fill, 'fill')}${this.colorRow('Stroke', n.stroke, 'stroke')}<div class="property-row"><span>Stroke size</span><input type="number" data-prop="strokeWidth" value="${n.strokeWidth}" min="0" max="100"><span>pt</span></div>${n.type === 'image' ? `<div class="field-grid" style="margin-top:14px"><label class="full">Frame fitting<select data-fit="1"><option value="cover" ${n.fit === 'cover' ? 'selected' : ''}>Fill frame proportionally</option><option value="contain" ${n.fit === 'contain' ? 'selected' : ''}>Fit content proportionally</option></select></label></div><button class="section-button" data-command="placeImage" style="margin-top:12px">${icon('image', 14)} Replace image</button>` : ''}</section>`;
        }
        html += `<section class="inspector-section"><h3>Swatches <span class="section-eyebrow">FORM PALETTE</span></h3><div class="swatch-grid"><button class="swatch none" data-swatch="none" title="No fill"></button>${palette.map(c => `<button class="swatch" style="--swatch:${c}" data-swatch="${c}" title="${c}"></button>`).join('')}</div><div class="swatches-caption">Earth, paper, and a little warmth.</div></section>`;
        if (!n || n.type === 'text')
            html += `<section class="inspector-section"><h3>Paragraph styles ${icon('text', 14)}</h3><div class="style-list">${this.doc.styles.map(s => `<button class="style-row ${n?.styleId === s.id ? 'active' : ''}" data-paragraph-style="${s.id}" ${!n ? 'disabled' : ''}><span class="style-icon">${s.id === 'display' ? 'Aa' : '¶'}</span>${escapeXML(s.name)}</button>`).join('')}</div></section>`;
        if (n)
            html += `<section class="inspector-section"><h3>Arrange</h3><div class="quick-grid"><button data-command="bringFront">${icon('front', 14)} To front</button><button data-command="sendBack">${icon('back', 14)} To back</button><button data-command="duplicate">${icon('copy', 14)} Duplicate</button><button data-command="lock">${icon('lock', 14)} Lock</button></div><div class="field-grid" style="margin-top:14px"><label class="full">Layer<select data-layer-select="1">${this.doc.layers.map(l => `<option value="${l.id}" ${n.layerId === l.id ? 'selected' : ''}>${escapeXML(l.name)}</option>`).join('')}</select></label></div></section>`;
        else
            html += `<section class="inspector-section"><h3>Quick actions</h3><button class="section-button" data-command="placeImage">${icon('image', 14)} Place an image</button><button class="section-button" data-command="addPage">${icon('pageAdd', 14)} Add a page</button></section>`;
        root.innerHTML = html;
        const grid = $('#grid-toggle');
        if (grid)
            grid.onchange = () => this.run('grid');
    }
    colorRow(label, value, target) { return `<div class="property-row"><span>${label}</span><label class="color-control"><input type="color" data-color="${target}" value="${value === 'none' ? '#ffffff' : value}"><span class="color-label">${value === 'none' ? 'None' : value.toUpperCase()}</span></label>${target !== 'text' ? `<button class="icon-button small" data-command="clear-${target}" title="Remove ${target}">${icon('close', 12)}</button>` : ''}</div>`; }
    renderPageList() { const root = $('#page-thumbs'); root.innerHTML = this.spreads().map(sp => `<div class="thumb-spread">${sp.map(p => `<button class="page-thumb ${this.activePage.id === p.id ? 'active' : ''}" data-page="${p.id}" title="Page ${this.doc.pages.indexOf(p) + 1}"><canvas width="128" height="181" aria-label="Page ${this.doc.pages.indexOf(p) + 1} thumbnail"></canvas>${p.master === 'A' ? '<span class="parent-label">A</span>' : ''}<span>${this.doc.pages.indexOf(p) + 1}</span></button>`).join('')}</div>`).join(''); clearTimeout(this.thumbTimer); const version = ++this.thumbVersion; this.thumbTimer = setTimeout(async () => { for (const page of this.doc.pages) {
        if (version !== this.thumbVersion)
            return;
        const thumb = $(`[data-page="${page.id}"] canvas`);
        if (!thumb)
            continue;
        try {
            const canvas = await this.renderer.pageCanvas(this.doc, page, .25);
            if (version !== this.thumbVersion)
                return;
            thumb.height = Math.round(128 * this.doc.settings.height / this.doc.settings.width);
            thumb.style.height = `${thumb.clientWidth * this.doc.settings.height / this.doc.settings.width}px`;
            thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
        }
        catch (e) {
            console.warn('Thumbnail rendering failed', e);
        }
    } }, 100); }
    updatePreflight() { this.issues = preflight(this.doc, this.textEngine.layouts); const errors = this.issues.filter(i => i.severity === 'error').length; $('#preflight-dot').className = 'status-dot' + (errors ? ' error' : this.issues.length ? ' warning' : ''); $('#preflight-label').textContent = this.issues.length ? `${errors ? errors + ' error' + (errors > 1 ? 's' : '') : this.issues.length + ' warning' + (this.issues.length > 1 ? 's' : '')} · Preflight` : 'No errors · Ready to create'; }
    startEditing(n) { this.stopEditing(true); this.select([n.id]); const p = this.placements().find(p => p.id === n.pageId); if (!p)
        return; const point = this.camera.toScreen(p.x + n.x, p.y + n.y), s = n.style, shell = document.createElement('div'); shell.className = 'story-edit-shell'; const zoom = this.camera.zoom; shell.style.cssText = `left:${point.x}px;top:${point.y}px;width:${n.w * zoom}px;height:${n.h * zoom}px;transform:rotate(${n.rotation}deg);transform-origin:50% 50%;`; const textarea = document.createElement('textarea'); textarea.spellcheck = true; textarea.setAttribute('aria-label', 'Edit story text'); textarea.value = this.doc.stories[n.storyId].text; textarea.style.cssText = `font:${fontString({ ...s, fontSize: s.fontSize * zoom })};line-height:${s.leading};letter-spacing:${s.tracking * zoom}px;padding:${s.inset * zoom}px;color:${s.color};background:#faf7ed;`; const caption = document.createElement('div'); caption.className = 'edit-caption'; caption.textContent = 'EDITING STORY · Ctrl / ⌘ Enter to apply · Esc to cancel'; shell.append(textarea, caption); $('#edit-container').append(shell); this.editing = { nodeId: n.id, storyId: n.storyId, shell, textarea, before: textarea.value }; textarea.focus(); textarea.select(); textarea.addEventListener('keydown', e => { if (e.isComposing)
        return; if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.stopEditing(false);
    }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        this.stopEditing(true);
    } }); }
    stopEditing(commit) { if (!this.editing)
        return; const { storyId, shell, textarea, before } = this.editing; this.editing = null; const text = textarea.value; shell.remove(); if (commit && text !== before && this.doc.stories[storyId])
        this.store.transact('Edit story', d => d.stories[storyId].text = text); this.overlay.focus(); this.invalidate(); }
    async placeFiles(files) { if (!files.length)
        return; try {
        const imported = [];
        for (const f of files) {
            if (/\.(folio|json)$/i.test(f.name)) {
                this.store.replace(await openDocument(f));
                this.goPage(0);
                return;
            }
            imported.push(await readImageFile(f));
        }
        const selected = this.primary;
        const newIds = [];
        this.store.transact('Place images', d => { imported.forEach((a, i) => { const id = uid('asset'); d.assets[id] = a; let n = i === 0 && selected?.type === 'image' ? selected : null; if (!n) {
            const w = Math.min(300, d.settings.width - 84), h = Math.min(350, w * a.height / a.width);
            n = makeNode('image', this.activePage.id, { name: a.name, x: (this.dropLocation?.x || 48) + i * 18, y: (this.dropLocation?.y || 90) + i * 18, w, h, assetId: id, fit: 'cover', layerId: d.layers[0].id });
            d.nodes.push(n);
        } n.assetId = id; n.name = a.name; newIds.push(n.id); }); });
        this.dropLocation = null;
        this.select(newIds);
        this.toast(`${files.length === 1 ? 'Image' : 'Images'} placed and embedded.`);
    }
    catch (error) {
        this.toast(error.message);
    } }
    async run(command) { this.closeMenu(); if (this.drag)
        return; try {
        if (command !== 'editText')
            this.stopEditing(true);
        await this.execute(command);
    }
    catch (e) {
        console.error(e);
        this.toast(e.message || 'The operation could not be completed.');
    } }
    async execute(command) {
        const ids = [...this.selection], n = this.primary;
        switch (command) {
            case 'undo':
                this.store.undo();
                return;
            case 'redo':
                this.store.redo();
                return;
            case 'save':
                await saveDocument(this.doc);
                this.toast('Portable .folio publication saved with embedded images.');
                return;
            case 'open':
                $('#file-open').click();
                return;
            case 'new':
                this.newDialog();
                return;
            case 'documentSetup':
                this.documentSetupDialog();
                return;
            case 'rename':
                this.inputDialog('Rename publication', 'Publication name', this.doc.name, value => this.store.transact('Rename publication', d => d.name = value.trim() || 'Untitled publication'));
                return;
            case 'export':
                this.exportDialog();
                return;
            case 'print':
                this.toast('Preparing pages for print…');
                await printDocument(this.doc, this.renderer, (i, total) => this.toast(`Preparing page ${i} of ${total}…`));
                this.toast('Use the browser print dialog to save a PDF.');
                return;
            case 'placeImage':
                $('#image-open').click();
                return;
            case 'delete':
                if (ids.length)
                    this.store.deleteNodes(ids);
                return;
            case 'duplicate':
                if (ids.length)
                    this.select(this.store.duplicateNodes(ids));
                return;
            case 'copy':
            case 'cut':
                if (ids.length) {
                    this.clipboard = { nodes: this.selected.map(clone), stories: clone(this.doc.stories), assets: clone(this.doc.assets) };
                    this.toast(`${ids.length} object${ids.length > 1 ? 's' : ''} copied.`);
                    if (command === 'cut')
                        this.store.deleteNodes(ids);
                }
                return;
            case 'paste':
                this.paste();
                return;
            case 'selectAll':
                this.select(this.placements().flatMap(p => this.store.nodesOnPage(p.id).filter(n => this.store.selectable(n)).map(n => n.id)));
                return;
            case 'addPage':
                this.store.transact('Add page', d => { d.pages.splice(this.activePageIndex + 1, 0, { id: uid('page'), name: 'Page', background: '#f4f1e8', master: 'A' }); });
                this.goPage(this.activePageIndex + 1);
                return;
            case 'duplicatePage':
                this.duplicatePage();
                return;
            case 'deletePage':
                if (this.doc.pages.length === 1) {
                    this.toast('A publication needs at least one page.');
                    return;
                }
                this.confirm('Delete this page?', `Page ${this.activePageIndex + 1} and its objects will be removed. You can undo this action.`, () => { const id = this.activePage.id; this.store.transact('Delete page', d => { const removed = new Set(d.nodes.filter(n => n.pageId === id).map(n => n.id)); for (const n of d.nodes)
                    if (removed.has(n.nextId))
                        n.nextId = null; d.nodes = d.nodes.filter(n => n.pageId !== id); d.pages = d.pages.filter(p => p.id !== id); }); this.goPage(this.activePageIndex); });
                return;
            case 'goToPage':
                this.inputDialog('Go to page', 'Page number', String(this.activePageIndex + 1), value => this.goPage(clamp(Number(value) || 1, 1, this.doc.pages.length) - 1), 'number');
                return;
            case 'nextSpread':
            case 'previousSpread': {
                const spreads = this.spreads(), index = spreads.findIndex(s => s.some(p => p.id === this.activePage.id)), next = spreads[clamp(index + (command === 'nextSpread' ? 1 : -1), 0, spreads.length - 1)];
                this.goPage(this.doc.pages.findIndex(p => p.id === next[0].id));
                return;
            }
            case 'fit':
                this.fit();
                return;
            case 'zoomIn':
            case 'zoomOut':
                this.camera.zoomAt(this.width / 2, this.height / 2, command === 'zoomIn' ? 1.2 : 1 / 1.2);
                this.invalidate();
                return;
            case 'actualSize':
                this.camera.zoomAt(this.width / 2, this.height / 2, 1 / this.camera.zoom);
                this.invalidate();
                return;
            case 'zoomPercent':
                this.inputDialog('Zoom level', 'Scale in percent', String(Math.round(this.camera.zoom * 100)), value => { const z = clamp(Number(value) || 100, 8, 800) / 100; this.camera.zoomAt(this.width / 2, this.height / 2, z / this.camera.zoom); this.invalidate(); }, 'number');
                return;
            case 'guides':
                this.guides = !this.guides;
                break;
            case 'grid':
                this.grid = !this.grid;
                break;
            case 'frames':
                this.frameEdges = !this.frameEdges;
                break;
            case 'snap':
                this.snapping = !this.snapping;
                this.toast(`Smart snapping ${this.snapping ? 'enabled' : 'disabled'}.`);
                break;
            case 'preview':
                this.preview = !this.preview;
                document.body.classList.toggle('preview', this.preview);
                $$('[data-command="preview"]').forEach(b => b.classList.toggle('active', this.preview));
                break;
            case 'facing':
                this.changeSetting('facing', !this.doc.settings.facing);
                return;
            case 'parent':
                this.store.transact('Toggle parent rule', d => d.masters.A.enabled = !d.masters.A.enabled);
                this.toast(this.doc.masters.A.enabled ? 'Parent rule applied to A-based pages.' : 'Parent rule hidden.');
                return;
            case 'bold':
                this.changeStyle({ fontWeight: n?.style?.fontWeight === '700' ? '400' : '700' });
                return;
            case 'italic':
                this.changeStyle({ italic: !n?.style?.italic });
                return;
            case 'group':
                if (ids.length < 2) {
                    this.toast('Select two or more objects to group.');
                    return;
                }
                this.store.transact('Group objects', () => { const groupId = uid('group'); for (const n of this.selected)
                    n.groupId = groupId; });
                return;
            case 'ungroup':
                this.store.transact('Ungroup objects', () => { const groups = new Set(this.selected.map(n => n.groupId)); for (const n of this.doc.nodes)
                    if (groups.has(n.groupId))
                        delete n.groupId; });
                return;
            case 'bringFront':
            case 'sendBack':
                if (ids.length)
                    this.store.transact('Arrange objects', d => { const selected = d.nodes.filter(n => this.selection.has(n.id)), other = d.nodes.filter(n => !this.selection.has(n.id)); d.nodes = command === 'bringFront' ? [...other, ...selected] : [...selected, ...other]; });
                return;
            case 'lock':
                if (ids.length) {
                    this.changeProperty('locked', true);
                    this.select([]);
                    this.toast('Objects locked. Use Object → Unlock all to release.');
                }
                return;
            case 'unlockAll':
                this.store.transact('Unlock objects', d => { for (const n of d.nodes)
                    if (this.placements().some(p => p.id === n.pageId))
                        n.locked = false; for (const l of d.layers)
                    l.locked = false; });
                return;
            case 'fitImage':
                this.changeProperty('fit', 'cover');
                return;
            case 'containImage':
                this.changeProperty('fit', 'contain');
                return;
            case 'clear-fill':
                this.setColor('none', 'fill');
                return;
            case 'clear-stroke':
                this.setColor('none', 'stroke');
                return;
            case 'alignLeft':
            case 'alignCenter':
            case 'alignRight':
            case 'alignTop':
            case 'alignBottom':
                this.alignObjects(command);
                return;
            case 'thread':
                if (this.selected.length !== 2 || this.selected.some(n => n.type !== 'text')) {
                    this.toast('Select two text frames, then choose Type → Thread selected frames.');
                    return;
                }
                this.store.linkFrames(ids[0], ids[1]);
                this.toast('Text frames linked. The story now flows between them.');
                return;
            case 'unlink':
                if (n?.type === 'text')
                    this.unlinkFrame(n);
                return;
            case 'editText':
                this.storyDialog();
                return;
            case 'find':
                this.findDialog();
                return;
            case 'pagesPanel':
                document.body.classList.toggle('hide-pages');
                return;
            case 'propertiesPanel':
                document.body.classList.toggle('hide-inspector');
                return;
            case 'preflight':
                this.preflightDialog();
                return;
            case 'shortcuts':
                this.shortcutsDialog();
                return;
            case 'about':
                this.aboutDialog();
                return;
            case 'diagnostics':
                this.diagnosticsDialog();
                return;
            default:
                this.toast('Choose a tool or select an object to continue.');
                return;
        }
        this.renderInspector();
        this.invalidate();
    }
    paste() { if (!this.clipboard) {
        this.toast('Copy objects in FolioForge first.');
        return;
    } const copies = [], nodeMap = new Map(this.clipboard.nodes.map(n => [n.id, uid()])), storyMap = new Map(), groupMap = new Map(); this.store.transact('Paste objects', d => { Object.assign(d.assets, clone(this.clipboard.assets)); for (const original of this.clipboard.nodes) {
        const c = clone(original);
        c.id = nodeMap.get(original.id);
        c.pageId = this.activePage.id;
        c.x += 15;
        c.y += 15;
        c.locked = false;
        if (!d.layers.some(l => l.id === c.layerId))
            c.layerId = d.layers[0].id;
        if (c.storyId) {
            if (!storyMap.has(c.storyId)) {
                const sid = uid('story');
                storyMap.set(c.storyId, sid);
                d.stories[sid] = clone(this.clipboard.stories[c.storyId]);
            }
            c.storyId = storyMap.get(c.storyId);
        }
        c.nextId = nodeMap.get(c.nextId) || null;
        if (c.groupId) {
            if (!groupMap.has(c.groupId))
                groupMap.set(c.groupId, uid('group'));
            c.groupId = groupMap.get(c.groupId);
        }
        d.nodes.push(c);
        copies.push(c.id);
    } }); this.select(copies); }
    duplicatePage() { const page = this.activePage, index = this.activePageIndex, pageId = uid('page'), nodes = this.doc.nodes.filter(n => n.pageId === page.id), nodeMap = new Map(nodes.map(n => [n.id, uid()])), storyMap = new Map(); this.store.transact('Duplicate page', d => { d.pages.splice(index + 1, 0, { ...clone(page), id: pageId }); for (const n of nodes) {
        const c = clone(n);
        c.id = nodeMap.get(n.id);
        c.pageId = pageId;
        c.nextId = nodeMap.get(c.nextId) || null;
        if (c.storyId) {
            if (!storyMap.has(c.storyId)) {
                const sid = uid('story');
                storyMap.set(c.storyId, sid);
                d.stories[sid] = clone(d.stories[c.storyId]);
            }
            c.storyId = storyMap.get(c.storyId);
        }
        if (c.groupId)
            c.groupId = pageId + c.groupId;
        d.nodes.push(c);
    } }); this.goPage(index + 1); }
    unlinkFrame(n) { const target = this.store.getNode(n.nextId); if (!target) {
        this.toast('Select the source frame of a linked story.');
        return;
    } const split = this.textEngine.layouts.get(n.id)?.end || 0; this.store.transact('Unlink story', d => { const original = d.stories[n.storyId], sid = uid('story'); d.stories[sid] = { text: original.text.slice(split) }; original.text = original.text.slice(0, split); let c = target; while (c) {
        c.storyId = sid;
        c = this.store.getNode(c.nextId);
    } n.nextId = null; }); }
    alignObjects(command) { const nodes = this.selected; if (!nodes.length)
        return; const page = this.doc.settings; const box = nodes.length === 1 ? { x: page.margin, y: page.margin, w: page.width - page.margin * 2, h: page.height - page.margin * 2 } : { x: Math.min(...nodes.map(n => n.x)), y: Math.min(...nodes.map(n => n.y)), w: Math.max(...nodes.map(n => n.x + n.w)) - Math.min(...nodes.map(n => n.x)), h: Math.max(...nodes.map(n => n.y + n.h)) - Math.min(...nodes.map(n => n.y)) }; this.store.transact('Align objects', () => { for (const n of nodes) {
        if (command === 'alignLeft')
            n.x = box.x;
        if (command === 'alignCenter')
            n.x = box.x + (box.w - n.w) / 2;
        if (command === 'alignRight')
            n.x = box.x + box.w - n.w;
        if (command === 'alignTop')
            n.y = box.y;
        if (command === 'alignBottom')
            n.y = box.y + box.h - n.h;
    } }); }
    showMenu(name, anchor) { if (this.openMenu === name) {
        this.closeMenu();
        return;
    } this.closeMenu(); this.openMenu = name; anchor.classList.add('open'); const r = anchor.getBoundingClientRect(); this.drawMenu(MENU[name], r.left, r.bottom + 2); }
    drawMenu(items, x, y) { const root = $('#menu-popover'); root.innerHTML = items.map(i => i ? `<button class="menu-item" data-command="${i[0]}">${i[3] ? icon(i[3], 15) : '<span style="width:15px"></span>'}${i[1]}<kbd>${i[2] || ''}</kbd></button>` : '<div class="menu-separator"></div>').join(''); root.hidden = false; root.style.left = Math.min(x, innerWidth - 260) + 'px'; root.style.top = Math.min(y, innerHeight - root.offsetHeight - 10) + 'px'; }
    showContextMenu(x, y) { this.closeMenu(); this.drawMenu([['editText', 'Edit story…', '', 'text'], ['placeImage', 'Place image…', '', 'image'], null, ['copy', 'Copy', '⌘ C'], ['paste', 'Paste', '⌘ V'], ['duplicate', 'Duplicate', '⌘ J'], null, ['bringFront', 'Bring to front', '', 'front'], ['sendBack', 'Send to back', '', 'back'], ['thread', 'Thread selected frames', '', 'thread'], null, ['delete', 'Delete', '⌫', 'trash']], x, y); }
    closeMenu() { this.openMenu = null; $('#menu-popover').hidden = true; $$('[data-menu]').forEach(e => e.classList.remove('open')); }
    keyDown(e) {
        if (e.isComposing)
            return;
        const target = e.target, isInput = target.matches('input,textarea,select,[contenteditable]');
        if (isInput || $('#modal').open)
            return;
        const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
        if (this.drag && key !== 'escape')
            return;
        if (mod) {
            const commands = { z: e.shiftKey ? 'redo' : 'undo', y: 'editText', s: 'save', o: 'open', n: 'new', d: 'placeImage', e: 'export', a: 'selectAll', c: 'copy', x: 'cut', v: 'paste', j: 'duplicate', f: 'find', b: 'bold', i: 'italic', g: e.shiftKey ? 'ungroup' : 'group', l: 'lock', '0': 'fit', '1': 'actualSize', ';': 'guides' };
            if (commands[key]) {
                e.preventDefault();
                this.run(commands[key]);
                return;
            }
        }
        if (e.code === 'Space') {
            e.preventDefault();
            this.spaceDown = true;
            this.updateCursor();
            return;
        }
        if (key === 'escape') {
            e.preventDefault();
            this.closeMenu();
            if (this.drag) {
                this.store.cancel();
                this.drag = null;
            }
            this.select([]);
            this.setTool('select');
            return;
        }
        if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) && this.selection.size) {
            e.preventDefault();
            this.store.transact('Nudge objects', () => { for (const n of this.selected) {
                const delta = e.shiftKey ? 10 : 1;
                if (key === 'arrowleft')
                    n.x -= delta;
                if (key === 'arrowright')
                    n.x += delta;
                if (key === 'arrowup')
                    n.y -= delta;
                if (key === 'arrowdown')
                    n.y += delta;
            } });
            return;
        }
        if (key === 'delete' || key === 'backspace') {
            e.preventDefault();
            this.run('delete');
            return;
        }
        const shortcuts = { v: 'select', a: 'direct', t: 'text', f: 'image', r: 'rect', e: 'ellipse', l: 'line', h: 'hand', z: 'zoom' };
        if (shortcuts[key]) {
            e.preventDefault();
            this.setTool(shortcuts[key]);
            return;
        }
        const commands = { w: 'preview', '?': 'shortcuts', '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut', '[': 'sendBack', ']': 'bringFront', 'pagedown': 'nextSpread', 'pageup': 'previousSpread' };
        if (commands[key]) {
            e.preventDefault();
            this.run(commands[key]);
        }
    }
    toast(message) { const t = $('#toast'); t.textContent = message; t.classList.add('visible'); clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => t.classList.remove('visible'), 3500); }
    modal(title, body, submitLabel, onSubmit) { const modal = $('#modal'); if (modal.open)
        modal.close(); $('#modal-title').textContent = title; $('#modal-body').innerHTML = body; $('#modal-actions').innerHTML = `<button type="button" id="modal-cancel">${submitLabel ? 'Cancel' : 'Close'}</button>${submitLabel ? `<button type="submit" class="primary">${submitLabel}</button>` : ''}`; $('#modal-cancel').onclick = () => modal.close(); $('#modal-form').onsubmit = async (e) => { e.preventDefault(); try {
        if (onSubmit) {
            const result = await onSubmit(new FormData($('#modal-form')));
            if (result === false)
                return;
        }
        modal.close();
    }
    catch (error) {
        this.toast(error.message);
    } }; modal.showModal(); this.hydrateIcons(modal); }
    inputDialog(title, label, value, callback, type = 'text') { this.modal(title, `<div class="field-grid"><label class="full">${label}<input name="value" id="dialog-value" type="${type}" value="${escapeXML(value)}" required></label></div>`, 'Apply', form => callback(form.get('value'))); $('#dialog-value').focus(); $('#dialog-value').select(); }
    confirm(title, text, callback) { this.modal(title, `<p>${escapeXML(text)}</p>`, 'Delete', callback); }
    newDialog() { this.modal('A new beginning.', `<div class="preset-grid"><button type="button" class="preset-card active" data-preset="a4"><span class="preset-sheet"></span>A4<small>210 × 297 mm</small></button><button type="button" class="preset-card" data-preset="letter"><span class="preset-sheet"></span>US Letter<small>8.5 × 11 in</small></button><button type="button" class="preset-card" data-preset="square"><span class="preset-sheet" style="height:28px"></span>Square<small>210 × 210 mm</small></button></div><div class="field-grid"><label class="full">Publication name<input name="name" value="Untitled publication" required maxlength="160"></label><label>Width (pt)<input name="width" id="new-width" type="number" min="72" max="14400" value="595.276" step=".001" required></label><label>Height (pt)<input name="height" id="new-height" type="number" min="72" max="14400" value="841.89" step=".001" required></label><label>Pages<input name="pages" type="number" min="1" max="1000" value="4" required></label><label>Margins (pt)<input name="margin" type="number" min="0" max="250" value="42" required></label></div><label class="toggle-row"><input type="checkbox" name="facing" checked> Facing pages</label><div class="modal-note">Your new publication opens in this workspace. Save the current publication first to keep a separate copy.</div>`, 'Create publication', form => { const d = createDocument({ name: form.get('name'), width: Number(form.get('width')), height: Number(form.get('height')), pages: Math.round(Number(form.get('pages'))) }); d.settings.margin = Number(form.get('margin')); d.settings.facing = form.has('facing'); this.selection.clear(); this.store.replace(d); this.goPage(0); this.toast('A clean page. A world of possibilities.'); }); $$('[data-preset]').forEach(b => b.onclick = () => { const values = { a4: [595.276, 841.89], letter: [612, 792], square: [595.276, 595.276] }; const [w, h] = values[b.dataset.preset]; $('#new-width').value = w; $('#new-height').value = h; $$('[data-preset]').forEach(b => b.classList.remove('active')); b.classList.add('active'); }); }
    documentSetupDialog() { const s = this.doc.settings; this.modal('Document setup', `<div class="field-grid"><label>Width (pt)<input name="width" type="number" min="72" max="14400" step=".001" value="${s.width}" required></label><label>Height (pt)<input name="height" type="number" min="72" max="14400" step=".001" value="${s.height}" required></label><label>Margins (pt)<input name="margin" type="number" min="0" step=".1" value="${s.margin}" required></label><label>Bleed guide (pt)<input name="bleed" type="number" min="0" max="100" step=".1" value="${s.bleed}" required></label></div><div class="modal-note">Page dimensions change without scaling the artwork. Exports use trim size; bleed is a layout setting, not a print-production export guarantee.</div>`, 'Apply settings', f => { this.store.transact('Document setup', d => { for (const k of ['width', 'height', 'margin', 'bleed'])
        d.settings[k] = Number(f.get(k)); }); this.fit(); }); }
    exportDialog() { this.modal('Send it into the world.', `<p>Export page ${this.activePageIndex + 1}, or print the complete publication.</p><div class="field-grid"><label class="full">Format<select name="format" id="export-format"><option value="png">PNG — current page, high resolution</option><option value="svg">SVG — current page, editable vectors and text</option><option value="folio">FolioForge — complete, portable publication</option><option value="print">Print / Save as PDF — all pages</option></select></label><label class="full">PNG resolution<select name="scale"><option value="1">72 pixels per inch · 1×</option><option value="2" selected>144 pixels per inch · 2×</option><option value="3">216 pixels per inch · 3×</option></select></label></div><div class="modal-note">SVG preserves layout objects and positioned text; fonts must be available on the receiving system. Browser PDF output uses rasterized pages and is not PDF/X or CMYK.</div>`, 'Export publication', async (f) => { const format = f.get('format'); if (format === 'folio') {
        await saveDocument(this.doc);
    }
    else if (format === 'svg') {
        downloadBlob(await exportSVG(this.doc, this.activePage, this.textEngine), `${safeName(this.doc.name)}-${this.activePageIndex + 1}.svg`);
    }
    else if (format === 'print') {
        this.toast('Preparing publication…');
        await printDocument(this.doc, this.renderer);
    }
    else {
        const scale = Number(f.get('scale'));
        if (this.doc.settings.width * this.doc.settings.height * scale * scale > 100000000)
            throw Error('Export exceeds 100 megapixels. Choose a lower scale or smaller page.');
        const canvas = await this.renderer.pageCanvas(this.doc, this.activePage, scale);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob)
            throw Error('The browser could not encode the page.');
        downloadBlob(blob, `${safeName(this.doc.name)}-${this.activePageIndex + 1}.png`);
    } this.toast('Export ready.'); }); }
    storyDialog() { const n = this.primary; if (n?.type !== 'text') {
        this.toast('Select a text frame first.');
        return;
    } const story = this.doc.stories[n.storyId]; this.modal('Story editor', `<p>Edit the complete story. Linked frames reflow after applying changes.</p><textarea class="story-modal-text" name="text" aria-label="Story text">${escapeXML(story.text)}</textarea>`, 'Apply story', f => this.store.transact('Edit story', d => d.stories[n.storyId].text = f.get('text'))); }
    findDialog() { this.modal('Find & replace', `<div class="field-grid"><label class="full">Find<input name="find" required></label><label class="full">Replace with<input name="replacement"></label></div><label class="toggle-row"><input type="checkbox" name="case" checked> Match case</label><div class="modal-note">Replaces text in every story in the document, including linked frames. The entire operation is one undo step.</div>`, 'Replace all', f => { const query = f.get('find'), replacement = f.get('replacement'); if (!query)
        return false; let count = 0; const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), f.has('case') ? 'g' : 'gi'); this.store.transact('Find and replace', d => { const used = new Set(d.nodes.filter(n => n.type === 'text').map(n => n.storyId)); for (const id of used) {
        const story = d.stories[id];
        story.text = story.text.replace(re, () => { count++; return replacement; });
    } }); this.toast(`${count} replacement${count === 1 ? '' : 's'} made.`); }); }
    preflightDialog() { this.updatePreflight(); this.modal('Document preflight', this.issues.length ? `<p>${this.issues.length} item${this.issues.length === 1 ? '' : 's'} to review.</p>` + this.issues.map((i, index) => `<button type="button" class="issue-row" data-issue="${index}"><span class="status-dot ${i.severity === 'error' ? 'error' : 'warning'}"></span><span>${escapeXML(i.message)}</span></button>`).join('') : `<p>No overset stories, missing image references, low-resolution placements, or completely off-page objects were detected.</p><div class="modal-note">This is an RGB layout check. It does not validate print color profiles, PDF/X compliance, font embedding, transparency flattening, or accessibility tagging.</div>`, null); $$('[data-issue]').forEach(e => e.onclick = () => { const issue = this.issues[Number(e.dataset.issue)], n = this.store.getNode(issue.id); $('#modal').close(); this.goPage(this.doc.pages.findIndex(p => p.id === n.pageId)); this.select([n.id]); }); }
    shortcutsDialog() { const rows = [['Selection / Direct selection', 'V / A'], ['Text / Image frame', 'T / F'], ['Rectangle / Ellipse / Line', 'R / E / L'], ['Pan / Zoom', 'H or Space / Z'], ['Fit spread / Actual size', 'Ctrl or ⌘ 0 / 1'], ['Zoom to pointer', 'Ctrl or ⌘ + wheel'], ['Edit text', 'Double-click a text frame'], ['Commit / Cancel text edit', 'Ctrl or ⌘ Enter / Esc'], ['Select multiple objects', 'Shift-click / drag marquee'], ['Constrain move / resize / angle', 'Hold Shift while dragging'], ['Duplicate while dragging', 'Hold Alt at pointer-down'], ['Undo / Redo', 'Ctrl or ⌘ Z / Shift Z'], ['Save / Open', 'Ctrl or ⌘ S / O'], ['Duplicate selection', 'Ctrl or ⌘ J'], ['Nudge / Large nudge', 'Arrow / Shift + Arrow'], ['Preview / Guides', 'W / Ctrl or ⌘ ;'], ['Thread text frames', 'Select two → Type → Thread'], ['Previous / Next spread', 'Page Up / Page Down']]; this.modal('A little muscle memory.', `<div class="shortcut-list">${rows.map(r => `<span>${r[0]}</span><kbd>${r[1]}</kbd>`).join('')}</div>`, null); }
    aboutDialog() { this.modal('FolioForge', `<p style="font:italic 27px/1.4 Georgia;color:#e5b6a0">A considered space<br>for extraordinary publications.</p><p>An independent, zero-runtime-dependency editorial layout editor. Real document objects, editable text, linked stories, retained WebGPU composition, and local-first files.</p><div class="modal-note">Version 0.1.0 · Original editorial artwork included.<br>Inspired by desktop publishing workflows; not affiliated with Adobe. This version does not read INDD or IDML, implement advanced OpenType typesetting, or provide a press-certified CMYK/PDF/X pipeline.</div>`, null); }
    diagnosticsDialog() { const r = this.renderer; this.modal('Renderer diagnostics', `<div class="shortcut-list"><span>Active backend</span><kbd>${escapeXML(this.backend || 'Initializing')}</kbd><span>Canvas size</span><kbd>${r.canvas.width} × ${r.canvas.height}</kbd><span>Device pixel ratio</span><kbd>${r.dpr}</kbd><span>Scene objects</span><kbd>${r.stats.objects}</kbd><span>Last submitted draw calls</span><kbd>${r.stats.drawCalls}</kbd><span>Last CPU build + submit</span><kbd>${r.stats.frameMs.toFixed(2)} ms</kbd><span>Retained GPU textures</span><kbd>${r.gpuTextures.size}</kbd><span>CPU text raster cache</span><kbd>${(r.resources.bytes / 1048576).toFixed(1)} MiB</kbd><span>History transactions</span><kbd>${this.store.undoStack.length}</kbd></div><div class="modal-note">Rendering is invalidation-driven; there is no idle render loop. Timings above are CPU measurements, not GPU timestamps or a sustained-FPS benchmark.${this.backendReason ? '<br>Fallback: ' + escapeXML(this.backendReason) : ''}</div>`, null); }
}
window.FolioForgeAPI = Object.freeze({ createDocument, createDemo, DocumentStore, TextEngine, Camera, SpatialIndex, exportSVG, openDocument, saveDocument, readImageFile });
window.folioforge = new FolioForge();
