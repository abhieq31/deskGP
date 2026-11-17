// Car model. Pure functions, no rendering: runs identically in the browser and in the Node tests.
import { DESK, gripAt, locate, lateral, wrap } from "./track.js";

export const CAR_R = 1.75;         // collision radius
export const DRAG = 0.0016;        // aero drag coefficient (per unit mass)
export const POWER = 1150;         // engine power per unit mass
export const TRACTION = 15;        // low-speed traction limit (m/s^2)
export const VMAX_DISPLAY = 3.6;   // m/s -> km/h

export function makeCar(id) {
  return {
    id, x: 0, z: 0, h: 0, vx: 0, vz: 0, w: 0, steer: 0, thr: 0, brk: 0,
    energy: 0.5, boosting: false, drs: false, tow: 0, slip: 0, surf: 0, // surf: 0 tarmac, 1 kerb, 2 off, 3 spill
    idx: 0, lat: 0, total: 0, offT: 0, fall: 0, y: 0, padT: 0, bump: 0, speed: 0, wrong: 0,
  };
}

export function placeCar(c, pose, T) {
  c.x = pose.x; c.z = pose.z; c.h = pose.h; c.vx = c.vz = c.w = c.steer = 0; c.fall = 0; c.y = 0; c.offT = 0; c.slip = 0;
  if (pose.i != null) c.idx = pose.i;
}

// Put a car back on the tarmac at its last known track position.
export function respawn(c, T) {
  const i = c.idx;
  placeCar(c, { x: T.x[i], z: T.z[i], h: T.heading(i) }, T);
  c.respawned = 1.2;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function stepCar(c, inp, dt, T) {
  if (c.respawned > 0) c.respawned -= dt;
  if (c.fall > 0) { // tumbling off the desk
    c.fall += dt; c.y -= (4 + c.fall * 60) * dt; c.x += c.vx * dt; c.z += c.vz * dt; c.h += c.w * dt;
    if (c.fall > 1.3) respawn(c, T);
    c.speed = Math.hypot(c.vx, c.vz);
    return;
  }
  const fx = Math.cos(c.h), fz = Math.sin(c.h), rx = -fz, rz = fx;
  let vf = c.vx * fx + c.vz * fz, vl = c.vx * rx + c.vz * rz;
  const v = Math.hypot(vf, vl);

  // surface
  const al = Math.abs(c.lat);
  let surfGrip = 1, extraDrag = 0; c.surf = 0;
  if (al > T.half + 1.6) { c.surf = 2; surfGrip = 0.58; extraDrag = 0.24 * v; }
  else if (al > T.half - 0.6) { c.surf = 1; surfGrip = 0.93; }
  for (const s of T.spills) { const dx = c.x - s.x, dz = c.z - s.z; if (dx * dx + dz * dz < s.r * s.r) { c.surf = 3; surfGrip = Math.min(surfGrip, 0.42); } }
  const Gnom = gripAt(v), G = Gnom * surfGrip;

  // inputs
  const thr = clamp(inp.thr || 0, 0, 1), brk = clamp(inp.brk || 0, 0, 1);
  const st = clamp(inp.steer || 0, -1, 1);
  const rate = (Math.abs(st) > Math.abs(c.steer) ? 5.5 : 9) * dt;
  c.steer += clamp(st - c.steer, -rate, rate);
  c.thr = thr; c.brk = brk;

  // boost ("caffeine") and DRS
  c.boosting = !!inp.boost && c.energy > 0.02 && thr > 0.3;
  if (c.boosting) c.energy = Math.max(0, c.energy - 0.27 * dt);
  else c.energy = Math.min(1, c.energy + (0.03 + 0.22 * brk * (v > 12 ? 1 : 0) + 0.1 * c.tow + 0.1 * Math.min(1, c.slip)) * dt);
  c.drs = !!(T.drs[c.idx] && inp.drsOk && thr > 0.9 && brk === 0 && c.surf < 2);
  if (c.padT > 0) c.padT -= dt;

  // yaw: steering asks for a yaw rate, capped by what the tyres could hold on clean tarmac
  const dir = vf >= 0 ? 1 : -1;
  const yawCap = Math.min(2.7, 0.97 * Gnom / Math.max(v, 5)) * clamp(v / 4, 0, 1);
  const slipAng = Math.atan2(vl, Math.abs(vf) + 2);
  let wTarget = c.steer * yawCap * dir;
  wTarget += slipAng * 2.2 * clamp(v / 12, 0, 1);            // self-aligning: nose follows the slide back
  if (thr > 0.6 && v < 34 && c.surf !== 0) wTarget += c.steer * 0.35 * thr; // loose rear on kerbs/dirt under power
  c.w += (wTarget - c.w) * Math.min(1, 14 * dt);
  c.h += c.w * dt;

  // longitudinal
  let acc = 0;
  const pmul = (c.boosting ? 1.4 : 1) * (c.padT > 0 ? 1.5 : 1);
  if (thr > 0) acc += thr * Math.min(TRACTION * surfGrip * (c.padT > 0 ? 1.4 : 1), POWER * pmul / Math.max(Math.abs(vf), 1));
  const drag = DRAG * (c.drs ? 0.74 : 1) * (1 - 0.38 * c.tow) * v * v + extraDrag + 0.25;
  const brakeA = brk * Math.min(30, G);
  if (inp.reverse && vf < 2) acc = -6 * surfGrip; // gentle reverse
  vf += acc * dt;
  const dec = (drag + (vf > 0 || !inp.reverse ? brakeA : 0)) * dt;
  if (Math.abs(vf) <= dec && acc === 0) vf = 0; else vf -= Math.sign(vf) * Math.min(Math.abs(vf), dec);
  if (inp.reverse && vf < -12) vf = -12;

  // lateral: tyres cancel sideways velocity up to the friction budget (shared with braking)
  const used = brakeA / Math.max(G, 1e-3);
  const budget = G * Math.sqrt(Math.max(0.12, 1 - 0.7 * used * used)) * dt;
  // After h rotated this step, re-project velocity on the new axes
  const fx2 = Math.cos(c.h), fz2 = Math.sin(c.h);
  const wvx = fx * vf + rx * vl, wvz = fz * vf + rz * vl;
  let nf = wvx * fx2 + wvz * fz2, nl = wvx * -fz2 + wvz * fx2;
  const kill = clamp(-nl, -budget, budget);
  nl += kill;
  c.slip = Math.abs(nl) / 6;
  if (Math.abs(nl) > 0.5) nf -= Math.sign(nf) * Math.min(Math.abs(nf), Math.abs(nl) * 0.9 * dt); // sliding scrubs speed
  c.vx = fx2 * nf - fz2 * nl; c.vz = fz2 * nf + fx2 * nl;
  c.x += c.vx * dt; c.z += c.vz * dt;
  c.speed = Math.hypot(c.vx, c.vz);

  // props
  for (const p of T.colliders) collideProp(c, p);

  // desk edge
  if (Math.abs(c.x) > DESK.hx + 1 || Math.abs(c.z) > DESK.hz + 1) { c.fall = 0.001; c.w = (Math.random() - 0.5) * 8; }

  // track position and progress
  const prev = c.idx;
  c.idx = locate(T, c.x, c.z, c.idx);
  c.lat = lateral(T, c.idx, c.x, c.z);
  let d = c.idx - prev; if (d < -T.n / 2) d += T.n; else if (d > T.n / 2) d -= T.n;
  c.total += d;
  c.wrong = (T.tx[c.idx] * c.vx + T.tz[c.idx] * c.vz) < -4 ? c.wrong + dt : 0;

  // boost pads
  for (const p of T.pads) { const dx = c.x - p.x, dz = c.z - p.z; if (dx * dx + dz * dz < 30 && c.padT <= 0) { c.padT = 0.9; c.padHit = true; } }

  // too far from the circuit for too long: back to the tarmac
  const far = Math.abs(c.lat) > T.half + 30 || Math.hypot(c.x - T.x[c.idx], c.z - T.z[c.idx]) > T.half + 34;
  c.offT = far ? c.offT + dt : 0;
  if (c.offT > 2.5) respawn(c, T);
}

function collideProp(c, p) {
  let nx, nz, pen;
  if (p.c) {
    const dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz), rr = p.r + CAR_R;
    if (d >= rr || d === 0) return;
    nx = dx / d; nz = dz / d; pen = rr - d;
  } else {
    const dx = c.x - p.x, dz = c.z - p.z;
    const lx = dx * p.cos + dz * p.sin, lz = -dx * p.sin + dz * p.cos;
    const qx = clamp(lx, -p.hw, p.hw), qz = clamp(lz, -p.hd, p.hd);
    let ex = lx - qx, ez = lz - qz, d = Math.hypot(ex, ez);
    if (d >= CAR_R) return;
    if (d === 0) { // centre inside the box: push out through the nearest face
      const ox = p.hw - Math.abs(lx), oz = p.hd - Math.abs(lz);
      if (ox < oz) { ex = Math.sign(lx) || 1; ez = 0; pen = ox + CAR_R; } else { ex = 0; ez = Math.sign(lz) || 1; pen = oz + CAR_R; }
    } else { ex /= d; ez /= d; pen = CAR_R - d; }
    nx = ex * p.cos - ez * p.sin; nz = ex * p.sin + ez * p.cos;
  }
  c.x += nx * pen; c.z += nz * pen;
  const vn = c.vx * nx + c.vz * nz;
  if (vn < 0) {
    c.vx -= 1.3 * vn * nx; c.vz -= 1.3 * vn * nz;
    c.vx *= 0.94; c.vz *= 0.94;
    c.bump = Math.max(c.bump, Math.min(1, -vn / 20));
  }
}

// Car-to-car. If `bOwned` is false, b is a remote ghost: only a moves (its owner resolves the other half).
export function collideCars(a, b, bOwned) {
  if (a.fall > 0 || b.fall > 0 || a.respawned > 0 || b.respawned > 0) return 0;
  const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz), rr = CAR_R * 2;
  if (d >= rr || d === 0) return 0;
  const nx = dx / d, nz = dz / d, pen = rr - d;
  const rvn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  if (bOwned) {
    a.x += nx * pen * 0.5; a.z += nz * pen * 0.5; b.x -= nx * pen * 0.5; b.z -= nz * pen * 0.5;
    if (rvn < 0) { const j = -0.62 * rvn; a.vx += j * nx; a.vz += j * nz; b.vx -= j * nx; b.vz -= j * nz; }
  } else {
    a.x += nx * pen * 0.5; a.z += nz * pen * 0.5;
    if (rvn < 0) { const j = -0.62 * rvn; a.vx += j * nx; a.vz += j * nz; }
  }
  const hit = rvn < 0 ? Math.min(1, -rvn / 14) : 0;
  a.bump = Math.max(a.bump, hit); if (bOwned) b.bump = Math.max(b.bump, hit);
  return hit;
}

// Slipstream and DRS eligibility for car c given every car on track.
export function updateTow(c, cars, T) {
  let tow = 0, drsOk = false;
  const sp = c.speed;
  if (sp > 18) {
    const ux = c.vx / sp, uz = c.vz / sp;
    for (const o of cars) {
      if (o === c || o.fall > 0) continue;
      const dx = o.x - c.x, dz = o.z - c.z, along = dx * ux + dz * uz;
      if (along < 2 || along > 70) continue;
      const side = Math.abs(-dx * uz + dz * ux);
      if (along < 46 && side < 2.4 + along * 0.06) tow = Math.max(tow, (1 - along / 46) * (1 - side / (2.4 + along * 0.06)) * 1.25);
      if (side < 16) drsOk = true;
    }
  }
  c.tow += (Math.min(1, tow) - c.tow) * 0.08;
  return drsOk;
}

export const gearOf = (v) => clamp(Math.floor(Math.pow(Math.max(v, 0) / 100, 0.8) * 8) + 1, 1, 8);
export function rpmOf(v) { // 0..1 within the current gear
  const g = gearOf(v), lo = Math.pow((g - 1) / 8, 1.25) * 100, hi = Math.pow(g / 8, 1.25) * 100;
  return clamp(0.35 + 0.65 * (v - lo) / (hi - lo), 0.12, 1);
}
export { clamp, wrap };
