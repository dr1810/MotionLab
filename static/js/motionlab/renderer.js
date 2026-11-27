// Canvas renderer. Takes any CanvasRenderingContext2D-like object, a snapshot and a view
// transform from view.js. It never reads the DOM itself, so it can be tested with a fake context.

export const DEFAULT_THEME = Object.freeze({
  background: '#faf9fd',
  grid: '#eee8f5',
  floor: '#cfc4dc',
  floorFill: '#f0eaf8',
  label: '#8a7a9c',
  dynamic: '#7953cf',
  static: '#a99cbc',
  outline: '#34294d',
  velocity: '#e0679a',
});

/**
 * @param ctx      2D context, already scaled for devicePixelRatio
 * @param snapshot from sim.snapshot()/step()
 * @param view     from createViewTransform()/fitView()
 * @param size     { widthPx, heightPx } in CSS pixels
 */
export function drawScene(ctx, snapshot, view, { widthPx, heightPx }, theme = DEFAULT_THEME) {
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, widthPx, heightPx);

  // 1 m grid (labels every metre on the floor).
  const left = view.toWorld(0, 0).x;
  const right = view.toWorld(widthPx, 0).x;
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = theme.label;
  ctx.font = '11px system-ui';
  for (let m = Math.ceil(left); m <= Math.floor(right); m++) {
    const px = view.toCanvas(m, 0).x;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, view.floorPx);
    ctx.stroke();
    ctx.fillText(`${m} m`, px + 2, view.floorPx + 14);
  }

  // Floor at FLOOR_Y, obtained through the view transform.
  ctx.fillStyle = theme.floorFill;
  ctx.fillRect(0, view.floorPx, widthPx, heightPx - view.floorPx);
  ctx.strokeStyle = theme.floor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, view.floorPx);
  ctx.lineTo(widthPx, view.floorPx);
  ctx.stroke();

  for (const body of snapshot.bodies) drawBody(ctx, body, view, theme);
}

function drawBody(ctx, body, view, theme) {
  const { x, y } = body.position;
  const c = view.toCanvas(x, y);
  ctx.fillStyle = body.static ? theme.static : theme.dynamic;
  ctx.strokeStyle = theme.outline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (body.shape === 'circle') {
    ctx.arc(c.x, c.y, view.lengthToPx(body.dimensions.radius), 0, Math.PI * 2);
  } else {
    const { width, height } = body.dimensions;
    const topLeft = view.toCanvas(x - width / 2, y + height / 2);
    ctx.rect(topLeft.x, topLeft.y, view.lengthToPx(width), view.lengthToPx(height));
  }
  ctx.fill();
  ctx.stroke();

  // Velocity arrow: 0.1 s of travel.
  const vx = body.velocity.x;
  const vy = body.velocity.y;
  if (!body.static && Math.hypot(vx, vy) > 0.05) {
    const tip = view.toCanvas(x + vx * 0.1, y + vy * 0.1);
    ctx.strokeStyle = theme.velocity;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
  }

  ctx.fillStyle = theme.outline;
  ctx.font = '11px system-ui';
  const top = body.shape === 'circle' ? body.dimensions.radius : body.dimensions.height / 2;
  const labelPos = view.toCanvas(x, y + top);
  ctx.fillText(body.id, labelPos.x - 8, labelPos.y - 4);
}
