/** FolioForge document kernel. All geometry is in PostScript points (72 / inch). */
export const VERSION = 1;
export const PT_PER_MM = 72 / 25.4;
export const uid = (prefix = 'n') => `${prefix}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
export const clone = value => structuredClone(value);
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const escapeXML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export const color = (hex, alpha = 1) => { if (!hex || hex === 'none')
    return [0, 0, 0, 0]; const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, alpha]; };
export const radians = degrees => degrees * Math.PI / 180;
export function localPoint(node, x, y) { const c = Math.cos(radians(node.rotation || 0)), s = Math.sin(radians(node.rotation || 0)); const dx = x - node.x - node.w / 2, dy = y - node.y - node.h / 2; return { x: c * dx + s * dy + node.w / 2, y: -s * dx + c * dy + node.h / 2 }; }
export function worldPoint(node, x, y) { const c = Math.cos(radians(node.rotation || 0)), s = Math.sin(radians(node.rotation || 0)); const dx = x - node.w / 2, dy = y - node.h / 2; return { x: node.x + node.w / 2 + c * dx - s * dy, y: node.y + node.h / 2 + s * dx + c * dy }; }
export function bounds(node) { const p = [worldPoint(node, 0, 0), worldPoint(node, node.w, 0), worldPoint(node, 0, node.h), worldPoint(node, node.w, node.h)]; const x = Math.min(...p.map(v => v.x)), y = Math.min(...p.map(v => v.y)); return { x, y, w: Math.max(...p.map(v => v.x)) - x, h: Math.max(...p.map(v => v.y)) - y }; }
export function intersects(a, b) { return a.x + a.w >= b.x && b.x + b.w >= a.x && a.y + a.h >= b.y && b.y + b.h >= a.y; }
export function hitNode(node, x, y, tolerance = 0) { const p = localPoint(node, x, y); if (node.type === 'ellipse')
    return ((p.x - node.w / 2) / (node.w / 2 + tolerance)) ** 2 + ((p.y - node.h / 2) / (node.h / 2 + tolerance)) ** 2 <= 1; return p.x >= -tolerance && p.y >= -tolerance && p.x <= node.w + tolerance && p.y <= node.h + tolerance; }
export function makeNode(type, pageId, values = {}) { return { id: uid(), type, pageId, layerId: 'content', name: { text: 'Text frame', image: 'Image frame', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Rule' }[type] || type, x: 60, y: 60, w: 180, h: 120, rotation: 0, opacity: 1, fill: type === 'text' ? 'none' : '#b5bba3', stroke: 'none', strokeWidth: 1, locked: false, hidden: false, ...values }; }
export const defaultTextStyle = { fontFamily: 'Georgia', fontSize: 12, fontWeight: '400', italic: false, leading: 1.5, tracking: 0, align: 'left', color: '#30362e', columns: 1, gutter: 20, inset: 0, paragraphSpace: 7 };
export const paragraphStyles = [
    { id: 'body', name: 'Body / Editorial', ...defaultTextStyle },
    { id: 'display', name: 'Display / Serif', ...defaultTextStyle, fontSize: 68, leading: 1.04, tracking: -2, paragraphSpace: 0 },
    { id: 'heading', name: 'Heading / Section', ...defaultTextStyle, fontFamily: 'Arial', fontSize: 24, fontWeight: '700', leading: 1.2 },
    { id: 'caption', name: 'Caption / Small', ...defaultTextStyle, fontFamily: 'Arial', fontSize: 9, leading: 1.4, color: '#77786c' },
    { id: 'eyebrow', name: 'Label / Uppercase', ...defaultTextStyle, fontFamily: 'Arial', fontSize: 9, fontWeight: '700', tracking: 2, leading: 1.4 },
];
export function createDocument({ name = 'Untitled publication', width = 595.276, height = 841.89, pages = 4 } = {}) { return { format: 'folioforge', version: VERSION, id: uid('doc'), name, settings: { width, height, margin: 42, bleed: 8.5, facing: true }, pages: Array.from({ length: pages }, (_, i) => ({ id: uid('page'), name: String(i + 1), background: '#ffffff', master: i ? 'A' : 'none' })), layers: [{ id: 'content', name: 'Artwork', visible: true, locked: false, color: '#7b9cf3' }, { id: 'type', name: 'Typography', visible: true, locked: false, color: '#c68af2' }, { id: 'guides', name: 'Details', visible: true, locked: false, color: '#dfb279' }], nodes: [], stories: {}, assets: {}, styles: clone(paragraphStyles), masters: { A: { name: 'A — Editorial', enabled: false } } }; }
export function validateDocument(input) {
    const validId = id => typeof id === 'string' && /^[a-z0-9_-]{1,120}$/i.test(id);
    const validColor = value => typeof value === 'string' && /^(#[a-f0-9]{6}|none)$/i.test(value);
    const fonts = new Set(['Georgia', 'Arial', 'Times New Roman', 'Verdana', 'Courier New']);
    if (!input || input.format !== 'folioforge' || input.version !== VERSION)
        throw Error('This is not a supported FolioForge document.');
    if (!input.settings || !Number.isFinite(input.settings.width) || input.settings.width < 72 || input.settings.width > 14400 || !Number.isFinite(input.settings.height) || input.settings.height < 72 || input.settings.height > 14400)
        throw Error('Page dimensions must be between 72 and 14,400 points.');
    if (!Array.isArray(input.pages) || !input.pages.length || input.pages.length > 1000)
        throw Error('A document must have 1–1,000 pages.');
    if (!Array.isArray(input.layers) || !input.layers.length || !Array.isArray(input.nodes) || input.nodes.length > 50000)
        throw Error('Invalid layer or object collection.');
    if (!input.stories || !input.assets || !Array.isArray(input.styles) || input.styles.length > 256)
        throw Error('Missing document resources.');
    if (typeof input.name !== 'string' || input.name.length > 1000)
        throw Error('Invalid publication name.');
    for (const k of ['margin', 'bleed'])
        if (!Number.isFinite(input.settings[k]) || input.settings[k] < 0 || input.settings[k] > 7200)
            throw Error('Invalid page guide settings.');
    if (input.settings.margin >= Math.min(input.settings.width, input.settings.height) / 2)
        throw Error('Margins must leave a positive page content area.');
    for (const p of input.pages)
        if (!validId(p.id) || !validColor(p.background) || p.background === 'none')
            throw Error('Invalid page attributes.');
    for (const l of input.layers)
        if (!validId(l.id) || typeof l.name !== 'string' || !validColor(l.color) || l.color === 'none')
            throw Error('Invalid layer attributes.');
    for (const style of input.styles)
        if (!validId(style.id) || typeof style.name !== 'string')
            throw Error('Invalid paragraph style.');
    for (const [id, story] of Object.entries(input.stories))
        if (!validId(id) || typeof story?.text !== 'string' || story.text.length > 5000000)
            throw Error('Invalid or oversized text story.');
    for (const [id, asset] of Object.entries(input.assets))
        if (!validId(id) || typeof asset.name !== 'string')
            throw Error('Invalid image resource.');
    const pageIds = new Set(input.pages.map(p => p.id)), layerIds = new Set(input.layers.map(l => l.id)), ids = new Set();
    if (pageIds.size !== input.pages.length || layerIds.size !== input.layers.length)
        throw Error('Duplicate page or layer IDs.');
    for (const n of input.nodes) {
        if (ids.has(n.id) || !validId(n.id))
            throw Error('Duplicate or invalid object ID.');
        ids.add(n.id);
        if (!['text', 'image', 'rect', 'ellipse', 'line'].includes(n.type) || !pageIds.has(n.pageId) || !layerIds.has(n.layerId))
            throw Error('Invalid object reference.');
        for (const k of ['x', 'y', 'w', 'h', 'rotation', 'opacity'])
            if (!Number.isFinite(n[k]))
                throw Error(`Invalid ${k} on ${n.id}.`);
        if (n.w <= 0 || n.h <= 0 || Math.abs(n.x) > 100000 || Math.abs(n.y) > 100000 || n.w > 20000 || n.h > 20000)
            throw Error('Invalid object dimensions.');
        if (n.type === 'text' && (!input.stories[n.storyId] || typeof input.stories[n.storyId].text !== 'string'))
            throw Error('Missing text story.');
        if (n.opacity < 0 || n.opacity > 1 || !validColor(n.fill) || !validColor(n.stroke) || !Number.isFinite(n.strokeWidth) || n.strokeWidth < 0 || n.strokeWidth > 1000)
            throw Error('Invalid object appearance.');
        if (n.type === 'text' && !n.style)
            throw Error('Text frames require a style.');
        if (n.type === 'text' && n.style) {
            if (!fonts.has(n.style.fontFamily) || !['400', '700'].includes(n.style.fontWeight) || !['left', 'center', 'right', 'justify'].includes(n.style.align) || !validColor(n.style.color) || n.style.color === 'none')
                throw Error('Invalid text style.');
            for (const k of ['fontSize', 'leading', 'columns', 'gutter', 'inset', 'tracking', 'paragraphSpace'])
                if (!Number.isFinite(n.style[k]))
                    throw Error('Invalid text metrics.');
            if (n.style.fontSize < 1 || n.style.fontSize > 1000 || n.style.leading < 0.5 || n.style.leading > 10 || n.style.columns < 1 || n.style.columns > 12 || n.style.inset < 0 || n.style.gutter < 0 || n.style.paragraphSpace < 0 || n.style.tracking < -20 || n.style.tracking > 100)
                throw Error('Text metrics are outside supported limits.');
        }
    }
    const predecessors = new Set(), byId = new Map(input.nodes.map(n => [n.id, n]));
    for (const n of input.nodes) {
        if (!n.nextId)
            continue;
        const t = byId.get(n.nextId);
        if (!t || n.type !== 'text' || t.type !== 'text' || t.storyId !== n.storyId || predecessors.has(t.id))
            throw Error('Invalid text thread.');
        predecessors.add(t.id);
        const visited = new Set([n.id]);
        let cursor = t;
        while (cursor) {
            if (visited.has(cursor.id))
                throw Error('Cyclic text thread.');
            visited.add(cursor.id);
            cursor = byId.get(cursor.nextId);
        }
    }
    for (const asset of Object.values(input.assets)) {
        if (typeof asset.src !== 'string' || (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(asset.src) && !/^\.\/assets\/[a-z0-9_.-]+\.(svg|png|jpg|jpeg|webp)$/i.test(asset.src)))
            throw Error('Only embedded raster images and bundled artwork are accepted.');
    }
    return input;
}
/** A transaction records one user gesture, not individual pointer events. */
export class DocumentStore extends EventTarget {
    constructor(doc) { super(); this.doc = validateDocument(doc); this.undoStack = []; this.redoStack = []; this.pending = null; this.revision = 0; this.maxHistoryBytes = 32 * 1024 * 1024; }
    notify(reason = 'change') { this.revision++; this.dispatchEvent(new CustomEvent('change', { detail: { reason, revision: this.revision } })); }
    begin(label) { if (this.pending)
        throw Error('Nested transactions are not supported.'); this.pending = { label, before: JSON.stringify(this.doc) }; }
    commit() { if (!this.pending)
        return false; const p = this.pending; this.pending = null; try {
        validateDocument(this.doc);
    }
    catch (e) {
        this.doc = JSON.parse(p.before);
        this.notify('rollback');
        throw e;
    } const after = JSON.stringify(this.doc); if (after === p.before)
        return false; this.undoStack.push({ ...p, after }); this.redoStack = []; let bytes = this.undoStack.reduce((n, h) => n + 2 * (h.before.length + h.after.length), 0); while (this.undoStack.length > 1 && (this.undoStack.length > 80 || bytes > this.maxHistoryBytes)) {
        const h = this.undoStack.shift();
        bytes -= 2 * (h.before.length + h.after.length);
    } this.notify(p.label); return true; }
    cancel() { if (this.pending) {
        this.doc = JSON.parse(this.pending.before);
        this.pending = null;
        this.notify('cancel');
    } }
    transact(label, fn) { this.begin(label); try {
        fn(this.doc);
        return this.commit();
    }
    catch (e) {
        this.cancel();
        throw e;
    } }
    undo() { if (this.pending)
        this.cancel(); const h = this.undoStack.pop(); if (!h)
        return; this.doc = JSON.parse(h.before); this.redoStack.push(h); this.notify('undo'); }
    redo() { if (this.pending)
        this.cancel(); const h = this.redoStack.pop(); if (!h)
        return; this.doc = JSON.parse(h.after); this.undoStack.push(h); this.notify('redo'); }
    replace(doc) { this.doc = validateDocument(clone(doc)); this.undoStack = []; this.redoStack = []; this.pending = null; this.notify('open'); }
    getNode(id) { return this.doc.nodes.find(n => n.id === id); }
    nodesOnPage(pageId) { return this.doc.layers.flatMap(l => l.visible ? this.doc.nodes.filter(n => n.pageId === pageId && n.layerId === l.id && !n.hidden) : []); }
    selectable(n) { const l = this.doc.layers.find(l => l.id === n.layerId); return !n.locked && !n.hidden && l?.visible && !l?.locked; }
    deleteNodes(ids) { const removed = new Set(ids); this.transact('Delete objects', d => { for (const n of d.nodes)
        if (removed.has(n.nextId))
            n.nextId = null; d.nodes = d.nodes.filter(n => !removed.has(n.id)); }); }
    duplicateNodes(ids, offset = 12) { let result = []; this.transact('Duplicate objects', d => { const map = new Map(ids.map(id => [id, uid()])), storyMap = new Map(); for (const id of ids) {
        const n = this.getNode(id);
        if (!n)
            continue;
        const copy = clone(n);
        copy.id = map.get(id);
        copy.x += offset;
        copy.y += offset;
        copy.name += ' copy';
        if (n.storyId) {
            if (!storyMap.has(n.storyId)) {
                const s = uid('story');
                storyMap.set(n.storyId, s);
                d.stories[s] = clone(d.stories[n.storyId]);
            }
            copy.storyId = storyMap.get(n.storyId);
        }
        copy.nextId = map.get(n.nextId) || null;
        d.nodes.push(copy);
        result.push(copy.id);
    } }); return result; }
    linkFrames(sourceId, targetId) { this.transact('Thread text frames', d => { const a = this.getNode(sourceId), b = this.getNode(targetId); if (!a || !b || a.type !== 'text' || b.type !== 'text' || a.id === b.id)
        throw Error('Select two different text frames.'); if (a.nextId || d.nodes.some(n => n.nextId === b.id) || a.storyId === b.storyId)
        throw Error('Use an unthreaded target and the last frame of a story.'); const source = d.stories[a.storyId], target = d.stories[b.storyId]; if (target.text.trim())
        source.text += '\n' + target.text; const old = b.storyId; for (const n of d.nodes)
        if (n.storyId === old)
            n.storyId = a.storyId; a.nextId = b.id; }); }
}
export class Camera {
    constructor() { this.x = 0; this.y = 0; this.zoom = 1; }
    toScreen(x, y) { return { x: this.x + x * this.zoom, y: this.y + y * this.zoom }; }
    toWorld(x, y) { return { x: (x - this.x) / this.zoom, y: (y - this.y) / this.zoom }; }
    zoomAt(x, y, factor) { const p = this.toWorld(x, y); this.zoom = clamp(this.zoom * factor, .08, 8); this.x = x - p.x * this.zoom; this.y = y - p.y * this.zoom; }
    fit(bounds, width, height, pad = 64) { this.zoom = clamp(Math.min((width - pad * 2) / bounds.w, (height - pad * 2) / bounds.h), .08, 8); this.x = (width - bounds.w * this.zoom) / 2 - bounds.x * this.zoom; this.y = (height - bounds.h * this.zoom) / 2 - bounds.y * this.zoom; }
}
/** Conservative uniform-grid broadphase, followed by inverse-rotated exact hit testing. */
export class SpatialIndex {
    constructor(cellSize = 128) { this.size = cellSize; this.cells = new Map(); }
    rebuild(nodes) { this.cells.clear(); for (const n of nodes) {
        const b = bounds(n);
        const x0 = Math.floor(b.x / this.size), x1 = Math.floor((b.x + b.w) / this.size), y0 = Math.floor(b.y / this.size), y1 = Math.floor((b.y + b.h) / this.size);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 10000) {
            const l = this.cells.get('*') || [];
            l.push(n);
            this.cells.set('*', l);
            continue;
        }
        for (let x = x0; x <= x1; x++)
            for (let y = y0; y <= y1; y++) {
                const k = `${n.pageId}:${x}:${y}`, v = this.cells.get(k) || [];
                v.push(n);
                this.cells.set(k, v);
            }
    } }
    point(pageId, x, y) { return [...(this.cells.get(`${pageId}:${Math.floor(x / this.size)}:${Math.floor(y / this.size)}`) || []), ...(this.cells.get('*') || []).filter(n => n.pageId === pageId)].reverse().filter(n => hitNode(n, x, y)); }
}
export function preflight(doc, layouts = new Map()) { const issues = []; for (const n of doc.nodes) {
    if (n.type === 'text' && layouts.get(n.id)?.overflow && !n.nextId)
        issues.push({ severity: 'error', id: n.id, message: `Overset text in “${n.name}”` });
    if (n.type === 'image' && (!n.assetId || !doc.assets[n.assetId]))
        issues.push({ severity: 'error', id: n.id, message: `Missing image in “${n.name}”` });
    if (n.type === 'image' && doc.assets[n.assetId]?.width) {
        const a = doc.assets[n.assetId], ppi = Math.min(a.width / n.w, a.height / n.h) * 72;
        if (ppi < 150)
            issues.push({ severity: 'warning', id: n.id, message: `Low effective resolution: ${Math.round(ppi)} ppi in “${n.name}”` });
    }
    if (n.x + n.w < 0 || n.y + n.h < 0 || n.x > doc.settings.width || n.y > doc.settings.height)
        issues.push({ severity: 'warning', id: n.id, message: `“${n.name}” is outside the page` });
} return issues; }
