import { color, radians, bounds, intersects } from './core.js';
const SHADER = /* wgsl */ `
struct View { viewport: vec4f, camera: vec4f };
struct Quad { rect: vec4f, uv: vec4f, fill: vec4f, stroke: vec4f, params: vec4f, misc: vec4f };
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage,read> objects: array<Quad>;
@group(1) @binding(0) var linearSampler: sampler;
@group(1) @binding(1) var image: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) local: vec2f, @location(1) @interpolate(flat) index: u32 };
@vertex fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index:u32)->VOut {
 let corners=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
 let q=objects[index];let local=corners[vertex];let d=(local-0.5)*q.rect.zw;
 let rotated=vec2f(q.params.x*d.x-q.params.y*d.y,q.params.y*d.x+q.params.x*d.y);
 let world=q.rect.xy+q.rect.zw*0.5+rotated;
 let screen=world*view.camera.x+view.viewport.zw;
 var o:VOut;o.position=vec4f(screen.x/view.viewport.x*2-1,1-screen.y/view.viewport.y*2,0,1);o.local=local;o.index=index;return o;
}
@fragment fn fs(i:VOut)->@location(0) vec4f {
 let q=objects[i.index];
 if(q.params.z>1.5){let sample=textureSampleLevel(image,linearSampler,q.uv.xy+i.local*q.uv.zw,0.0);return vec4f(sample.rgb,sample.a*q.misc.x);}
 let p=(i.local-0.5)*q.rect.zw;let halfsize=q.rect.zw*0.5;
 var distance=max(abs(p.x)-halfsize.x,abs(p.y)-halfsize.y);
 if(q.params.z>0.5){distance=(length(p/halfsize)-1)*min(halfsize.x,halfsize.y);}
 let aa=max(fwidth(distance),0.25/view.camera.x);
 let coverage=1-smoothstep(-aa,aa,distance);
 let hasStroke=q.stroke.a>0 && q.params.w>0;
 var result=q.fill;
 if(hasStroke){let interior=1-smoothstep(-q.params.w-aa,-q.params.w+aa,distance);result=mix(q.stroke,q.fill,interior);}
 return vec4f(result.rgb,result.a*coverage*q.misc.x);
}`;
class ResourceCache {
    constructor(onChange) { this.images = new Map(); this.text = new Map(); this.clock = 0; this.onChange = onChange; this.bytes = 0; }
    image(asset) { if (!asset)
        return null; let entry = this.images.get(asset.src); if (!entry) {
        const img = new Image();
        entry = { source: img, ready: false, key: asset.src };
        img.onload = () => { entry.ready = true; this.onChange(); };
        img.onerror = () => { entry.error = true; this.onChange(); };
        img.src = asset.src;
        this.images.set(asset.src, entry);
    } return entry.ready ? entry : null; }
    textFrame(node, layout, textEngine, scale) {
        if (!layout)
            return null;
        scale = Math.min(3, Math.max(1, 2 ** Math.ceil(Math.log2(scale))));
        scale = Math.min(scale, 2048 / node.w, 2048 / node.h);
        const key = `${layout.key}|${scale}`;
        let entry = this.text.get(node.id);
        if (entry?.key === key) {
            entry.used = ++this.clock;
            return entry;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(node.w * scale));
        canvas.height = Math.max(1, Math.ceil(node.h * scale));
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        textEngine.paint(ctx, node, layout);
        if (entry)
            this.bytes -= entry.bytes;
        entry = { key, source: canvas, ready: true, used: ++this.clock, bytes: canvas.width * canvas.height * 4 };
        this.text.set(node.id, entry);
        this.bytes += entry.bytes;
        while (this.bytes > 96 * 1024 * 1024 && this.text.size > 1) {
            const oldest = [...this.text.entries()].sort((a, b) => a[1].used - b[1].used)[0];
            this.bytes -= oldest[1].bytes;
            this.text.delete(oldest[0]);
        }
        return entry;
    }
    prune(doc) { const ids = new Set(doc.nodes.map(n => n.id)), srcs = new Set(Object.values(doc.assets).map(a => a.src)); for (const [id, e] of this.text)
        if (!ids.has(id)) {
            this.bytes -= e.bytes;
            this.text.delete(id);
        } for (const src of this.images.keys())
        if (!srcs.has(src))
            this.images.delete(src); }
}
export class Renderer {
    constructor(canvas, textEngine, onChange, onBackend) { this.canvas = canvas; this.textEngine = textEngine; this.onChange = onChange; this.onBackend = onBackend; this.resources = new ResourceCache(onChange); this.mode = 'initializing'; this.gpuTextures = new Map(); this.stats = { drawCalls: 0, objects: 0, frameMs: 0 }; this.serial = 0; this.disposed = false; }
    async initialize(forceCanvas = false) {
        if (!forceCanvas && navigator.gpu) {
            try {
                const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
                if (adapter) {
                    const device = await adapter.requestDevice();
                    this.device = device;
                    this.format = navigator.gpu.getPreferredCanvasFormat();
                    this.context = this.canvas.getContext('webgpu');
                    if (!this.context)
                        throw Error('WebGPU canvas context unavailable.');
                    this.context.configure({ device, format: this.format, alphaMode: 'opaque' });
                    device.pushErrorScope('validation');
                    const module = device.createShaderModule({ label: 'FolioForge retained quad shader', code: SHADER });
                    const info = await module.getCompilationInfo();
                    const errors = info.messages.filter(m => m.type === 'error');
                    if (errors.length)
                        throw Error(errors.map(e => e.message).join('\n'));
                    this.pipeline = await device.createRenderPipelineAsync({ label: 'FolioForge instanced compositor', layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] }, primitive: { topology: 'triangle-list' } });
                    const error = await device.popErrorScope();
                    if (error)
                        throw Error(error.message);
                    this.uniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
                    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
                    const white = document.createElement('canvas');
                    white.width = white.height = 1;
                    white.getContext('2d').fillRect(0, 0, 1, 1);
                    this.white = { source: white, key: 'white' };
                    this.mode = 'webgpu';
                    device.addEventListener('uncapturederror', e => { console.error('WebGPU validation:', e.error); this.fallback(e.error.message); });
                    device.lost.then(info => { if (!this.disposed)
                        this.fallback(`Device lost: ${info.message || info.reason}`); });
                    this.onBackend('WebGPU');
                    this.onChange();
                    return;
                }
            }
            catch (error) {
                console.warn('WebGPU fallback:', error);
                this.fallbackReason = error.message;
            }
        }
        this.fallback(this.fallbackReason || 'WebGPU adapter unavailable');
    }
    fallback(reason) { if (this.mode === 'canvas')
        return; if (this.context) {
        const replacement = this.canvas.cloneNode();
        this.canvas.replaceWith(replacement);
        this.canvas = replacement;
        this.context = null;
    } this.mode = 'canvas'; for (const entry of this.gpuTextures.values())
        entry.texture.destroy(); this.gpuTextures.clear(); this.storage?.destroy(); this.uniform?.destroy(); this.device?.destroy(); this.ctx = this.canvas.getContext('2d', { alpha: false }); this.onBackend('Canvas 2D', reason); this.onChange(); }
    resize(width, height, dpr) { this.width = width; this.height = height; this.dpr = Math.min(dpr || 1, 3); const w = Math.max(1, Math.round(width * this.dpr)), h = Math.max(1, Math.round(height * this.dpr)); if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
    } }
    texture(resource) { let e = this.gpuTextures.get(resource); if (e) {
        e.used = this.serial;
        return e;
    } const d = this.device; let src = resource.source, w = src.naturalWidth || src.width, h = src.naturalHeight || src.height; const limit = Math.min(d.limits.maxTextureDimension2D, 8192); if (w > limit || h > limit) {
        const scale = Math.min(limit / w, limit / h), canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(w * scale));
        canvas.height = Math.max(1, Math.floor(h * scale));
        canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
        src = canvas;
        w = canvas.width;
        h = canvas.height;
    } const texture = d.createTexture({ label: 'FolioForge retained texture', size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT }); d.queue.copyExternalImageToTexture({ source: src }, { texture, premultipliedAlpha: false }, [w, h]); e = { texture, used: this.serial, group: d.createBindGroup({ layout: this.pipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: texture.createView() }] }) }; this.gpuTextures.set(resource, e); return e; }
    buildScene(doc, placements, camera) {
        const items = [], viewport = { x: -camera.x / camera.zoom, y: -camera.y / camera.zoom, w: this.width / camera.zoom, h: this.height / camera.zoom };
        const add = (n, ox = 0, oy = 0, resource = null, uv = [0, 0, 1, 1], clip = null) => items.push({ x: n.x + ox, y: n.y + oy, w: n.w, h: n.h, rotation: n.rotation || 0, fill: n.fill || 'none', stroke: n.stroke || 'none', strokeWidth: n.strokeWidth || 0, opacity: n.opacity ?? 1, kind: resource ? 2 : n.type === 'ellipse' ? 1 : 0, resource, uv, clip });
        for (const page of placements) {
            if (!intersects(page, viewport))
                continue;
            add({ x: page.x + 4, y: page.y + 7, w: page.w, h: page.h, fill: '#363735' });
            add({ x: page.x, y: page.y, w: page.w, h: page.h, fill: page.background });
            const nodes = doc.layers.flatMap(l => l.visible ? doc.nodes.filter(n => n.pageId === page.id && n.layerId === l.id && !n.hidden) : []);
            for (const n of nodes) {
                const b = bounds(n);
                b.x += page.x;
                b.y += page.y;
                if (!intersects(b, viewport))
                    continue;
                const clip = page;
                if (n.fill !== 'none' || n.stroke !== 'none')
                    add(n, page.x, page.y, null, [0, 0, 1, 1], clip);
                if (n.type === 'text') {
                    const resource = this.resources.textFrame(n, this.textEngine.layouts.get(n.id), this.textEngine, camera.zoom * this.dpr);
                    if (resource)
                        add({ ...n, fill: 'none', stroke: 'none' }, page.x, page.y, resource, [0, 0, 1, 1], clip);
                }
                if (n.type === 'image') {
                    const a = doc.assets[n.assetId], resource = this.resources.image(a);
                    if (resource) {
                        const aw = resource.source.naturalWidth, ah = resource.source.naturalHeight, ar = aw / ah, fr = n.w / n.h;
                        let uv = [0, 0, 1, 1], imageNode = { ...n, fill: 'none', stroke: 'none' };
                        if (n.fit === 'contain') {
                            if (ar > fr) {
                                imageNode.h = n.w / ar;
                                imageNode.y += (n.h - imageNode.h) / 2;
                            }
                            else {
                                imageNode.w = n.h * ar;
                                imageNode.x += (n.w - imageNode.w) / 2;
                            }
                        }
                        else {
                            if (ar > fr) {
                                uv[2] = fr / ar;
                                uv[0] = (1 - uv[2]) / 2;
                            }
                            else {
                                uv[3] = ar / fr;
                                uv[1] = (1 - uv[3]) / 2;
                            }
                        }
                        add(imageNode, page.x, page.y, resource, uv, clip);
                    }
                    else
                        add({ ...n, fill: '#c7c8b9', stroke: '#a9ad9b' }, page.x, page.y, null, [0, 0, 1, 1], clip);
                }
            }
            if (page.master !== 'none' && doc.masters?.A?.enabled) {
                add({ x: page.x + doc.settings.margin, y: page.y + page.h - 32, w: page.w - doc.settings.margin * 2, h: .6, fill: '#999b8c' });
            }
        }
        this.resources.prune(doc);
        return items;
    }
    render(doc, placements, camera) { if (this.mode === 'initializing' || !this.width)
        return; const time = performance.now(); this.serial++; const items = this.buildScene(doc, placements, camera); this.stats.objects = items.length; this.stats.drawCalls = 0; if (this.mode === 'webgpu')
        this.renderGPU(items, camera);
    else
        this.renderCanvas(items, camera); this.stats.frameMs = performance.now() - time; }
    renderGPU(items, camera) {
        const d = this.device, count = items.length;
        const needed = Math.max(96, count * 96);
        if (!this.storage || this.capacity < needed) {
            this.storage?.destroy();
            this.capacity = 2 ** Math.ceil(Math.log2(needed));
            this.storage = d.createBuffer({ size: this.capacity, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
            this.bind = d.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniform } }, { binding: 1, resource: { buffer: this.storage } }] });
        }
        const data = new Float32Array(count * 24);
        items.forEach((q, i) => { const o = i * 24; data.set([q.x, q.y, q.w, q.h, ...q.uv, ...color(q.fill), ...color(q.stroke), Math.cos(radians(q.rotation)), Math.sin(radians(q.rotation)), q.kind, q.strokeWidth, q.opacity, 0, 0, 0], o); });
        d.queue.writeBuffer(this.uniform, 0, new Float32Array([this.width, this.height, camera.x, camera.y, camera.zoom, 0, 0, 0]));
        if (count)
            d.queue.writeBuffer(this.storage, 0, data);
        const encoder = d.createCommandEncoder({ label: 'FolioForge frame' });
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: .278, g: .286, b: .282, a: 1 } }] });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bind);
        for (let i = 0; i < count;) {
            const q = items[i], resource = q.resource || this.white;
            let end = i + 1;
            while (end < count && (items[end].resource || this.white) === resource && items[end].clip === q.clip)
                end++;
            let x = 0, y = 0, w = this.canvas.width, h = this.canvas.height;
            if (q.clip) {
                const p = camera.toScreen(q.clip.x, q.clip.y);
                x = Math.max(0, Math.floor(p.x * this.dpr));
                y = Math.max(0, Math.floor(p.y * this.dpr));
                w = Math.min(this.canvas.width, Math.ceil((p.x + q.clip.w * camera.zoom) * this.dpr)) - x;
                h = Math.min(this.canvas.height, Math.ceil((p.y + q.clip.h * camera.zoom) * this.dpr)) - y;
            }
            if (w > 0 && h > 0) {
                pass.setScissorRect(x, y, w, h);
                pass.setBindGroup(1, this.texture(resource).group);
                pass.draw(6, end - i, 0, i);
                this.stats.drawCalls++;
            }
            i = end;
        }
        pass.end();
        d.queue.submit([encoder.finish()]);
        for (const [key, e] of this.gpuTextures)
            if (this.serial - e.used > 5) {
                e.texture.destroy();
                this.gpuTextures.delete(key);
            }
    }
    renderCanvas(items, camera) { const c = this.ctx; c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.fillStyle = '#474949'; c.fillRect(0, 0, this.width, this.height); c.translate(camera.x, camera.y); c.scale(camera.zoom, camera.zoom); for (const q of items) {
        c.save();
        if (q.clip) {
            c.beginPath();
            c.rect(q.clip.x, q.clip.y, q.clip.w, q.clip.h);
            c.clip();
        }
        c.translate(q.x + q.w / 2, q.y + q.h / 2);
        c.rotate(radians(q.rotation));
        c.translate(-q.w / 2, -q.h / 2);
        c.globalAlpha = q.opacity;
        if (q.resource) {
            const s = q.resource.source, w = s.naturalWidth || s.width, h = s.naturalHeight || s.height;
            c.drawImage(s, q.uv[0] * w, q.uv[1] * h, q.uv[2] * w, q.uv[3] * h, 0, 0, q.w, q.h);
        }
        else {
            c.beginPath();
            if (q.kind === 1)
                c.ellipse(q.w / 2, q.h / 2, q.w / 2, q.h / 2, 0, 0, Math.PI * 2);
            else
                c.rect(0, 0, q.w, q.h);
            if (q.fill !== 'none') {
                c.fillStyle = q.fill;
                c.fill();
            }
            if (q.stroke !== 'none') {
                c.strokeStyle = q.stroke;
                c.lineWidth = q.strokeWidth;
                c.stroke();
            }
        }
        c.restore();
        this.stats.drawCalls++;
    } }
    /** Export uses the same scene/text layout, independent of the active GPU backend. */
    async pageCanvas(doc, page, scale = 2) { const entries = Object.values(doc.assets).map(a => { const e = this.resources.image(a); if (e)
        return Promise.resolve(); const pending = this.resources.images.get(a.src); return new Promise(resolve => { if (pending.error)
        return resolve(); pending.source.addEventListener('load', resolve, { once: true }); pending.source.addEventListener('error', resolve, { once: true }); }); }); await Promise.all(entries); const canvas = document.createElement('canvas'); canvas.width = Math.ceil(doc.settings.width * scale); canvas.height = Math.ceil(doc.settings.height * scale); const old = { canvas: this.canvas, ctx: this.ctx, width: this.width, height: this.height, dpr: this.dpr, stats: this.stats }; this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.width = doc.settings.width; this.height = doc.settings.height; this.dpr = scale; this.stats = { drawCalls: 0 }; try {
        this.textEngine.compose(doc);
        const camera = { x: 0, y: 0, zoom: 1, toScreen: (x, y) => ({ x, y }) };
        this.renderCanvas(this.buildScene(doc, [{ ...page, x: 0, y: 0, w: this.width, h: this.height }], camera), camera);
    }
    finally {
        Object.assign(this, old);
    } return canvas; }
    destroy() { this.disposed = true; for (const e of this.gpuTextures.values())
        e.texture.destroy(); this.storage?.destroy(); this.uniform?.destroy(); this.device?.destroy(); }
}
