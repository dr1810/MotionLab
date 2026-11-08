/*
 * MotionLab - world.js
 *
 * Owns the Matter.js engine and every object the user draws.
 * Everything outside this file (drawing tools, UI panels, future block
 * programming) should talk to the scene through the public methods of
 * MotionLab.World instead of touching Matter.js directly.
 *
 * Units used by the public API
 *   position : canvas pixels, origin top-left, y grows downward
 *   velocity : metres per second (same axes as position, so +y is downward)
 *   gravity  : metres per second squared (positive = downward)
 *   angle    : radians
 *   1 metre = PX_PER_M pixels
 */
(function (ML) {
  'use strict';

  const { Engine, Bodies, Body, Composite, Vertices, Query, Common } = Matter;

  if (window.decomp) Common.setDecomp(window.decomp);

  const PX_PER_M = 50;
  const STEP_MS = 1000 / 60;

  // m/s <-> Matter.js velocity (pixels per 1/60 s step)
  const mpsToPx = (v) => (v * PX_PER_M * STEP_MS) / 1000;
  const pxToMps = (v) => (v * 1000) / (PX_PER_M * STEP_MS);

  const PALETTE = ['#f2994a', '#56ccf2', '#6fcf97', '#bb6bd9', '#eb5757', '#f2c94c', '#2d9cdb'];
  const STATIC_COLOR = '#8a8f98';
  const WALL = 200; // thickness of the invisible side walls / ground

  class World {
    constructor(width, height) {
      this.engine = Engine.create();
      this.engine.gravity.scale = 0.001;
      this.objects = new Map(); // id -> object record
      this.nextId = 1;
      this.colorIndex = 0;
      this.running = false;
      this.time = 0; // simulated milliseconds since start
      this.snapshot = null; // scene saved when play() starts from t = 0
      this.listeners = {};
      this.bounds = [];
      this.setGravity(9.8);
      this.setSize(width, height);
    }

    /* ------------------------------------------------------------ events */

    on(event, fn) {
      (this.listeners[event] = this.listeners[event] || []).push(fn);
      return () => this.off(event, fn);
    }

    off(event, fn) {
      const list = this.listeners[event];
      if (list) this.listeners[event] = list.filter((f) => f !== fn);
    }

    emit(event, data) {
      (this.listeners[event] || []).forEach((fn) => fn(data));
    }

    /* ------------------------------------------------------- size, walls */

    setSize(width, height) {
      this.width = width;
      this.height = height;
      Composite.remove(this.engine.world, this.bounds);
      const opts = { isStatic: true, label: '__bound', friction: 0.6 };
      const tall = height * 4;
      this.bounds = [
        Bodies.rectangle(width / 2, height + WALL / 2, width + WALL * 2, WALL, opts), // ground
        Bodies.rectangle(-WALL / 2, height - tall / 2, WALL, tall, opts), // left
        Bodies.rectangle(width + WALL / 2, height - tall / 2, WALL, tall, opts), // right
      ];
      Composite.add(this.engine.world, this.bounds);
    }

    /* ---------------------------------------------------------- gravity */

    setGravity(mps2) {
      // Matter.js acceleration = gravity.y * scale (px / ms^2)
      this.engine.gravity.y = (mps2 * PX_PER_M) / 1000 / 1000 / this.engine.gravity.scale;
      this.emit('change', { type: 'gravity' });
    }

    getGravity() {
      return this.engine.gravity.y * this.engine.gravity.scale * 1000 * 1000 / PX_PER_M;
    }

    /* ---------------------------------------------------- create objects */

    // spec  : { kind: 'circle', radius } | { kind: 'box', width, height }
    //         { kind: 'polygon', points: [{x, y}] relative to x, y }
    //         { kind: 'line', length, thickness }   (static by default)
    // state : { x, y, angle, isStatic, mass, friction, restitution,
    //           color, label, initialVelocity: {x, y} (m/s), id }
    addObject(spec, state) {
      const id = state.id || this.nextId++;
      this.nextId = Math.max(this.nextId, id + 1);

      const body = this._createBody(spec, state.x, state.y);
      if (!body) return null;

      const kindCount = [...this.objects.values()].filter((o) => o.spec.kind === spec.kind).length + 1;
      const isStatic = state.isStatic !== undefined ? state.isStatic : spec.kind === 'line';

      const obj = {
        id,
        spec,
        body,
        label: state.label || `${KIND_NAMES[spec.kind]} ${kindCount}`,
        color: state.color || (isStatic ? STATIC_COLOR : this._nextColor()),
        initialVelocity: state.initialVelocity || { x: 0, y: 0 },
        mass: state.mass || null, // null = use the default density
      };
      body.plugin.motionlab = { id };

      Body.setAngle(body, state.angle || 0);
      body.friction = state.friction !== undefined ? state.friction : 0.3;
      body.restitution = state.restitution !== undefined ? state.restitution : 0.4;
      if (obj.mass) Body.setMass(body, obj.mass);
      if (isStatic) Body.setStatic(body, true);

      this.objects.set(id, obj);
      Composite.add(this.engine.world, body);
      this.emit('change', { type: 'add', id });
      return id;
    }

    // Convenience for the pen tool: takes a closed outline in canvas
    // coordinates and turns it into a body.
    addPolygonFromPoints(worldPoints, state = {}) {
      let pts = worldPoints.map((p) => ({ x: p.x, y: p.y }));
      if (pts.length < 3) return null;

      const decomp = window.decomp;
      const poly = pts.map((p) => [p.x, p.y]);
      // A self-intersecting outline cannot be decomposed: fall back to its hull
      if (!decomp || !decomp.isSimple(poly)) pts = Vertices.hull(pts);

      const centre = Vertices.centre(Vertices.create(pts));
      const rel = pts.map((p) => ({ x: p.x - centre.x, y: p.y - centre.y }));
      return this.addObject({ kind: 'polygon', points: rel }, Object.assign({ x: centre.x, y: centre.y }, state));
    }

    _createBody(spec, x, y) {
      switch (spec.kind) {
        case 'circle':
          return Bodies.circle(x, y, spec.radius);
        case 'box':
          return Bodies.rectangle(x, y, spec.width, spec.height);
        case 'line':
          return Bodies.rectangle(x, y, spec.length, spec.thickness, { chamfer: { radius: spec.thickness / 2 - 0.5 } });
        case 'polygon': {
          const body = Bodies.fromVertices(x, y, [spec.points], {}, true);
          if (!body || !body.vertices || body.vertices.length < 3) return null;
          Body.setPosition(body, { x, y });
          return body;
        }
        default:
          throw new Error('Unknown shape kind: ' + spec.kind);
      }
    }

    _nextColor() {
      return PALETTE[this.colorIndex++ % PALETTE.length];
    }

    /* ------------------------------------------------- query and remove */

    get(id) {
      return this.objects.get(id) || null;
    }

    objectAt(point) {
      const bodies = [...this.objects.values()].map((o) => o.body);
      const hits = Query.point(bodies, point);
      if (!hits.length) return null;
      const top = hits[hits.length - 1]; // drawn last = on top
      return top.plugin.motionlab.id;
    }

    remove(id) {
      const obj = this.objects.get(id);
      if (!obj) return;
      Composite.remove(this.engine.world, obj.body);
      this.objects.delete(id);
      this.emit('change', { type: 'remove', id });
    }

    clear() {
      [...this.objects.keys()].forEach((id) => this.remove(id));
      this.colorIndex = 0;
      this.nextId = 1;
    }

    // Plain description of every object, safe to show in a UI
    getObjects() {
      return [...this.objects.keys()].map((id) => this.describe(id));
    }

    describe(id) {
      const o = this.objects.get(id);
      if (!o) return null;
      const b = o.body;
      return {
        id: o.id,
        kind: o.spec.kind,
        label: o.label,
        color: o.color,
        x: b.position.x,
        y: b.position.y,
        angle: b.angle,
        vx: pxToMps(b.velocity.x),
        vy: pxToMps(b.velocity.y),
        speed: pxToMps(b.speed),
        mass: b.isStatic ? Infinity : b.mass,
        friction: b.friction,
        restitution: b.restitution,
        isStatic: b.isStatic,
        initialVelocity: { ...o.initialVelocity },
      };
    }

    /* ------------------------------------------------ change properties */

    // key: label | color | mass | friction | restitution | isStatic |
    //      initialVelocity ({x, y} in m/s) | position ({x, y}) | angle
    setProperty(id, key, value) {
      const o = this.objects.get(id);
      if (!o) return;
      const b = o.body;
      switch (key) {
        case 'label': o.label = String(value); break;
        case 'color': o.color = value; break;
        case 'mass':
          o.mass = Math.max(0.01, Number(value));
          if (!b.isStatic) Body.setMass(b, o.mass);
          break;
        case 'friction': b.friction = clamp(Number(value), 0, 1); break;
        case 'restitution': b.restitution = clamp(Number(value), 0, 1); break;
        case 'isStatic':
          Body.setStatic(b, Boolean(value));
          if (!value && o.mass) Body.setMass(b, o.mass);
          break;
        case 'initialVelocity':
          o.initialVelocity = { x: Number(value.x) || 0, y: Number(value.y) || 0 };
          break;
        case 'position':
          Body.setPosition(b, value);
          if (!this.running) Body.setVelocity(b, { x: 0, y: 0 });
          break;
        case 'angle': Body.setAngle(b, Number(value)); break;
        default: throw new Error('Unknown property: ' + key);
      }
      this.emit('change', { type: 'property', id, key });
    }

    // Live velocity change, e.g. from a "set velocity" block while running
    setVelocity(id, vx, vy) {
      const o = this.objects.get(id);
      if (o) Body.setVelocity(o.body, { x: mpsToPx(vx), y: mpsToPx(vy) });
    }

    /* ------------------------------------------------------ simulation */

    isFresh() {
      return this.snapshot === null; // nothing has run since the last reset
    }

    play() {
      if (this.running) return;
      if (this.isFresh()) {
        this.snapshot = this.toJSON();
        this.objects.forEach((o) => {
          if (!o.body.isStatic) {
            Body.setVelocity(o.body, { x: mpsToPx(o.initialVelocity.x), y: mpsToPx(o.initialVelocity.y) });
          }
        });
        this.emit('start');
      }
      this.running = true;
      this.emit('state', this.state());
    }

    pause() {
      if (!this.running) return;
      this.running = false;
      this.emit('state', this.state());
    }

    toggle() {
      this.running ? this.pause() : this.play();
    }

    reset() {
      if (this.snapshot) {
        const snap = this.snapshot;
        this.snapshot = null;
        this.loadJSON(snap);
      }
      this.running = false;
      this.time = 0;
      this.emit('state', this.state());
    }

    state() {
      return { running: this.running, time: this.time / 1000, fresh: this.isFresh() };
    }

    // Called once per animation frame by the app
    step() {
      if (!this.running) return;
      this.emit('beforeStep');
      Engine.update(this.engine, STEP_MS);
      this.time += STEP_MS;
      this.emit('tick', this.time / 1000);
    }

    /* ---------------------------------------------------- save and load */

    toJSON() {
      return {
        version: 1,
        gravity: this.getGravity(),
        objects: [...this.objects.values()].map((o) => ({
          id: o.id,
          spec: JSON.parse(JSON.stringify(o.spec)),
          label: o.label,
          color: o.color,
          x: o.body.position.x,
          y: o.body.position.y,
          angle: o.body.angle,
          isStatic: o.body.isStatic,
          mass: o.mass,
          friction: o.body.friction,
          restitution: o.body.restitution,
          initialVelocity: { ...o.initialVelocity },
        })),
      };
    }

    loadJSON(data) {
      if (typeof data === 'string') data = JSON.parse(data);
      [...this.objects.keys()].forEach((id) => {
        Composite.remove(this.engine.world, this.objects.get(id).body);
      });
      this.objects.clear();
      this.nextId = 1;
      this.colorIndex = 0;
      if (data.gravity !== undefined) this.setGravity(data.gravity);
      data.objects.forEach((o) => this.addObject(o.spec, o));
      this.colorIndex = data.objects.length;
      this.emit('change', { type: 'load' });
    }
  }

  const KIND_NAMES = { circle: 'Ball', box: 'Box', polygon: 'Shape', line: 'Wall' };

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, isNaN(v) ? lo : v));
  }

  ML.World = World;
  ML.PX_PER_M = PX_PER_M;
  ML.mpsToPx = mpsToPx;
  ML.pxToMps = pxToMps;
})((window.MotionLab = window.MotionLab || {}));
