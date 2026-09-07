import { escapeXML, validateDocument, clone } from './core.js';
export function downloadBlob(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
export const safeName = name => name.replace(/[^a-z0-9 _.-]/gi, '').trim().slice(0, 100) || 'publication';
export async function readImageFile(file) { if (file.size > 25 * 1024 * 1024)
    throw Error('Each image must be smaller than 25 MB.'); if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type))
    throw Error('Please use a PNG, JPEG, WebP or GIF image.'); const src = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(Error('Image could not be read.')); r.readAsDataURL(file); }); const image = new Image(); image.src = src; await image.decode(); if (image.naturalWidth * image.naturalHeight > 60000000)
    throw Error('Image dimensions exceed the 60-megapixel import limit.'); return { name: file.name, src, width: image.naturalWidth, height: image.naturalHeight }; }
export async function portableDocument(doc) { const copy = clone(doc); for (const a of Object.values(copy.assets)) {
    if (a.src.startsWith('data:'))
        continue;
    const response = await fetch(a.src);
    if (!response.ok)
        throw Error(`Could not embed ${a.name}.`);
    const blob = await response.blob();
    a.src = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
} return copy; }
export async function saveDocument(doc) { const portable = await portableDocument(doc); downloadBlob(new Blob([JSON.stringify(portable, null, 2)], { type: 'application/json' }), safeName(doc.name) + '.folio'); }
export async function openDocument(file) { if (file.size > 100 * 1024 * 1024)
    throw Error('This file exceeds the 100 MB import limit.'); return validateDocument(JSON.parse(await file.text())); }
export class Persistence {
    constructor() { this.db = null; this.lastError = null; }
    async open() { if (this.db)
        return this.db; return new Promise((resolve, reject) => { const r = indexedDB.open('folioforge-studio', 1); r.onupgradeneeded = () => r.result.createObjectStore('documents'); r.onsuccess = () => { this.db = r.result; resolve(this.db); }; r.onerror = () => reject(r.error); }); }
    async read() { try {
        const db = await this.open();
        return await new Promise((resolve, reject) => { const r = db.transaction('documents').objectStore('documents').get('autosave'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    }
    catch (e) {
        this.lastError = e;
        return null;
    } }
    async write(doc) { const db = await this.open(); await new Promise((resolve, reject) => { const t = db.transaction('documents', 'readwrite'); t.objectStore('documents').put(doc, 'autosave'); t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || Error('Autosave transaction was interrupted.')); }); }
}
export async function exportSVG(doc, page, textEngine) {
    const portable = await portableDocument(doc);
    textEngine.compose(doc);
    const { width: w, height: h } = doc.settings;
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}pt" height="${h}pt" viewBox="0 0 ${w} ${h}">`, `<title>${escapeXML(doc.name)} — page ${doc.pages.indexOf(page) + 1}</title>`, `<defs><clipPath id="page"><rect width="${w}" height="${h}"/></clipPath></defs><g clip-path="url(#page)"><rect width="${w}" height="${h}" fill="${escapeXML(page.background)}"/>`];
    const nodes = doc.layers.flatMap(l => l.visible ? doc.nodes.filter(n => n.pageId === page.id && n.layerId === l.id && !n.hidden) : []);
    for (const n of nodes) {
        const fill = escapeXML(n.fill || 'none'), stroke = escapeXML(n.stroke || 'none');
        out.push(`<g transform="translate(${n.x} ${n.y}) rotate(${n.rotation} ${n.w / 2} ${n.h / 2})" opacity="${n.opacity}">`);
        const paint = `fill="${fill}" stroke="${stroke}" stroke-width="${n.strokeWidth || 0}"`;
        if (n.type === 'ellipse')
            out.push(`<ellipse cx="${n.w / 2}" cy="${n.h / 2}" rx="${n.w / 2}" ry="${n.h / 2}" ${paint}/>`);
        else
            out.push(`<rect width="${n.w}" height="${n.h}" ${paint}/>`);
        if (n.type === 'image' && portable.assets[n.assetId])
            out.push(`<image width="${n.w}" height="${n.h}" href="${portable.assets[n.assetId].src}" preserveAspectRatio="xMidYMid ${n.fit === 'contain' ? 'meet' : 'slice'}"/>`);
        if (n.type === 'text') {
            const layout = textEngine.layouts.get(n.id), s = layout?.style;
            if (s) {
                out.push(`<svg width="${n.w}" height="${n.h}" overflow="hidden"><g fill="${escapeXML(s.color)}" font-family="${escapeXML(s.fontFamily)}" font-size="${s.fontSize}" font-weight="${s.fontWeight}" font-style="${s.italic ? 'italic' : 'normal'}" letter-spacing="${s.tracking || 0}">`);
                for (const l of layout.lines)
                    out.push(`<text x="${l.x}" y="${l.y}"${l.justify ? ` textLength="${l.columnWidth}" lengthAdjust="spacing"` : ''}>${escapeXML(l.text)}</text>`);
                out.push('</g></svg>');
            }
        }
        out.push('</g>');
    }
    if (page.master !== 'none' && doc.masters?.A?.enabled)
        out.push(`<path d="M${doc.settings.margin} ${h - 32}h${w - doc.settings.margin * 2}" stroke="#999b8c" stroke-width="0.6"/>`);
    out.push('</g></svg>');
    return new Blob(out, { type: 'image/svg+xml' });
}
export async function printDocument(doc, renderer, onProgress = () => { }) { const frame = document.createElement('iframe'); frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;border:0'; document.body.append(frame); const printDoc = frame.contentDocument; printDoc.open(); printDoc.write(`<!doctype html><html><head><title>${escapeXML(doc.name)}</title><style>@page{size:${doc.settings.width}pt ${doc.settings.height}pt;margin:0}*{box-sizing:border-box}body{margin:0;background:white}img{display:block;width:${doc.settings.width}pt;height:${doc.settings.height}pt;page-break-after:always;break-after:page}img:last-child{break-after:auto;page-break-after:auto}</style></head><body></body></html>`); printDoc.close(); try {
    for (let i = 0; i < doc.pages.length; i++) {
        onProgress(i + 1, doc.pages.length);
        const canvas = await renderer.pageCanvas(doc, doc.pages[i], 2), img = printDoc.createElement('img');
        img.src = canvas.toDataURL('image/png');
        printDoc.body.append(img);
        await img.decode();
    }
    frame.contentWindow.focus();
    frame.contentWindow.print();
}
finally {
    setTimeout(() => frame.remove(), 120000);
} }
