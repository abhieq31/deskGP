// Car model. Pure functions, no rendering: runs identically in the browser and in the Node tests.
import { locate, lateral, wrap } from "./track.js";

export const CAR_R = 1.75;          // collision radius
export const CAR_HALF_W = 0.95;     // half track width of the car, for track limits

// Two car classes. Units: m/s, m/s^2. Grip = g0 + gk*v^2 (the v^2 term is downforce).
export const CLASSES = {
  gt: { id: "gt", name: "Electric GT", g0: 15.5, gk: 0.0024, power: 950, traction: 15.5, drag: 0.0019, brake: 26, regen: 3.0, vtop: 80, margin: 0.83 },
  f1: { id: "f1", name: "Formula", g0: 19, gk: 0.0044, power: 1300, traction: 14, drag: 0.0017, brake: 40, regen: 1.2, vtop: 92, margin: 0.88 },
};
export const gripOf = (cls, v) => cls.g0 + cls.gk * v * v;

export function makeCar(id, cls = CLASSES.gt) {
  return {
    id, cls, x: 0, z: 0, h: 0, vx: 0, vz: 0, w: 0, steer: 0, thr: 0, brk: 0,
    energy: 0.6, boosting: false, drs: false, tow: 0, slip: 0, sat: 0, surf: 0, // surf: 0 tarmac, 1 kerb, 2 grass/gravel
    idx: 0, lat: 0, total: 0, offT: 0, y: 0, bump: 0, speed: 0, wrong: 0, respawned: 0,
    dmg: { f: 0, r: 0, l: 0, rt: 0, e: 0 }, hits: [], retired: false, tl: false,
  };
}

export function placeCar(c, pose) {
  c.x = pose.x; c.z = pose.z; c.h = pose.h; c.vx = c.vz = c.w = c.steer = 0; c.y = 0; c.offT = 0; c.slip = 0;
  if (pose.i != null) c.idx = pose.i;
}

// Put a car back on the circuit at its last known track position (used when stuck or beached).
export function respawn(c, T) {
  const i = c.idx, o = Math.max(-T.half + 2, Math.min(T.half - 2, c.lat * 0.3));
  placeCar(c, { x: T.x[i] + T.nx[i] * o, z: T.z[i] + T.nz[i] * o, h: T.heading(i) });
  c.respawned = 1.5;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Record an impact: n = unit normal pointing from the obstacle into the car, a = closing speed (m/s).
// Converts it to a local hit point on the car and adds damage to that section.
function impact(c, nx, nz, a, mode) {
  if (a < 4 || !mode) return;
  const fx = Math.cos(c.h), fz = Math.sin(c.h);
  const lf = -(nx * fx + nz * fz), lr = -(nx * -fz + nz * fx); // where on the car the hit lands
  const amt = Math.min(1, Math.pow((a - 4) / 26, 1.3));
  c.hits.push({ lx: lf * 2.3, lz: lr * 1.0, a: amt });
  if (c.hits.length > 12) c.hits.shift();
  const d = c.dmg, add = amt * 0.9;
  if (Math.abs(lf) * 0.45 > Math.abs(lr)) { if (lf > 0) d.f = Math.min(1, d.f + add); else { d.r = Math.min(1, d.r + add); d.e = Math.min(1, d.e + add * 0.6); } }
  else if (lr > 0) d.rt = Math.min(1, d.rt + add * 0.8); else d.l = Math.min(1, d.l + add * 0.8);
  d.e = Math.min(1, d.e + add * 0.15);
  if (mode === 2 && (d.e >= 1 || d.f + d.r + d.l + d.rt >= 3.2)) c.retired = true;
}

// inp: {steer, thr, brk, boost, reverse, drsOk, direct}. opts: {damage: 0 off | 1 visual | 2 full}
export function stepCar(c, inp, dt, T, opts = {}) {
  const cls = c.cls, dm = opts.damage ?? 2;
  if (c.respawned > 0) c.respawned -= dt;
  const fx = Math.cos(c.h), fz = Math.sin(c.h), rx = -fz, rz = fx;
  let vf = c.vx * fx + c.vz * fz, vl = c.vx * rx + c.vz * rz;
  const v = Math.hypot(vf, vl);

  // surface
  const al = Math.abs(c.lat);
  let surfGrip = 1, extraDrag = 0; c.surf = 0;
  if (al > T.half + 1.6) { c.surf = 2; surfGrip = 0.6; extraDrag = 0.2 * v + 2; }
  else if (al > T.half - 0.5) { c.surf = 1; surfGrip = 0.94; }
  c.tl = al > T.half + CAR_HALF_W + 0.15; // all four wheels beyond the white line
  const D = c.dmg, perf = dm === 2;
  const front = perf ? 1 - 0.3 * D.f : 1;
  const Gnom = gripOf(cls, v) * (perf ? 1 - 0.12 * (D.f + D.r) * 0.5 : 1), G = Gnom * surfGrip;

  // inputs. Humans press keys, which are on/off: the wheel eases toward the key (quick first, settling at the end)
  // and the pedals ramp like a foot. Bots already send smooth inputs, so theirs go straight through.
  let st = clamp(inp.steer || 0, -1, 1);
  const tIn = c.retired ? 0 : clamp(inp.thr || 0, 0, 1), bIn = c.retired ? 0.35 : clamp(inp.brk || 0, 0, 1);
  const hi = clamp(v / 85, 0, 1);
  if (inp.direct) { c.steer = st; c.thr = tIn; c.brk = bIn; }
  else {
    const k = st === 0 ? 11 : st * c.steer < 0 ? 20 : 15 - 5 * hi;
    c.steer += (st - c.steer) * (1 - Math.exp(-k * dt));
    if (Math.abs(st - c.steer) < 0.003) c.steer = st;
    c.thr += clamp(tIn - c.thr, -12 * dt, 8 * dt); c.brk += clamp(bIn - c.brk, -14 * dt, 10 * dt);
  }
  const thr = c.thr, brk = c.brk;
  const pull = perf ? (D.rt - D.l) * 0.07 : 0; // bent suspension pulls toward the damaged side

  // ERS boost: harvested under braking and in a tow, deployed on demand
  c.boosting = !!inp.boost && c.energy > 0.02 && thr > 0.3 && !c.retired;
  if (c.boosting) c.energy = Math.max(0, c.energy - 0.25 * dt);
  else c.energy = Math.min(1, c.energy + (0.025 + 0.24 * brk * (v > 12 ? 1 : 0) + 0.08 * c.tow) * dt);
  c.drs = !!(T.drs[c.idx] && inp.drsOk && thr > 0.9 && brk < 0.05 && c.surf < 2 && !c.retired);

  // yaw: the wheel asks for a yaw rate, capped by what the front tyres can hold at this speed
  const dir = vf >= 0 ? 1 : -1;
  const yawCap = Math.min(3.0, 1.0 * Gnom * front / Math.max(v, 5)) * clamp(v / 2.5, 0, 1);
  const slipAng = Math.atan2(vl, Math.abs(vf) + 2);
  let wTarget = clamp(c.steer + pull, -1, 1) * yawCap * dir;
  wTarget += slipAng * 2.4 * clamp(v / 12, 0, 1) * clamp(c.sat * 4 - 3, 0, 1); // nose follows a slide back, near the limit only
  if (thr > 0.6 && v < 30 && c.surf !== 0) wTarget += c.steer * 0.3 * thr; // loose rear on kerbs and grass under power
  c.w += (wTarget - c.w) * (1 - Math.exp(-(22 - 6 * hi) * dt)); // yaw inertia: heavier at speed
  c.h += c.w * dt;

  // longitudinal
  let acc = 0;
  const pmul = (c.boosting ? 1.32 : 1) * (perf ? 1 - 0.35 * D.e : 1);
  if (thr > 0) acc += thr * Math.min(cls.traction * surfGrip, cls.power * pmul / Math.max(Math.abs(vf), 1));
  const regen = vf > 8 ? cls.regen * Math.max(0, 1 - thr * 6 - brk * 6) : 0; // lift-off regeneration / engine braking
  const drag = cls.drag * (c.drs ? 0.74 : 1) * (1 - 0.35 * c.tow) * (perf ? 1 + 0.25 * D.f : 1) * v * v + extraDrag + 0.25 + regen;
  const brakeA = brk * Math.min(cls.brake, G);
  if (inp.reverse && vf < 2 && !c.retired) acc = -6 * surfGrip;
  vf += acc * dt;
  const dec = (drag + (vf > 0 || !inp.reverse ? brakeA : 0)) * dt;
  if (Math.abs(vf) <= dec && acc === 0) vf = 0; else vf -= Math.sign(vf) * Math.min(Math.abs(vf), dec);
  if (inp.reverse && vf < -12) vf = -12;

  // lateral: tyres push back in proportion to sideways slip (cornering stiffness), up to the friction budget
  // that braking also draws on. So the nose turns in first, the car takes a small slip angle, then grip builds.
  const used = brakeA / Math.max(G, 1e-3);
  const budget = G * Math.sqrt(Math.max(0.3, 1 - 0.5 * used * used)) * dt;
  const fx2 = Math.cos(c.h), fz2 = Math.sin(c.h);
  const wvx = fx * vf + rx * vl, wvz = fz * vf + rz * vl;
  let nf = wvx * fx2 + wvz * fz2, nl = wvx * -fz2 + wvz * fx2;
  const want = -nl * 12 * dt, sat = Math.abs(want) / Math.max(budget, 1e-6);
  nl += clamp(want, -budget, budget); c.sat = sat;
  c.slip = Math.min(2, Math.max(0, sat - 0.92) * 1.6);
  if (sat > 1) nf -= Math.sign(nf) * Math.min(Math.abs(nf), Math.abs(nl) * 0.8 * dt); // sliding scrubs speed
  c.vx = fx2 * nf - fz2 * nl; c.vz = fz2 * nf + fx2 * nl;
  c.x += c.vx * dt; c.z += c.vz * dt;
  c.speed = Math.hypot(c.vx, c.vz);

  // track position
  const prev = c.idx;
  c.idx = locate(T, c.x, c.z, c.idx);
  c.lat = lateral(T, c.idx, c.x, c.z);
  // barriers
  const lim = (c.lat > 0 ? T.wp[c.idx] : T.wm[c.idx]) - 1.1;
  if (Math.abs(c.lat) > lim && Math.abs(c.lat) < lim + 12) {
    const sgn = Math.sign(c.lat), nx = T.nx[c.idx] * sgn, nz = T.nz[c.idx] * sgn, pen = Math.abs(c.lat) - lim;
    c.x -= nx * pen; c.z -= nz * pen; c.lat = sgn * lim;
    const vn = c.vx * nx + c.vz * nz;
    if (vn > 0) {
      const keep = 1 - Math.min(0.4, vn * 0.022);
      c.vx = (c.vx - 1.25 * vn * nx) * keep; c.vz = (c.vz - 1.25 * vn * nz) * keep;
      c.w += (Math.random() - 0.5) * Math.min(3, vn * 0.12); // a real hit spins you a little
      c.bump = Math.max(c.bump, Math.min(1, vn / 16));
      impact(c, -nx, -nz, vn, dm);
    }
  }
  let d = c.idx - prev; if (d < -T.n / 2) d += T.n; else if (d > T.n / 2) d -= T.n;
  c.total += d;
  c.wrong = (T.tx[c.idx] * c.vx + T.tz[c.idx] * c.vz) < -4 ? c.wrong + dt : 0;

  // beached far from the circuit for too long: back to the tarmac
  const far = Math.abs(c.lat) > T.half + 30 || Math.hypot(c.x - T.x[c.idx], c.z - T.z[c.idx]) > T.half + 34;
  c.offT = far ? c.offT + dt : 0;
  if (c.offT > 2.5) respawn(c, T);
}

// Car-to-car. If `bOwned` is false, b is a remote car: only a moves (b's owner resolves the other half).
// Returns null, or {hit, rvn, nx, nz} with n pointing from b to a.
export function collideCars(a, b, bOwned, opts = {}) {
  if (a.respawned > 0 || b.respawned > 0) return null;
  const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz), rr = CAR_R * 2;
  if (d >= rr || d === 0) return null;
  const nx = dx / d, nz = dz / d, pen = rr - d, dm = opts.damage ?? 2;
  const rvn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  a.x += nx * pen * 0.5; a.z += nz * pen * 0.5;
  if (bOwned) { b.x -= nx * pen * 0.5; b.z -= nz * pen * 0.5; }
  if (rvn < 0) {
    const j = -0.6 * rvn; a.vx += j * nx; a.vz += j * nz; if (bOwned) { b.vx -= j * nx; b.vz -= j * nz; }
    impact(a, nx, nz, -rvn * 0.9, dm); if (bOwned) impact(b, -nx, -nz, -rvn * 0.9, dm);
  }
  const hit = rvn < 0 ? Math.min(1, -rvn / 14) : 0;
  a.bump = Math.max(a.bump, hit); if (bOwned) b.bump = Math.max(b.bump, hit);
  return { hit, rvn, nx, nz };
}

// Slipstream: a tow behind any car close ahead and roughly in line.
export function updateTow(c, cars) {
  let tow = 0;
  const sp = c.speed;
  if (sp > 18) {
    const ux = c.vx / sp, uz = c.vz / sp;
    for (const o of cars) {
      if (o === c) continue;
      const dx = o.x - c.x, dz = o.z - c.z, along = dx * ux + dz * uz;
      if (along < 2 || along > 46) continue;
      const side = Math.abs(-dx * uz + dz * ux), wdt = 2.4 + along * 0.06;
      if (side < wdt) tow = Math.max(tow, (1 - along / 46) * (1 - side / wdt) * 1.25);
    }
  }
  c.tow += (Math.min(1, tow) - c.tow) * 0.08;
}

export const totalDamage = (c) => (c.dmg.f + c.dmg.r + c.dmg.l + c.dmg.rt) / 4;
export { clamp, wrap };
