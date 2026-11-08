# Cloudtank

## https://cloudtank.windnoise.org/

Smoke and liquid simulated live on your graphics card, in the browser. Pour coloured water and smoke into a 3D scene,
put shapes, ready-made objects, soft things and your own models in their way, add wind, lights and drains, and watch the
fluids flow, mix their colours and push things about. Make your own shapes too: draw half an outline and spin it into a
vase or a funnel, draw a path for a channel the water runs down, or combine shapes, cutting one from another. Give each
fluid a look of its own, then show the picture through a camera's look and a medium: a film stock, a lens, an old copier,
a tube screen, a print.

It runs in Chrome or Edge on a computer (it needs WebGPU) and needs an internet connection for its typeface. Your
scenes stay in your browser; the app sends none of them anywhere. Save writes a `.cloudtank` file you can open again.

An AI agent that works in your browser can use Cloudtank's own commands rather than clicking: in the page,
`await cloudtank.help()` lists them, and each takes one object and returns its answer, for example
`await cloudtank.add({ what: "smoke", at: [0, 1], set: { Colour: "#ff2200" } })`. Lengths are in metres, y is up.

© 2026 Windnoise. All rights reserved. What you may and may not do: [LICENSE](LICENSE).
