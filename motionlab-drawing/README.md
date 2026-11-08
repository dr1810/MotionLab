# MotionLab: drawing module

Algodoo-style drawing for MotionLab. You can place and draw shapes on a canvas,
move and throw them, and run them with Matter.js. The UI team and the future
block-programming panel control the scene through one object, `lab.world`.

Open `index.html` in a browser. No build step and no server needed.

## Tools

| Tool | Key | How to use |
|---|---|---|
| Select | V | Click to select, drag to move. Dragging while running throws the object. Mouse wheel over the selection rotates it 15° (Shift: 1°) |
| Ball | C | Drag from the centre outwards to set the radius. A click places a default ball |
| Box | B | Drag corner to corner. A click places a default box |
| Draw | P | Draw any closed shape freehand. Concave shapes work too |
| Wall | L | Drag to draw a fixed wall or ramp. Hold Shift to snap to 15° steps |
| Erase | E | Click or drag over objects to delete them |

Other keys: Space = start/pause, R = reset, Delete = delete the selection, Esc = deselect.

**Reset** returns to the scene as it was when Start was first pressed, so you
can run the same experiment again.

## Files

```
index.html        demo page (toolbar and side panel are temporary, for testing)
js/world.js       physics world + public scene API  <- the UI and blocks use this
js/renderer.js    draws the scene on the canvas
js/tools.js       mouse / keyboard drawing tools
js/app.js         MotionLab.create(container) wires everything together
vendor/           matter.js 0.20.0 and poly-decomp (MIT), for concave shapes
```

## Using it from the UI or from blocks

```js
const lab = MotionLab.create(document.getElementById('stage'));
const world = lab.world;
```

### Units

- position: canvas pixels, origin top-left, **y grows downward**
- velocity: m/s on the same axes (so **negative vy = upward**)
- gravity: m/s² (positive = downward)
- `MotionLab.PX_PER_M = 50`, so one grid square is 1 m

### Scene

```js
world.addObject({ kind: 'circle', radius: 20 }, { x: 200, y: 100 })            // returns id
world.addObject({ kind: 'box', width: 60, height: 40 }, { x: 300, y: 100, angle: 0.3 })
world.addObject({ kind: 'line', length: 300, thickness: 10 }, { x: 400, y: 300, angle: 0.2 }) // fixed wall
world.addPolygonFromPoints([{x:0,y:0},{x:80,y:0},{x:40,y:60}])
world.remove(id)
world.clear()

world.getObjects()      // [{ id, kind, label, color, x, y, angle, vx, vy, speed,
                        //    mass, friction, restitution, isStatic, initialVelocity }]
world.describe(id)      // the same, for one object
world.objectAt({x, y})  // id under a point, or null
```

### Properties

```js
world.setProperty(id, 'mass', 2)
world.setProperty(id, 'friction', 0.1)          // 0..1
world.setProperty(id, 'restitution', 0.8)       // bounciness, 0..1
world.setProperty(id, 'isStatic', true)
world.setProperty(id, 'initialVelocity', { x: 3, y: -5 })   // applied when Start is pressed
world.setProperty(id, 'position', { x: 100, y: 50 })
world.setProperty(id, 'angle', Math.PI / 4)
world.setProperty(id, 'label', 'Red ball')
world.setProperty(id, 'color', '#eb5757')
world.setVelocity(id, vx, vy)                   // change speed now, e.g. from a block while running
world.setGravity(9.8)  /  world.getGravity()
```

### Playback

```js
world.play()  world.pause()  world.toggle()  world.reset()
world.state()          // { running, time (s), fresh }
```

### Events

```js
world.on('change', (c) => {})   // c.type: add | remove | property | gravity | load
world.on('state', (s) => {})    // play / pause / reset
world.on('start', () => {})     // first frame of a run: good hook for "when Start is pressed" blocks
world.on('tick', (t) => {})     // every physics step while running: good hook for "forever" blocks
lab.tools.on('select', (id) => {})
lab.tools.on('tool', (name) => {})
lab.tools.setTool('circle')
```

### Save and load

```js
const scene = world.toJSON()    // plain object, safe to JSON.stringify and share
world.loadJSON(scene)
```

## Example: what a block could compile to

```
when Start is pressed
  set velocity of [Ball 1] to (5, -3)
forever
  if y of [Ball 1] > 400 then set color of [Ball 1] to red
```

```js
const ball = world.getObjects().find((o) => o.label === 'Ball 1').id;
world.on('start', () => world.setVelocity(ball, 5, -3));
world.on('tick', () => {
  if (world.describe(ball).y > 400) world.setProperty(ball, 'color', '#eb5757');
});
```
