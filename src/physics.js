// Car model. Pure functions, no rendering: runs identically in the browser and in the Node tests.
import { locate, lateral, wrap } from "./track.js";

export const CAR_R = 1.75;          // collision radius
export const CAR_HALF_W = 0.95;     // half track width of the car, for track limits

// Two car classes, with real-world numbers (per unit mass, so forces are accelerations in m/s^2).
//  mu: tyre friction; df: downforce per v^2 (adds normal load, so grip = mu * (g + df v^2));
//  power: W/kg; drag: aero drag per v^2; L: wheelbase; a: CG to front axle; h: CG height; k2: yaw radius of gyration^2;
//  drive: [front, rear] torque split; bias: front brake share; peak: slip angle of peak grip (rad); lock: max road-wheel angle.
//  Electric GT ~ a 760 kW, 2.2 t four-door on track tyres. Formula ~ 750 kW, 800 kg single-seater on slicks.
export const CLASSES = {
  gt: { id: "gt", name: "Electric GT", mu: 1.25, df: 0.00044, power: 345, drag: 0.00050, roll: 0.15, L: 2.96, a: 1.45, h: 0.46, k2: 1.55, drive: [0.4, 0.6], bias: 0.62, brakeMax: 16, regen: 2.2, peak: 0.12, lock: 0.52, abs: true, tc: 0.97, aeroF: 0.45, rg: 1.22, sk: 0.6, vtop: 89, margin: 0.77 },
  f1: { id: "f1", name: "Formula", mu: 1.75, df: 0.00284, power: 930, drag: 0.00112, roll: 0.12, L: 3.6, a: 1.98, h: 0.30, k2: 1.3, drive: [0, 1], bias: 0.57, brakeMax: 58, regen: 0.8, peak: 0.09, lock: 0.38, abs: false, tc: 0.95, aeroF: 0.42, rg: 1.2, sk: 0.3, vtop: 94, margin: 0.88 },
};
for (const c of Object.values(CLASSES)) { c.g0 = c.mu * 9.81; c.gk = c.mu * c.df; c.b = c.L - c.a; c.brake = c.brakeMax; c.k2 = 0.95 * c.a * c.b; } // yaw inertia of a real car: dynamic index ~0.95
export const gripOf = (cls, v) => cls.g0 + cls.gk * v * v;
// Road-wheel angle for a full key press: enough to reach peak front slip while cornering on the limit at this
// speed, never more. So a held key is the limit (as a driver would steer), a tap is a fraction of it.
export const steerLimit = (cls, v) => Math.min(cls.lock, cls.L * gripOf(cls, v) / Math.max(v * v, 1) + cls.peak * cls.sk);
const pac = (alpha, peak) => Math.sin(1.4 * Math.atan(alpha * (2.07 / peak))); // simplified Pacejka: peak 1, slide ~0.9

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
  if (al > T.half + 1.6) { c.surf = 2; surfGrip = 0.55; extraDrag = 0.12 * v + 1.5; }
  else if (al > T.half - 0.5) { c.surf = 1; surfGrip = 0.94; }
  c.tl = al > T.half + CAR_HALF_W + 0.15; // all four wheels beyond the white line
  const D = c.dmg, perf = dm === 2;
  const front = perf ? 1 - 0.3 * D.f : 1;
  const Gnom = gripOf(cls, v) * (perf ? 1 - 0.12 * (D.f + D.r) * 0.5 : 1), G = Gnom * surfGrip;

  // inputs. Humans press keys, which are on/off: the wheel eases toward the key (quick first, settling at the end)
  // and the pedals ramp like a foot. Bots and analog pads already send smooth inputs, so theirs go straight through.
  let st = clamp(inp.steer || 0, -1, 1);
  const tIn = c.retired ? 0 : clamp(inp.thr || 0, 0, 1), bIn = c.retired ? 0.35 : clamp(inp.brk || 0, 0, 1);
  const hi = clamp(v / 85, 0, 1);
  if (inp.direct) { c.steer = st; c.thr = tIn; c.brk = bIn; }
  else {
    const k = st === 0 ? 11 : st * c.steer < 0 ? 20 : 14 - 8.5 * hi; // at 300 km/h a driver winds the wheel on over ~0.2 s
    c.steer += (st - c.steer) * (1 - Math.exp(-k * dt));
    if (Math.abs(st - c.steer) < 0.003) c.steer = st;
    c.thr += clamp(tIn - c.thr, -12 * dt, 8 * dt); c.brk += clamp(bIn - c.brk, -14 * dt, 10 * dt);
  }
  const thr = c.thr, brk = c.brk;
  const pull = perf ? (D.rt - D.l) * 0.012 : 0; // bent suspension pulls toward the damaged side (rad)

  // ERS boost: harvested under braking and in a tow, deployed on demand
  c.boosting = !!inp.boost && c.energy > 0.02 && thr > 0.3 && !c.retired;
  if (c.boosting) c.energy = Math.max(0, c.energy - 0.25 * dt);
  else c.energy = Math.min(1, c.energy + (0.025 + 0.24 * brk * (v > 12 ? 1 : 0) + 0.08 * c.tow) * dt);
  c.drs = !!(T.drs[c.idx] && inp.drsOk && thr > 0.9 && brk < 0.05 && c.surf < 2 && !c.retired);

  // ---- two-axle (bicycle) model: each axle's tyre force comes from its own slip angle and load ----
  const g = 9.81, L = cls.L, A = cls.a, B = cls.b, mu = cls.mu * surfGrip;
  const dfK = cls.df * (perf ? 1 - 0.25 * D.f : 1) * (c.drs ? 0.85 : 1);
  const pmul = (c.boosting ? 1.32 : 1) * (perf ? 1 - 0.35 * D.e : 1);
  const dragK = cls.drag * (c.drs ? 0.82 : 1) * (1 - 0.3 * c.tow) * (perf ? 1 + 0.2 * D.f : 1);
  const fwdF = perf ? 1 - 0.3 * D.f : 1;
  let vx = vf, vy = vl, r = c.w;
  const subs = v < 12 ? 4 : 2, h = dt / subs;
  let slipF = 0, slipR = 0, lockF = false, spinR = false;
  for (let s = 0; s < subs; s++) {
    const sp = Math.hypot(vx, vy), dmax = steerLimit(cls, sp), delta = clamp(c.steer * dmax + pull, -cls.lock, cls.lock), sg = vx >= 0 ? 1 : -1;
    // loads per axle (static + downforce + longitudinal weight transfer)
    const v2 = vx * vx, ax0 = c.axF || 0;
    const Fzf = Math.max(0.5, g * B / L + dfK * v2 * cls.aeroF - ax0 * cls.h / L);
    const Fzr = Math.max(0.5, g * A / L + dfK * v2 * (1 - cls.aeroF) + ax0 * cls.h / L);
    const Df = mu * Fzf * fwdF, Dr = mu * Fzr * cls.rg; // wider rear tyres: a car built to understeer a little, never to spin on its own
    // longitudinal requests: drive (power-limited, split per axle), brakes (with bias), lift-off regen
    let drive = 0;
    if (inp.reverse && vx < 2 && !c.retired) drive = -5 * surfGrip;
    else if (thr > 0) drive = thr * cls.power * pmul / Math.max(Math.abs(vx), 2);
    const brakeA = brk * cls.brakeMax, regen = vx > 8 ? cls.regen * Math.max(0, 1 - thr * 6 - brk * 6) : 0;
    let Fxf = drive * cls.drive[0] - sg * (brakeA * cls.bias + regen * 0.5);
    let Fxr = drive * cls.drive[1] - sg * (brakeA * (1 - cls.bias) + regen * 0.5);
    if (Math.abs(vx) < 0.5 && thr === 0 && !inp.reverse) { Fxf = -vx * 4; Fxr = 0; } // stop cleanly
    // friction circle per axle: ABS/traction control hold just under the limit; past it a tyre locks or spins
    // ABS and traction control (keyboard players cannot modulate pedals): they keep the grip the tyre is already
    // using for cornering, so braking into a turn still steers and full throttle out of one does not spin you
    const keepF = c.fyf || 0, keepR = c.fyr || 0;
    const capF = Fxf < 0 ? Math.sqrt(Math.max(0.09 * Df * Df, Df * Df - keepF * keepF)) * 0.97 : Df;
    const capR = Fxr > 0 ? Math.sqrt(Math.max(0.09 * Dr * Dr, Dr * Dr - keepR * keepR)) * cls.tc : Math.sqrt(Math.max(0.09 * Dr * Dr, Dr * Dr - keepR * keepR)) * 0.97;
    if (Math.abs(Fxf) > capF) { lockF = brk > 0.95 && v > 25 && !cls.abs; Fxf = Math.sign(Fxf) * capF; }
    if (Math.abs(Fxr) > capR) { spinR = Fxr > 0 && thr > 0.9; Fxr = Math.sign(Fxr) * capR; }
    let Dyf = Math.sqrt(Math.max(0, Df * Df - Fxf * Fxf)), Dyr = Math.sqrt(Math.max(0, Dr * Dr - Fxr * Fxr));
    Dyf = Math.max(Dyf, Df * 0.18); Dyr = Math.max(Dyr, Dr * 0.18);
    // slip angles and lateral forces
    let Fyf, Fyr;
    if (Math.abs(vx) < 2.5) { // parking speed: rolling without slip
      const rk = vx * Math.tan(delta) / L; r += (rk - r) * Math.min(1, 12 * h); vy *= Math.exp(-8 * h); Fyf = Fyr = 0;
    } else {
      const af = Math.atan2(vy + A * r, Math.abs(vx)) - delta * sg, ar = Math.atan2(vy - B * r, Math.abs(vx));
      Fyf = -Dyf * pac(af, cls.peak); Fyr = -Dyr * pac(ar, cls.peak); c.fyf = Fyf; c.fyr = Fyr;
      slipF = Math.max(slipF, Math.abs(af) / cls.peak); slipR = Math.max(slipR, Math.abs(ar) / cls.peak);
      const cd = Math.cos(delta), sd = Math.sin(delta);
      r += ((A * (Fyf * cd + Fxf * sd) - B * Fyr) / cls.k2) * h;
      vy += (Fxf * sd + Fyf * cd + Fyr - vx * r) * h;
    }
    const resist = dragK * (vx * vx + vy * vy) + cls.roll + extraDrag;
    const ax = Fxf * Math.cos(delta) - (Fyf || 0) * Math.sin(delta) + Fxr;
    vx += (ax - Math.sign(vx) * resist + vy * r) * h;
    if (Math.abs(vx) < 0.05 && thr === 0 && !inp.reverse) vx = 0;
    if (inp.reverse && vx < -12) vx = -12;
    c.axF = (c.axF || 0) + (ax - (c.axF || 0)) * Math.min(1, 10 * h); // filtered, for weight transfer
    c.h += r * h;
  }
  c.w = r; c.lockF = lockF; c.spinR = spinR;
  c.sat = Math.max(slipF, slipR) / 1.0;
  c.slip = Math.min(2, Math.max(0, slipR - 1.05) * 1.2 + Math.max(0, slipF - 1.4) * 0.6 + (lockF ? 0.8 : 0) + (spinR && v > 4 ? 0.5 : 0));
  const fx2 = Math.cos(c.h), fz2 = Math.sin(c.h);
  c.vx = fx2 * vx - fz2 * vy; c.vz = fz2 * vx + fx2 * vy;
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
