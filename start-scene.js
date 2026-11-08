import { ASSET_BY_ID } from './engine/assets.js';

const START = {
  format: "fluidsim-scene",
  version: 1,
  kits: 2,
  frosted: 1,
  camera: {"target": [0.9878208792450555, 0.2334754673554136, 0.9412885920499389], "distance": 2, "yaw": 0.22719897460937377, "pitch": 0.3083999633789064, "fov": 0.6435011087932844},
  settings: {"speed": 1, "smokeAmount": 1.1, "smokeOpacity": 5, "rise": 0.4, "swirl": 0.5, "fade": 0.85, "smokeDetail": 1, "smokeColor": "#f2f2f0", "cooling": 0.5, "smokeWeight": 0.3, "smokeSteps": 30, "flow": 0.3, "splash": 0.29, "clarity": 0.82, "foam": 1, "caustics": 1, "liquidColor": "#2a8de8", "liquidSteps": 70, "look": "smooth", "objectColor": "#c9c4bb", "gravity": 9.81},
  look: {"light": {"preset": "none", "label": "None: your lights only", "key": {"az": 120, "el": 50, "color": "#ffffff", "power": 0, "soft": 2}, "fill": {"az": 0, "el": 0, "color": "#ffffff", "power": 0}, "rim": {"az": 0, "el": 0, "color": "#ffffff", "power": 0}, "ambSky": "#000000", "ambGround": "#000000", "ambPower": 0, "exposure": 1}, "background": {"preset": "black", "label": "Black", "kind": 5, "top": "#000000", "bottom": "#000000", "haze": 0, "image": null}, "ground": {"color": "#b0aea6", "finish": "satin", "grid": true, "gridColor": "#858585", "gridSpacing": 0.1, "gridStrength": 0.35}, "weather": {"rain": 0}, "wind": {"on": false, "dir": 90, "speed": 1, "gusts": 0.1, "turbulence": 0.5}, "post": {"look": "grHdf", "amount": 1, "fringe": 0.75, "contrast": 1.16, "lift": 0.02}, "media": null},
  region: {"size": [5.83, 1.68, 6.95], "center": [0.913, 0.905]},
  fineness: {"smoke": 0.041666666666666664, "liquid": 0.05},
  objects: [
    {"id": 169, "kind": "object", "shape": "model", "name": "Clear basin 1", "pos": [0.7111447447065374, 0.2216997645591959, 0.8066421207646832], "size": [0.5, 0.07000000029802322, 0.3499999940395355], "rot": [0, 0, 3.141592653589793], "color": [0.8392156862745098, 0.9529411764705882, 0.9686274509803922], "model": "asset:tray", "moves": false, "collides": true, "material": "wood", "home": {"pos": [0.7111447447065374, 0.2216997645591959, 0.8066421207646832], "rot": [0, 0, 3.141592653589793]}, "finish": "glass", "motion": {"travel": "none", "dir": 90, "speed": 0.3, "distance": 4, "spin": 0, "bob": 0}, "asset": "tray"},
    {"id": 173, "kind": "object", "shape": "ball", "name": "Ball 1", "pos": [0.7196439565669367, 0.04061128907989703, 1.8181003064710863], "size": [0.06420001216501686, 0.06468783537566195, 0.06468783537566195], "rot": [0.9481148296221209, 1.3802116454847015, 2.7449919079474077], "color": [0.788235294117647, 0.7686274509803922, 0.7333333333333333], "model": null, "moves": true, "collides": true, "material": "rubber", "home": {"pos": [0.6653062183735843, 0.3713507300512409, 1.0188607557200917], "rot": [0.9481148296221209, 1.3802116454847015, 2.7449919079474077]}, "finish": "frosted", "motion": {"travel": "none", "dir": 90, "speed": 0.3, "distance": 4, "spin": 0, "bob": 0}, "asset": null, "pbr": {"depth": 0.36, "ior": 1.7, "rough": 0.51}, "soft": {"kind": "solid", "preset": "custom", "base": "jelly", "density": 1090, "young": 1000, "poisson": 0.49, "damp": 0.5, "grip": 0.4, "drag": 0.5, "grow": 1, "thick": 0.707, "bounce": 0.18}},
    {"id": 175, "kind": "object", "shape": "model", "name": "Floor drain 1", "pos": [0.21164713662947365, 0.004999999888241291, 1.185977373611132], "size": [0.18000000715255737, 0.004999999888241291, 0.18000000715255737], "rot": [0, 0, 0], "color": [0.6039215686274509, 0.6274509803921569, 0.6588235294117647], "model": "asset:floor-drain@2", "moves": false, "collides": false, "material": "wood", "home": {"pos": [0.21164713662947365, 0.004999999888241291, 1.185977373611132], "rot": [0, 0, 0]}, "finish": "glass", "motion": {"travel": "none", "dir": 90, "speed": 0.3, "distance": 4, "spin": 0, "bob": 0}, "asset": "floor-drain"},
  ],
  emitters: [
    {"id": 171, "kind": "emitter", "type": "smoke", "name": "Smoke source 1", "pos": [0.6967813226216686, 0.11281856765998806, 0.777793413698493], "radius": 0.24, "color": [1, 0.8, 0.9450980392156862], "dir": [0, 1, 0], "speed": 0.6, "rate": 1, "heat": 1, "on": true, "pulse": null},
    {"id": 172, "kind": "emitter", "type": "smoke", "name": "Smoke source 1 copy", "pos": [1.099543040091237, 0.11281856765998806, 1.0609382453504286], "radius": 0.24, "color": [0.9529411764705882, 0.9529411764705882, 0.6470588235294118], "dir": [0, 1, 0], "speed": 0.6, "rate": 1, "heat": 1, "on": true, "pulse": null},
    {"id": 174, "kind": "emitter", "type": "liquid", "name": "Liquid source 1", "pos": [0.43601068967306267, 0.5404778333093461, 0.9178198922568873], "radius": 0.04, "color": [0.24705882352941178, 0.592156862745098, 0.9137254901960784], "dir": [0, -1, 0], "speed": 2.2, "rate": 1.25, "heat": 1, "on": true, "pulse": null},
    {"id": 176, "kind": "emitter", "type": "liquid", "name": "Floor drain intake", "pos": [0.21164713662947365, 0.03, 1.185977373611132], "radius": 0.15, "color": [0.16470588235294117, 0.17647058823529413, 0.2], "dir": [0, 1, 0], "speed": 0, "rate": 1, "heat": 1, "on": true, "pulse": null, "sink": true, "attach": {"to": 175, "part": 0}},
    {"id": 177, "kind": "emitter", "type": "liquid", "name": "Liquid source 2", "pos": [0.9779796595177171, 0.545748257877824, 0.8964523458399306], "radius": 0.14, "color": [0.7843137254901961, 0.9607843137254902, 0.7215686274509804], "dir": [0, -1, 0], "speed": 0.7, "rate": 0.2, "heat": 1, "on": true, "pulse": null},
  ],
  lights: [
    {"id": 170, "kind": "light", "type": "area", "name": "Area light 1", "pos": [0.7474911976713045, 1.585984237950735, 0.9381346699009857], "dir": [0, -1, 0], "color": [1, 1, 1], "power": 6, "radius": 0.4, "aspect": 0.6, "angle": 40, "soft": 0.3, "shadows": true, "show": true, "on": true},
  ],
  marks: [],
  models: [
    {"id": "asset:tray", "name": "Clear basin", "asset": "tray", "design": 1},
    {"id": "asset:floor-drain@2", "name": "Floor drain", "asset": "floor-drain", "design": 2},
  ],
  images: [],
  image: null,
  imageName: null,
};

export const startScene = () => JSON.parse(JSON.stringify(START));

export const START_CAMERA = { target: [0.9878208792450555, 0.2334754673554136, 0.9412885920499389], distance: 2, yaw: 0.22719897460937377, pitch: 0.3083999633789064, fov: 36.8699 };

export function wakeOldKits(scene) {
  let n = 0;
  for (const o of scene.objects) {
    const a = ASSET_BY_ID[o.asset];
    if (!a || !a.sources || !a.sources.length || o.whenInBox) continue;
    if (scene.emitters.some(e => e.attach && e.attach.to === o.id)) continue;
    o.whenInBox = { parts: true };
    n++;
  }
  return n;
}

export function clearOldTiles(v) {
  const S = v.scene, near = (a, b) => Math.abs(a - b) < 1e-4;
  const tiles = S.objects.filter(o => o.name === 'Tile' && o.shape === 'box' && !o.model && near(o.size[0], 0.13) && near(o.size[1], 0.004) && near(o.size[2], 0.13));
  for (const t of tiles) S.remove(t);
  let setDown = 0;
  if (tiles.length) for (const o of [...S.objects]) {
    if (o.model && !S.models.has(o.model)) continue;
    const y0 = o.pos[1];
    v.dropToGround(o, 0);
    const up = y0 - o.pos[1];
    const k = S.objects.indexOf(o);
    S.objects.splice(k, 1);
    const under = S.pick({ origin: [o.pos[0], up + 0.001, o.pos[2]], dir: [0, -1, 0] }, { emitters: false });
    S.objects.splice(k, 0, o);
    if (up > 0.002 && up < 0.012 && under && !under.item) {
      if (o.home) o.home.pos[1] -= up;
      setDown++;
    } else o.pos[1] = y0;
  }
  return { tiles: tiles.length, setDown };
}
