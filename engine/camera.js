import { add, scale, sub, normalize, cross, lookAt, perspective, multiply, invert, transform, clamp } from './math.js';

export class OrbitCamera {
  constructor({ target = [0, 1, 0], distance = 8, yaw = 0.7, pitch = 0.32, fov = 42 } = {}) {
    this.target = [...target];
    this.distance = distance;
    this.yaw = yaw;
    this.pitch = pitch;
    this.fov = fov * Math.PI / 180;
    this.update(1);
  }

  update(aspect) {
    const cp = Math.cos(this.pitch);
    const offset = [cp * Math.sin(this.yaw), Math.sin(this.pitch), cp * Math.cos(this.yaw)];
    this.eye = add(this.target, scale(offset, this.distance));
    this.view = lookAt(this.eye, this.target, [0, 1, 0]);
    this.proj = perspective(this.fov, aspect, 0.05, 300);
    this.viewProj = multiply(this.proj, this.view);
    this.invViewProj = invert(this.viewProj);
    this.forward = normalize(sub(this.target, this.eye));
    this.right = normalize(cross(this.forward, [0, 1, 0]));
    this.up = cross(this.right, this.forward);
    this.aspect = aspect;
  }

  orbit(dx, dy) {
    this.yaw -= dx * 0.006;
    this.pitch = clamp(this.pitch + dy * 0.006, 0.03, 1.45);
  }

  zoom(factor) { this.distance = clamp(this.distance * factor, 2, 80); }

  pan(dx, dy, mpp) {
    this.target = add(this.target, add(scale(this.right, -dx * mpp), scale(this.up, dy * mpp)));
    this.target[0] = clamp(this.target[0], -12, 12);
    this.target[1] = clamp(this.target[1], 0, 12);
    this.target[2] = clamp(this.target[2], -12, 12);
  }

  ray(x, y) {
    const far = transform(this.invViewProj, [x * 2 - 1, 1 - y * 2, 1, 1]);
    const p = [far[0] / far[3], far[1] / far[3], far[2] / far[3]];
    return { origin: [...this.eye], dir: normalize(sub(p, this.eye)) };
  }
}
