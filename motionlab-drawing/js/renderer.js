/*
 * MotionLab - renderer.js
 *
 * Draws the world on a <canvas>: grid, ground, objects, the selection,
 * velocity arrows and the shape currently being drawn (tool preview).
 */
(function (ML) {
  'use strict';

  class Renderer {
    constructor(canvas, world) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.world = world;
      this.selectedId = null;
      this.preview = null; // set by the drawing tools
      this.showVelocity = true;
      this.showGrid = true;
    }

    resize(width, height) {
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.canvas.style.width = width + 'px';
      this.canvas.style.height = height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.width = width;
      this.height = height;
    }

    // Colours come from CSS custom properties on the canvas (or its page),
    // so the stage follows the page's light / dark theme. Defaults apply
    // when the page defines none.
    _theme() {
      const cs = getComputedStyle(this.canvas);
      const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
      return {
        bg: v('--stage-bg', '#fbfaf7'),
        grid: v('--stage-grid', 'rgba(30, 41, 59, 0.06)'),
        ink: v('--stage-ink', '#1e293b'),
      };
    }

    draw() {
      const ctx = this.ctx;
      this.theme = this._theme();
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.fillStyle = this.theme.bg;
      ctx.fillRect(0, 0, this.width, this.height);
      if (this.showGrid) this._grid();

      this.world.objects.forEach((o) => this._object(o));

      const sel = this.world.get(this.selectedId);
      if (sel) this._selection(sel);

      if (this.showVelocity) this.world.objects.forEach((o) => this._velocity(o));
      if (this.preview) this._preview(this.preview);
    }

    _grid() {
      const ctx = this.ctx;
      const step = ML.PX_PER_M; // one square = 1 m
      ctx.lineWidth = 1;
      ctx.strokeStyle = this.theme.grid;
      ctx.beginPath();
      for (let x = step; x < this.width; x += step) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, this.height);
      }
      for (let y = this.height - step; y > 0; y -= step) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(this.width, y + 0.5);
      }
      ctx.stroke();
    }

    _object(o) {
      const ctx = this.ctx;
      const body = o.body;
      const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];

      ctx.fillStyle = o.color;
      ctx.strokeStyle = shade(o.color, -0.35);
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';

      if (o.spec.kind === 'circle') {
        const r = o.spec.radius;
        ctx.beginPath();
        ctx.arc(body.position.x, body.position.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // spoke so rotation is visible
        ctx.beginPath();
        ctx.moveTo(body.position.x, body.position.y);
        ctx.lineTo(body.position.x + Math.cos(body.angle) * r, body.position.y + Math.sin(body.angle) * r);
        ctx.stroke();
        return;
      }

      if (o.spec.kind === 'polygon') {
        // Matter.js splits concave shapes into convex parts; draw the
        // outline the user actually drew so the seams are not visible
        const c = Math.cos(body.angle);
        const s = Math.sin(body.angle);
        const outline = o.spec.points.map((p) => ({
          x: body.position.x + p.x * c - p.y * s,
          y: body.position.y + p.x * s + p.y * c,
        }));
        ctx.beginPath();
        tracePath(ctx, outline);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        parts.forEach((p) => tracePath(ctx, p.vertices));
        ctx.fill();
        ctx.stroke();
      }

      if (body.isStatic && o.spec.kind !== 'line') {
        ctx.save();
        ctx.beginPath();
        parts.forEach((p) => tracePath(ctx, p.vertices));
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        const bb = body.bounds;
        ctx.beginPath();
        for (let x = bb.min.x - (bb.max.y - bb.min.y); x < bb.max.x; x += 8) {
          ctx.moveTo(x, bb.max.y);
          ctx.lineTo(x + (bb.max.y - bb.min.y), bb.min.y);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    _selection(o) {
      const ctx = this.ctx;
      const bb = o.body.bounds;
      const pad = 6;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = this.theme.ink;
      ctx.lineWidth = 1.25;
      ctx.strokeRect(bb.min.x - pad, bb.min.y - pad, bb.max.x - bb.min.x + pad * 2, bb.max.y - bb.min.y + pad * 2);
      ctx.restore();
    }

    _velocity(o) {
      if (o.body.isStatic) return;
      let vx;
      let vy;
      let dashed = false;
      if (this.world.isFresh()) {
        // before the run starts, show the initial velocity the user set
        vx = o.initialVelocity.x;
        vy = o.initialVelocity.y;
        dashed = true;
      } else {
        vx = ML.pxToMps(o.body.velocity.x);
        vy = ML.pxToMps(o.body.velocity.y);
      }
      const speed = Math.hypot(vx, vy);
      if (speed < 0.5) return; // hide jitter of resting objects
      const scale = 12; // pixels of arrow per m/s
      const from = o.body.position;
      const to = { x: from.x + vx * scale, y: from.y + vy * scale };
      arrow(this.ctx, from, to, this.theme.ink, dashed);
    }

    _preview(p) {
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = 'rgba(242, 153, 74, 0.25)';
      ctx.strokeStyle = '#c2410c';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      if (p.kind === 'circle') {
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'box') {
        ctx.rect(p.x - p.width / 2, p.y - p.height / 2, p.width, p.height);
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'pen') {
        tracePath(ctx, p.points, false);
        ctx.stroke();
      } else if (p.kind === 'line') {
        ctx.lineCap = 'round';
        ctx.lineWidth = p.thickness;
        ctx.strokeStyle = 'rgba(138, 143, 152, 0.6)';
        ctx.setLineDash([]);
        ctx.moveTo(p.from.x, p.from.y);
        ctx.lineTo(p.to.x, p.to.y);
        ctx.stroke();
      }
      if (p.hint) {
        ctx.setLineDash([]);
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillStyle = this.theme.ink;
        ctx.fillText(p.hint, p.hintAt.x + 10, p.hintAt.y - 10);
      }
      ctx.restore();
    }
  }

  function tracePath(ctx, vertices, close = true) {
    if (!vertices.length) return;
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i++) ctx.lineTo(vertices[i].x, vertices[i].y);
    if (close) ctx.closePath();
  }

  function arrow(ctx, from, to, color, dashed) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const head = 8;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    if (dashed) ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - head * Math.cos(angle - 0.45), to.y - head * Math.sin(angle - 0.45));
    ctx.lineTo(to.x - head * Math.cos(angle + 0.45), to.y - head * Math.sin(angle + 0.45));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // darken (amount < 0) or lighten (amount > 0) a #rrggbb colour
  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.round(Math.min(255, Math.max(0, amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
    const r = f(n >> 16);
    const g = f((n >> 8) & 255);
    const b = f(n & 255);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  ML.Renderer = Renderer;
})((window.MotionLab = window.MotionLab || {}));
