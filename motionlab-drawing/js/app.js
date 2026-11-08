/*
 * MotionLab - app.js
 *
 * MotionLab.create(container) puts a drawing canvas inside `container`
 * and wires the world, renderer and tools together.
 *
 *   const lab = MotionLab.create(document.getElementById('stage'));
 *   lab.world   -> scene API (add objects, properties, play/pause/reset, JSON)
 *   lab.tools   -> drawing tools (setTool, select, events 'tool' / 'select')
 */
(function (ML) {
  'use strict';

  ML.create = function (container, options = {}) {
    const canvas = document.createElement('canvas');
    canvas.className = 'motionlab-canvas';
    canvas.style.touchAction = 'none'; // pointer events instead of scrolling on touch
    container.appendChild(canvas);

    const size = () => ({ w: container.clientWidth || 800, h: container.clientHeight || 500 });
    const { w, h } = size();

    const world = new ML.World(w, h);
    const renderer = new ML.Renderer(canvas, world);
    const tools = new ML.Tools(canvas, world, renderer);
    renderer.resize(w, h);

    new ResizeObserver(() => {
      const s = size();
      if (s.w === renderer.width && s.h === renderer.height) return;
      renderer.resize(s.w, s.h);
      world.setSize(s.w, s.h);
    }).observe(container);

    let raf = 0;
    const frame = () => {
      world.step();
      renderer.draw();
      raf = requestAnimationFrame(frame);
    };
    frame();

    if (options.demoScene) ML.loadDemoScene(world);

    return {
      world,
      renderer,
      tools,
      canvas,
      destroy() {
        cancelAnimationFrame(raf);
        canvas.remove();
      },
    };
  };

  // A small starting scene: a ramp, a ball with an initial velocity and a box
  ML.loadDemoScene = function (world) {
    const W = world.width;
    const H = world.height;
    world.addObject({ kind: 'line', length: W * 0.35, thickness: 10 }, { x: W * 0.22, y: H * 0.55, angle: 0.35 });
    world.addObject({ kind: 'circle', radius: 22 }, { x: W * 0.1, y: H * 0.25, initialVelocity: { x: 3, y: 0 } });
    world.addObject({ kind: 'box', width: 60, height: 60 }, { x: W * 0.65, y: H - 30 });
  };
})((window.MotionLab = window.MotionLab || {}));
