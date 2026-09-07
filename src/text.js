import { defaultTextStyle } from './core.js';
export const fontString = s => `${s.italic ? 'italic ' : ''}${s.fontWeight || 400} ${s.fontSize}px "${s.fontFamily}", serif`;
/** Browser text shaping + deterministic frame/column composition. Source offsets are UTF-16. */
export class TextEngine {
    constructor() { this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d'); this.layouts = new Map(); this.cache = new Map(); this.metrics = new Map(); this.segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null; }
    measure(text, style) { const key = `${fontString(style)}|${style.tracking}|${text}`; if (this.metrics.has(key))
        return this.metrics.get(key); this.ctx.font = fontString(style); this.ctx.letterSpacing = `${style.tracking || 0}px`; const width = this.ctx.measureText(text).width; this.metrics.set(key, width); if (this.metrics.size > 18000)
        this.metrics.clear(); return width; }
    nextLine(text, start, width, style) {
        if (start >= text.length)
            return null;
        if (text[start] === '\n')
            return { text: '', start, end: start, next: start + 1, paragraphLast: true };
        const endOfParagraph = text.indexOf('\n', start);
        const limit = endOfParagraph < 0 ? text.length : endOfParagraph;
        let pos = start, lastFit = start;
        const words = text.slice(start, limit).match(/\S+\s*|\s+/gu) || [];
        for (const token of words) {
            const candidate = pos + token.length;
            const value = text.slice(start, candidate).trimEnd();
            if (this.measure(value, style) > width) {
                break;
            }
            lastFit = candidate;
            pos = candidate;
        }
        if (lastFit === start) {
            const segment = text.slice(start, limit);
            const chars = this.segmenter ? [...this.segmenter.segment(segment)].map(s => s.segment) : Array.from(segment);
            let length = 0;
            for (const ch of chars) {
                if (length && this.measure(segment.slice(0, length + ch.length), style) > width)
                    break;
                length += ch.length;
                if (this.measure(segment.slice(0, length), style) > width)
                    break;
            }
            lastFit = start + Math.max(length, 1);
        }
        const paragraphLast = lastFit >= limit;
        let next = lastFit;
        while (next < limit && text[next] === ' ')
            next++;
        if (paragraphLast && text[limit] === '\n')
            next = limit + 1;
        return { text: text.slice(start, lastFit).trimEnd(), start, end: lastFit, next, paragraphLast };
    }
    compose(doc) {
        const frames = doc.nodes.filter(n => n.type === 'text'), byId = new Map(frames.map(n => [n.id, n])), incoming = new Set(frames.map(n => n.nextId).filter(Boolean));
        const layouts = new Map();
        for (const root of frames.filter(n => !incoming.has(n.id))) {
            let cursor = root, offset = 0, seen = new Set();
            const text = doc.stories[root.storyId]?.text || '';
            while (cursor && !seen.has(cursor.id)) {
                seen.add(cursor.id);
                const s = { ...defaultTextStyle, ...cursor.style };
                const key = JSON.stringify([text, offset, cursor.w, cursor.h, s]);
                let layout = this.cache.get(cursor.id);
                if (!layout || layout.key !== key) {
                    layout = this.layoutFrame(text, offset, cursor, s);
                    if (s.balanceColumns && s.columns > 1 && !layout.overflow && !cursor.nextId) {
                        let lo = s.fontSize + 2 * s.inset, hi = cursor.h;
                        for (let trial = 0; trial < 12; trial++) {
                            const mid = (lo + hi) / 2;
                            const candidate = this.layoutFrame(text, offset, { ...cursor, h: mid }, s);
                            if (candidate.overflow)
                                lo = mid;
                            else {
                                hi = mid;
                                layout = candidate;
                            }
                        }
                    }
                    layout.key = key;
                    this.cache.set(cursor.id, layout);
                }
                layouts.set(cursor.id, layout);
                offset = layout.end;
                cursor = byId.get(cursor.nextId);
            }
        }
        for (const key of this.cache.keys())
            if (!byId.has(key))
                this.cache.delete(key);
        this.layouts = layouts;
        return layouts;
    }
    layoutFrame(text, offset, frame, s) {
        const columns = Math.max(1, Math.floor(s.columns)), inset = s.inset || 0, cw = (frame.w - inset * 2 - (columns - 1) * s.gutter) / columns, lines = [];
        let pos = offset;
        if (cw <= 0 || frame.h - inset * 2 < s.fontSize)
            return { lines, start: offset, end: offset, overflow: pos < text.length, style: s };
        for (let col = 0; col < columns && pos < text.length; col++) {
            let y = inset;
            while (y + s.fontSize <= frame.h - inset + 0.001 && pos < text.length) {
                const line = this.nextLine(text, pos, cw, s);
                if (!line)
                    break;
                const mw = this.measure(line.text, s);
                let x = inset + col * (cw + s.gutter);
                if (s.align === 'center')
                    x += (cw - mw) / 2;
                else if (s.align === 'right')
                    x += cw - mw;
                lines.push({ ...line, x, y: y + s.fontSize * .82, width: mw, columnWidth: cw, justify: s.align === 'justify' && !line.paragraphLast });
                pos = line.next;
                y += s.fontSize * s.leading + (line.paragraphLast ? s.paragraphSpace : 0);
            }
        }
        return { lines, start: offset, end: pos, overflow: pos < text.length, style: s };
    }
    paint(ctx, frame, layout) { if (!layout)
        return; const s = layout.style; ctx.font = fontString(s); ctx.textBaseline = 'alphabetic'; ctx.fillStyle = s.color; ctx.letterSpacing = `${s.tracking || 0}px`; for (const l of layout.lines) {
        if (l.justify && l.text.includes(' ')) {
            const words = l.text.split(/ +/), space = (l.columnWidth - words.reduce((v, w) => v + this.measure(w, s), 0)) / (words.length - 1);
            let x = l.x;
            for (const word of words) {
                ctx.fillText(word, x, l.y);
                x += this.measure(word, s) + space;
            }
        }
        else
            ctx.fillText(l.text, l.x, l.y);
    } }
    clear() { this.cache.clear(); this.metrics.clear(); }
}
