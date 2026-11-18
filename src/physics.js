// Car model. Pure functions, no rendering: runs identically in the browser and in the Node tests.
import { locate, lateral, wrap } from "./track.js";

export const CAR_R = 1.75;          // collision radius
export const CAR_HALF_W = 0.95;     // half track width of the car, for track limits

// Two car classes. Units: m/s, m/s^2. Grip = g0 + gk*v^2 (the v^2 term is downforce).
// Power (W/kg), drag and braking are real-world figures, so speeds and braking distances are realistic;
// the grip is set for a planted, confident feel at the limit.
export const CLASSES = {
  gt: { id: "gt", name: "Electric GT", g0: 14.5, gk: 0.0012, power: 345, traction: 13, drag: 0.0005, brake: 16, regen: 2.2, vtop: 89, margin: 0.84 },
  f1: { id: "f1", name: "Formula", g0: 18, gk: 0.0046, power: 930, traction: 12, drag: 0.00112, brake: 52, regen: 0.8, vtop: 94, margin: 0.88 },
  // late-1960s Grand Prix car: ~410 hp in ~500 kg, no wings, narrow tyres, drum-era braking. No hybrid, no active aero.
  // About 1.15 g everywhere (no downforce), so it slides: lateral grip builds slowly and the rear steps out under power.
  classic: { id: "classic", name: "Classic", g0: 11.5, gk: 0.0003, power: 600, traction: 7.5, drag: 0.00105, brake: 11, regen: 0.3, vtop: 82, margin: 0.8, noErs: true, noAero: true, loose: 1 },
};
export const gripOf = (cls, v) => cls.g0 + cls.gk * v * v;

export function makeCar(id, cls = CLASSES.gt) {
  return {
    id, cls, x: 0, z: 0, h: 0, vx: 0, vz: 0, w: 0, steer: 0, thr: 0, brk: 0,
    energy: 0.6, boosting: false, drs: false, tow: 0, slip: 0, sat: 0, surf: 0, // surf: 0 tarmac, 1 kerb, 2 grass/gravel
    idx: 0, lat: 0, total: 0, offT: 0, y: 0, bump: 0, speed: 0, wrong: 0, respawned: 0,
    dmg: { f: 0, r: 0, l: 0, rt: 0, e: 0 }, hits: [], retired: false, tl: false,
    // driver settings and car state: active aero, brake bias, ERS mode, tyre temperatures (FL, FR, RL, RR, deg C)
    aeroAuto: true, aeroReq: false, aeroOpen: false, bias: 0.56, ers: 1, tt: [86, 86, 84, 84], tg: [1, 1, 1, 1], aeroK: 0, lockF: 0, lockR: 0, overtake: false,
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
  // active aero (2026): Straight Mode opens the wings on the straights (less drag, less downforce);
  // it snaps back to Corner Mode the moment you brake or turn in. Auto, or manual on the driver's button.
  let straightAhead = true;
  for (let j = 0; j <= 66; j += 6) if (Math.abs(T.lk[wrap(c.idx + j, T.n)]) > 0.0035) { straightAhead = false; break; }
  const safe = (inp.thr || 0) > 0.85 && (inp.brk || 0) < 0.05 && Math.abs(c.steer) < 0.3 && v > 25 && c.surf < 2 && !c.retired;
  if ((inp.brk || 0) > 0.1 || Math.abs(c.steer) > 0.45) c.aeroReq = false; // braking or turning closes the flap, as on the real cars
  const wasOpen = c.aeroOpen;
  c.aeroOpen = !cls.noAero && safe && (c.aeroAuto ? straightAhead : c.aeroReq);
  c.aeroFlip = c.aeroOpen !== wasOpen;
  // the flap moves over ~0.3 s, so grip and drag blend instead of jumping (no twitch when it opens or closes)
  c.aeroK = clamp((c.aeroK || 0) + (c.aeroOpen ? dt : -2 * dt) / 0.3, 0, 1);
  const aeroDF = 1 - 0.3 * c.aeroK;
  // tyres: grip depends on temperature (window 85-110 C); weight transfer under braking loads the front
  const tg = c.tg, tyreF = (tg[0] + tg[1]) / 2, tyreAll = (tg[0] + tg[1] + tg[2] + tg[3]) / 4;
  const front = (perf ? 1 - 0.3 * D.f : 1) * tyreF / Math.max(tyreAll, 0.5);
  const Gnom = (cls.g0 + cls.gk * aeroDF * v * v) * tyreAll * (perf ? 1 - 0.12 * (D.f + D.r) * 0.5 : 1), G = Gnom * surfGrip;

  // inputs. Humans press keys, which are on/off: the wheel eases toward the key (quick first, settling at the end)
  // and the pedals ramp like a foot. Bots already send smooth inputs, so theirs go straight through.
  let st = clamp(inp.steer || 0, -1, 1);
  const tIn = c.retired ? 0 : clamp(inp.thr || 0, 0, 1), bIn = c.retired ? 0.35 : clamp(inp.brk || 0, 0, 1);
  const hi = clamp(v / 85, 0, 1);
  if (inp.direct) { c.steer = st; c.thr = tIn; c.brk = bIn; }
  else {
    const k = st === 0 ? 14 : st * c.steer < 0 ? 24 : 18 - 5 * hi;
    c.steer += (st - c.steer) * (1 - Math.exp(-k * dt));
    if (Math.abs(st - c.steer) < 0.003) c.steer = st;
    c.thr += clamp(tIn - c.thr, -12 * dt, 8 * dt); c.brk += clamp(bIn - c.brk, -14 * dt, 10 * dt);
  }
  const thr = c.thr, brk = c.brk;
  const pull = perf ? (D.rt - D.l) * 0.07 : 0; // bent suspension pulls toward the damaged side

  // ERS boost: harvested under braking and in a tow, deployed on demand
  // ERS: harvested under braking and in a tow, deployed on demand. Mode 0 harvest, 1 balanced, 2 attack.
  // Overtake mode (within a second of the car ahead at the detection line) adds deployment, as in 2026.
  const E = [{ rec: 1.6, mult: 1.18, use: 0.17 }, { rec: 1, mult: 1.32, use: 0.25 }, { rec: 0.65, mult: 1.45, use: 0.33 }][c.ers ?? 1];
  c.overtake = !!inp.drsOk;
  c.boosting = !cls.noErs && !!inp.boost && c.energy > 0.02 && thr > 0.3 && !c.retired;
  if (c.boosting) c.energy = Math.max(0, c.energy - E.use * (c.overtake ? 0.7 : 1) * dt);
  else c.energy = Math.min(1, c.energy + (0.025 + 0.24 * brk * (v > 12 ? 1 : 0) + 0.08 * c.tow) * E.rec * dt);
  c.drs = c.aeroOpen; // the rear flap is open (drawn on the car, and sent to other players)

  // yaw: the wheel asks for a yaw rate, capped by what the front tyres can hold at this speed
  const dir = vf >= 0 ? 1 : -1;
  // trail braking: brake pressure moves weight forward and the nose bites; a rearward brake bias rotates the car more;
  // throttle unloads the front (understeer on power)
  const bias = c.bias ?? 0.56;
  const wt = 1 + brk * (0.12 + (0.58 - bias) * 1.2);
  // lock-ups: brake bias decides which axle locks first when you brake hard, worst while you are also turning.
  // Forward bias locks the fronts (smoke, the car runs straight on: understeer); rearward bias locks the rears
  // (the tail steps out: the car rotates into the corner and can slide or spin). Neutral (~56%) locks nothing.
  const bk = clamp(brk * 1.25 - 0.25, 0, 1) * (v > 12 && c.surf < 2 ? 1 : 0), turn = Math.min(1, Math.abs(c.steer) / 0.55);
  const lockF = bk * clamp((bias - 0.565) / 0.035, 0, 1) * (0.35 + 0.65 * turn);
  const lockR = bk * clamp((0.548 - bias) / 0.035, 0, 1) * (0.2 + 0.8 * turn);
  c.lockF = lockF; c.lockR = lockR;
  const yawCap = Math.min(3.0, 1.0 * Gnom * front * wt * (1 - 0.7 * lockF) * (1 + 0.35 * lockR) / Math.max(v, 5)) * clamp(v / 2.5, 0, 1);
  const slipAng = Math.atan2(vl, Math.abs(vf) + 2);
  let wTarget = clamp(c.steer + pull, -1, 1) * yawCap * dir;
  wTarget += slipAng * (cls.loose ? 1.5 : 2.4) * clamp(v / 12, 0, 1) * clamp(c.sat * 4 - 3, 0, 1); // nose follows a slide back, near the limit only
  if (thr > 0.6 && v < 30 && c.surf !== 0) wTarget += c.steer * 0.3 * thr; // loose rear on kerbs and grass under power
  if (cls.loose && thr > 0.45 && v > 6) wTarget += c.steer * dir * 0.55 * cls.loose * clamp((thr - 0.45) / 0.55, 0, 1) * clamp(1.15 - v / 50, 0, 1); // classic: power oversteer out of slow corners
  if (lockR > 0.05) wTarget += c.w * 0.5 * lockR + c.steer * 0.25 * lockR * dir; // locked rears: the tail keeps coming round
  c.w += (wTarget - c.w) * (1 - Math.exp(-(19 + 4 * hi) * dt)); // yaw inertia: crisp at every speed
  c.h += c.w * dt;

  // longitudinal
  let acc = 0;
  const pmul = (c.boosting ? E.mult + (c.overtake ? 0.08 : 0) : 1) * (perf ? 1 - 0.35 * D.e : 1);
  if (thr > 0) acc += thr * Math.min(cls.traction * surfGrip, cls.power * pmul / Math.max(Math.abs(vf), 1));
  const regen = vf > 8 ? cls.regen * Math.max(0, 1 - thr * 6 - brk * 6) : 0; // lift-off regeneration / engine braking
  const drag = cls.drag * (1 - 0.28 * c.aeroK) * (1 - 0.35 * c.tow) * (perf ? 1 + 0.25 * D.f : 1) * v * v + extraDrag + 0.25 + regen;
  const brakeA = brk * Math.min(cls.brake, G) * (1 - 0.14 * c.lockF - 0.1 * c.lockR); // a locked tyre stops worse than a rolling one
  if (inp.reverse && vf < 2 && !c.retired) acc = -6 * surfGrip;
  if (T.gy) acc -= 9.81 * T.gy[c.idx]; // ramps: gravity slows you uphill and pushes you down the other side
  vf += acc * dt;
  const dec = (drag + (vf > 0 || !inp.reverse ? brakeA : 0)) * dt;
  if (Math.abs(vf) <= dec && acc === 0) vf = 0; else vf -= Math.sign(vf) * Math.min(Math.abs(vf), dec);
  if (inp.reverse && vf < -12) vf = -12;

  // lateral: tyres push back in proportion to sideways slip (cornering stiffness), up to the friction budget
  // that braking also draws on. So the nose turns in first, the car takes a small slip angle, then grip builds.
  const used = brakeA / Math.max(G, 1e-3);
  const budget = G * Math.sqrt(Math.max(0.3, 1 - 0.5 * used * used)) * (1 - 0.5 * c.lockR) * dt; // locked rears hold little sideways: a slide
  const fx2 = Math.cos(c.h), fz2 = Math.sin(c.h);
  const wvx = fx * vf + rx * vl, wvz = fz * vf + rz * vl;
  let nf = wvx * fx2 + wvz * fz2, nl = wvx * -fz2 + wvz * fx2;
  const want = -nl * (cls.loose ? 7 : 12) * dt, sat = Math.abs(want) / Math.max(budget, 1e-6);
  nl += clamp(want, -budget, budget); c.sat = sat;
  c.slip = Math.min(2, Math.max(Math.max(0, sat - 0.92) * 1.6, 0.9 * Math.max(c.lockF, c.lockR))); // smoke, marks and tyre squeal
  if (sat > 1) nf -= Math.sign(nf) * Math.min(Math.abs(nf), Math.abs(nl) * 0.8 * dt); // sliding scrubs speed
  c.vx = fx2 * nf - fz2 * nl; c.vz = fz2 * nf + fx2 * nl;
  c.x += c.vx * dt; c.z += c.vz * dt;
  c.speed = Math.hypot(c.vx, c.vz);

  // tyre temperatures: heat from cornering load (outside tyres most), braking (by bias), traction and sliding;
  // cooled by the air. Grip falls off outside the 85-110 C window.
  { const ay = c.w * c.speed, u = Math.min(1.5, Math.abs(ay) / Math.max(G, 1)), right = ay > 0, b = brakeA / Math.max(G, 1), a = Math.min(1, acc / Math.max(cls.traction, 1)), sl = c.slip;
    const drv = cls.id === "gt" ? [0.8, 0.8, 1, 1] : [0, 0, 1, 1];
    for (let k = 0; k < 4; k++) {
      const outer = (k % 2 === 0) === right ? 1.35 : 0.65, fr = k < 2;
      // heat ~ energy dissipated in the contact patch: lateral load x speed, braking load x speed, wheelspin, sliding
      const P = Math.abs(ay) * c.speed / (cls.g0 * 40), Pb = brakeA * c.speed / (cls.g0 * 40);
      const heat = 1.45 * (2.6 * P * outer + 2.2 * Pb * (fr ? bias : 1 - bias) * 2 + 1.5 * a * drv[k] + 4 * Math.min(sl, 1));
      const T0 = c.tt[k]; c.tt[k] = T0 + (heat - (T0 - 28) * (0.035 + c.speed * 0.0004)) * dt * 0.6; // thermal mass: temperatures move over seconds, not instantly
      const t = c.tt[k]; c.tg[k] = t < 85 ? Math.max(0.93, 1 - (85 - t) * 0.003) : t > 110 ? Math.max(0.9, 1 - (t - 110) * 0.004) : 1;
    }
  }

  // track position
  const prev = c.idx;
  c.idx = locate(T, c.x, c.z, c.idx);
  c.lat = lateral(T, c.idx, c.x, c.z);
  c.elev = T.y[c.idx]; // road height (the bridge at Suzuka)
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
  if (Math.abs((a.elev || 0) - (b.elev || 0)) > 3) return null; // one on the bridge, one under it
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
      if (o === c || Math.abs((o.elev || 0) - (c.elev || 0)) > 3) continue;
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
