/*
 * MotionLab - tools.js
 *
 * Algodoo-style drawing tools. Each tool turns pointer input on the
 * canvas into calls on MotionLab.World.
 *
 *   select : click to select, drag to move (drag while running = throw),
 *            mouse wheel over the selection = rotate
 *   circle : drag from the centre to set the radius (click = default ball)
 *   box    : drag corner to corner (click = default box)
 *   pen    : draw any closed shape freehand
 *   line   : drag to draw a fixed wall or ramp
 *   erase  : click or drag over objects to delete them
 */
(function (ML) {
  'use strict';

  const TOOLS = ['select', 'circle', 'box', 'pen', 'line', 'erase'];
  const SHORTCUTS = { v: 'select', c: 'circle', b: 'box', p: 'pen', l: 'line', e: 'erase' };

  class Tools {
    constructor(canvas, world, renderer) {
      this.canvas = canvas;
      this.world = world;
      this.renderer = renderer;
      this.tool = 'select';
      this.selectedId = null;
      this.listeners = {};
      this.drag = null; // state of the current pointer gesture

      canvas.addEventListener('pointerdown', (e) => this._down(e));
      canvas.addEventListener('pointermove', (e) => this._move(e));
      canvas.addEventListener('pointerup', (e) => this._up(e));
      canvas.addEventListener('pointercancel', () => this._cancel());
      canvas.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
      window.addEventListener('keydown', (e) => this._key(e));

      // keep a dragged body glued to the pointer while the engine runs
      world.on('beforeStep', () => this._holdDragged());
      world.on('change', (c) => {
        if (c.type === 'remove' && c.id === this.selectedId) this.select(null);
        if (c.type === 'load' && !world.get(this.selectedId)) this.select(null);
      });
    }

    /* --------------------------------------------------------- public */

    on(event, fn) {
      (this.listeners[event] = this.listeners[event] || []).push(fn);
    }

    emit(event, data) {
      (this.listeners[event] || []).forEach((fn) => fn(data));
    }

    setTool(name) {
      if (!TOOLS.includes(name)) throw new Error('Unknown tool: ' + name);
      this._cancel();
      this.tool = name;
      this.canvas.dataset.tool = name;
      this.emit('tool', name);
    }

    select(id) {
      this.selectedId = id;
      this.renderer.selectedId = id;
      this.emit('select', id);
    }

    deleteSelected() {
      if (this.selectedId !== null) this.world.remove(this.selectedId);
    }

    /* -------------------------------------------------- pointer events */

    _point(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    _down(e) {
      if (e.button !== 0) return;
      this.canvas.setPointerCapture(e.pointerId);
      const p = this._point(e);
      const w = this.world;

      switch (this.tool) {
        case 'select': {
          const id = w.objectAt(p);
          this.select(id);
          if (id !== null) {
            const body = w.get(id).body;
            this.drag = {
              id,
              offset: { x: body.position.x - p.x, y: body.position.y - p.y },
              target: { ...body.position },
              last: { ...body.position },
              wasStatic: body.isStatic,
            };
          }
          break;
        }
        case 'circle':
        case 'box':
        case 'line':
          this.drag = { start: p, current: p };
          break;
        case 'pen':
          this.drag = { points: [p] };
          break;
        case 'erase':
          this.drag = { erasing: true };
          this._eraseAt(p);
          break;
      }
      this._updatePreview();
    }

    _move(e) {
      const p = this._point(e);
      const d = this.drag;
      this.canvas.style.cursor = this.tool === 'select' && this.world.objectAt(p) !== null ? 'grab' : '';
      if (!d) return;

      switch (this.tool) {
        case 'select': {
          d.target = { x: p.x + d.offset.x, y: p.y + d.offset.y };
          if (!this.world.running) {
            this.world.setProperty(d.id, 'position', d.target);
            d.last = { ...d.target };
          }
          break;
        }
        case 'circle':
        case 'box':
        case 'line':
          d.current = e.shiftKey && this.tool === 'line' ? snapAngle(d.start, p) : p;
          break;
        case 'pen': {
          const last = d.points[d.points.length - 1];
          if (dist(last, p) > 3) d.points.push(p);
          break;
        }
        case 'erase':
          this._eraseAt(p);
          break;
      }
      this._updatePreview();
    }

    _up(e) {
      const d = this.drag;
      this.drag = null;
      this.renderer.preview = null;
      if (!d) return;
      const w = this.world;
      let newId = null;

      switch (this.tool) {
        case 'select':
          // nothing to do: _holdDragged already gave it the throw velocity
          break;
        case 'circle': {
          const r = dist(d.start, d.current);
          newId = w.addObject({ kind: 'circle', radius: r >= 5 ? r : 20 }, { x: d.start.x, y: d.start.y });
          break;
        }
        case 'box': {
          const width = Math.abs(d.current.x - d.start.x);
          const height = Math.abs(d.current.y - d.start.y);
          if (width >= 5 && height >= 5) {
            newId = w.addObject(
              { kind: 'box', width, height },
              { x: (d.start.x + d.current.x) / 2, y: (d.start.y + d.current.y) / 2 }
            );
          } else {
            newId = w.addObject({ kind: 'box', width: 40, height: 40 }, { x: d.start.x, y: d.start.y });
          }
          break;
        }
        case 'line': {
          const length = dist(d.start, d.current);
          if (length >= 10) {
            newId = w.addObject(
              { kind: 'line', length, thickness: 10 },
              {
                x: (d.start.x + d.current.x) / 2,
                y: (d.start.y + d.current.y) / 2,
                angle: Math.atan2(d.current.y - d.start.y, d.current.x - d.start.x),
              }
            );
          }
          break;
        }
        case 'pen': {
          const pts = simplify(d.points, 2.5);
          if (pts.length < 3) break;
          // a crossed outline (figure 8) has almost no signed area, so
          // measure its hull instead, which is what the world will build
          const simple = window.decomp && window.decomp.isSimple(pts.map((q) => [q.x, q.y]));
          const area = Math.abs(signedArea(simple ? pts : Matter.Vertices.hull(pts)));
          if (area >= 150) newId = w.addPolygonFromPoints(pts);
          break;
        }
      }
      if (newId !== null) this.select(newId);
    }

    _cancel() {
      this.drag = null;
      this.renderer.preview = null;
    }

    _wheel(e) {
      if (this.tool !== 'select' || this.selectedId === null) return;
      const o = this.world.get(this.selectedId);
      if (!o || this.world.objectAt(this._point(e)) !== this.selectedId) return;
      e.preventDefault();
      const stepAngle = (Math.PI / 180) * (e.shiftKey ? 1 : 15);
      this.world.setProperty(this.selectedId, 'angle', o.body.angle + Math.sign(e.deltaY) * stepAngle);
    }

    _key(e) {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.metaKey || e.ctrlKey) return;
      const key = e.key.toLowerCase();
      if (SHORTCUTS[key]) {
        this.setTool(SHORTCUTS[key]);
      } else if (key === 'delete' || key === 'backspace') {
        this.deleteSelected();
        e.preventDefault();
      } else if (key === 'escape') {
        this._cancel();
        this.select(null);
      } else if (key === ' ') {
        this.world.toggle();
        e.preventDefault();
      } else if (key === 'r') {
        this.world.reset();
      }
    }

    /* --------------------------------------------------------- helpers */

    _holdDragged() {
      const d = this.drag;
      if (!d || this.tool !== 'select' || d.id === undefined) return;
      const o = this.world.get(d.id);
      if (!o) return;
      const body = o.body;
      // move to the pointer and give it the velocity of the hand, so that
      // releasing the mouse throws the object
      let vel = { x: d.target.x - d.last.x, y: d.target.y - d.last.y };
      const maxStep = ML.mpsToPx(20); // cap throws at 20 m/s
      const len = Math.hypot(vel.x, vel.y);
      if (len > maxStep) vel = { x: (vel.x / len) * maxStep, y: (vel.y / len) * maxStep };
      Matter.Body.setPosition(body, d.target);
      if (!body.isStatic) {
        Matter.Body.setVelocity(body, vel);
        Matter.Body.setAngularVelocity(body, 0);
      }
      d.last = { ...d.target };
    }

    _eraseAt(p) {
      const id = this.world.objectAt(p);
      if (id !== null) this.world.remove(id);
    }

    _updatePreview() {
      const d = this.drag;
      if (!d) {
        this.renderer.preview = null;
        return;
      }
      const px = ML.PX_PER_M;
      switch (this.tool) {
        case 'circle': {
          const r = dist(d.start, d.current);
          this.renderer.preview = {
            kind: 'circle', x: d.start.x, y: d.start.y, radius: r,
            hint: `r = ${(r / px).toFixed(2)} m`, hintAt: d.current,
          };
          break;
        }
        case 'box': {
          const width = Math.abs(d.current.x - d.start.x);
          const height = Math.abs(d.current.y - d.start.y);
          this.renderer.preview = {
            kind: 'box', x: (d.start.x + d.current.x) / 2, y: (d.start.y + d.current.y) / 2, width, height,
            hint: `${(width / px).toFixed(2)} x ${(height / px).toFixed(2)} m`, hintAt: d.current,
          };
          break;
        }
        case 'line': {
          const deg = (Math.atan2(d.start.y - d.current.y, d.current.x - d.start.x) * 180) / Math.PI;
          this.renderer.preview = {
            kind: 'line', from: d.start, to: d.current, thickness: 10,
            hint: `${(dist(d.start, d.current) / px).toFixed(2)} m, ${deg.toFixed(0)}°`, hintAt: d.current,
          };
          break;
        }
        case 'pen':
          this.renderer.preview = { kind: 'pen', points: d.points };
          break;
        default:
          this.renderer.preview = null;
      }
    }
  }

  /* ------------------------------------------------------ geometry utils */

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // hold Shift while drawing a wall to snap to 15 degree steps
  function snapAngle(from, to) {
    const len = dist(from, to);
    const step = Math.PI / 12;
    const a = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
    return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
  }

  function signedArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  }

  // Ramer-Douglas-Peucker: removes points that barely change the outline,
  // which keeps the physics body small and stable
  function simplify(points, tolerance) {
    if (points.length < 3) return points.slice();
    const keep = new Array(points.length).fill(false);
    keep[0] = keep[points.length - 1] = true;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let maxD = 0;
      let idx = -1;
      for (let i = s + 1; i < e; i++) {
        const dd = segmentDistance(points[i], points[s], points[e]);
        if (dd > maxD) {
          maxD = dd;
          idx = i;
        }
      }
      if (maxD > tolerance) {
        keep[idx] = true;
        stack.push([s, idx], [idx, e]);
      }
    }
    const out = points.filter((_, i) => keep[i]);
    // the pen path is closed automatically: drop the end if it is on the start
    if (out.length > 3 && dist(out[0], out[out.length - 1]) < tolerance * 2) out.pop();
    return out;
  }

  function segmentDistance(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return dist(p, a);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
  }

  ML.Tools = Tools;
  ML.TOOLS = TOOLS;
})((window.MotionLab = window.MotionLab || {}));
