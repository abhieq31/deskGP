// Track geometry: closed spline -> uniform samples, racing line, speed profile, lookups.
// Plane coordinates are (x, z). Heading h: forward = (cos h, sin h). "Right" = (-sin h, cos h).

// Units are metres. The circuits are real F1 layouts (see circuits.js).
import { CIRCUITS } from "./circuits.js";
export const STEP = 2;
export const TRACKS = CIRCUITS;
const boxOf = (xs, zs) => { let hx = 0, hz = 0; for (let i = 0; i < xs.length; i++) { hx = Math.max(hx, Math.abs(xs[i])); hz = Math.max(hz, Math.abs(zs[i])); } return { hx: hx + 40, hz: hz + 40 }; };
// Cheap outline for menus and minimaps (no racing line, no barriers).
export function outlineOf(def) {
  if (def._outline) return def._outline;
  const P = def.pts, m = P.length, x = [], z = [];
  for (let i = 0; i < m; i++) for (let j = 0; j < 6; j++) { const q = catmull(P[wrap(i - 1, m)], P[i], P[wrap(i + 1, m)], P[wrap(i + 2, m)], j / 6); x.push(q[0]); z.push(q[1]); }
  const n = x.length, o = { def, x, z, n, box: boxOf(x, z), drsIdx: null };
  return (def._outline = o);
}

function catmull(p0, p1, p2, p3, t) {
  // centripetal Catmull-Rom (Barry-Goldman)
  const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-3;
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const L = (a, b, ta, tb) => [a[0] + (b[0] - a[0]) * (tt - ta) / (tb - ta), a[1] + (b[1] - a[1]) * (tt - ta) / (tb - ta)];
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}

const wrap = (i, n) => ((i % n) + n) % n;

function smoothCyclic(a, r, passes = 1) {
  const n = a.length; let src = a;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = -r; j <= r; j++) s += src[wrap(i + j, n)]; out[i] = s / (2 * r + 1); }
    src = out;
  }
  return src;
}

export function buildTrack(def) {
  const P = def.pts, m = P.length, dense = [];
  for (let i = 0; i < m; i++) {
    const p0 = P[wrap(i - 1, m)], p1 = P[i], p2 = P[wrap(i + 1, m)], p3 = P[wrap(i + 2, m)];
    for (let j = 0; j < 48; j++) dense.push(catmull(p0, p1, p2, p3, j / 48));
  }
  // arc-length resample
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[dense.length];
  const n = Math.round(total / STEP), step = total / n;
  const x = new Float32Array(n), z = new Float32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = i * step;
    while (cum[k + 1] < s) k++;
    const f = (s - cum[k]) / (cum[k + 1] - cum[k] || 1), a = dense[k], b = dense[(k + 1) % dense.length];
    x[i] = a[0] + (b[0] - a[0]) * f; z[i] = a[1] + (b[1] - a[1]) * f;
  }
  const T = { def, id: def.id, n, step, len: total, width: def.width, half: def.width / 2, x, z };
  const frame = (px, pz) => {
    const tx = new Float32Array(n), tz = new Float32Array(n), kk = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = wrap(i - 1, n), b = wrap(i + 1, n);
      const dx = px[b] - px[a], dz = pz[b] - pz[a], l = Math.hypot(dx, dz) || 1;
      tx[i] = dx / l; tz[i] = dz / l;
    }
    for (let i = 0; i < n; i++) {
      const a = wrap(i - 1, n), b = wrap(i + 1, n);
      const cr = tx[a] * tz[b] - tz[a] * tx[b], dt = tx[a] * tx[b] + tz[a] * tz[b];
      const ds = Math.hypot(px[b] - px[a], pz[b] - pz[a]) || 1;
      kk[i] = Math.atan2(cr, dt) / ds; // signed curvature: + turns toward "right" (increasing heading)
    }
    return { tx, tz, k: smoothCyclic(kk, 3, 2) };
  };
  const f = frame(x, z);
  T.tx = f.tx; T.tz = f.tz; T.k = f.k;
  T.nx = new Float32Array(n); T.nz = new Float32Array(n);
  for (let i = 0; i < n; i++) { T.nx[i] = -T.tz[i]; T.nz[i] = T.tx[i]; }

  // Elevation. Flat (0) everywhere, except on a circuit that crosses itself (Suzuka's figure of eight): there one
  // stretch climbs on smooth ramps to a bridge over the other. T.y = road height (m), T.gy = gradient along the lap.
  T.y = new Float32Array(n); T.gy = null; T.cross = null;
  if (def.crossover) {
    let best = Infinity, bi = 0, bj = 0;
    for (let i = 0; i < n; i++) for (let j = i + 150; j < n; j++) { if (n - j + i < 150) continue; const d = (x[i] - x[j]) ** 2 + (z[i] - z[j]) ** 2; if (d < best) { best = d; bi = i; bj = j; } }
    const up = def.crossover === "first" ? bi : bj, low = up === bi ? bj : bi;
    const sinA = Math.abs(T.tx[up] * T.tz[low] - T.tz[up] * T.tx[low]);
    // the deck spans the lower road and its run-off on both sides; then 160 m ramps (about 6% at the steepest)
    const H = 8, flat = Math.min(110, (T.half + 26) / Math.max(sinA, 0.35)), ramp = 160;
    for (let k = -Math.ceil((flat + ramp) / step); k <= Math.ceil((flat + ramp) / step); k++) {
      const sd = Math.abs(k) * step, u = Math.min(1, Math.max(0, (sd - flat) / ramp));
      T.y[wrap(up + k, n)] = H * (1 - u * u * (3 - 2 * u));
    }
    T.gy = new Float32Array(n);
    for (let i = 0; i < n; i++) T.gy[i] = (T.y[wrap(i + 1, n)] - T.y[wrap(i - 1, n)]) / (2 * step);
    T.cross = { up, low, flat, ramp, H, sinA, dist: Math.sqrt(best) };
  }
  // two samples are on different levels (one on the bridge, one under it): they never interact
  T.apart = (i, j) => Math.abs(T.y[i] - T.y[j]) > 3;

  // Racing line: minimise curvature of the offset path inside the track limits.
  const C = 4, cn = Math.floor(n / C), lim = T.half - 1.7;
  const off = new Float32Array(cn);
  const px = (j) => x[j * C] + T.nx[j * C] * off[j], pz = (j) => z[j * C] + T.nz[j * C] * off[j];
  for (let it = 0; it < 2500; it++) {
    for (let j = 0; j < cn; j++) {
      const a = wrap(j - 1, cn), b = wrap(j + 1, cn), a2 = wrap(j - 2, cn), b2 = wrap(j + 2, cn);
      const gx = (4 * (px(a) + px(b)) - (px(a2) + px(b2))) / 6, gz = (4 * (pz(a) + pz(b)) - (pz(a2) + pz(b2))) / 6;
      const o = (gx - x[j * C]) * T.nx[j * C] + (gz - z[j * C]) * T.nz[j * C];
      off[j] += (Math.max(-lim, Math.min(lim, o)) - off[j]) * 0.6;
    }
  }
  let lo = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = Math.floor(i / C), fr = (i - j * C) / C;
    lo[i] = off[wrap(j, cn)] * (1 - fr) + off[wrap(j + 1, cn)] * fr;
  }
  lo = smoothCyclic(lo, 4, 2);
  T.lo = lo;
  T.lx = new Float32Array(n); T.lz = new Float32Array(n);
  for (let i = 0; i < n; i++) { T.lx[i] = x[i] + T.nx[i] * lo[i]; T.lz[i] = z[i] + T.nz[i] * lo[i]; }
  const lf = frame(T.lx, T.lz);
  T.lk = smoothCyclic(lf.k, 2, 1);

  T.vc = {};

  // DRS zones: on the circuit's longest straights (def.drs = how many), from 80 m in to 60 m before the end
  T.drs = new Uint8Array(n);
  let zones = Array.isArray(def.drs) ? def.drs.map(([a, b]) => [Math.floor(a * n), Math.floor(b * n)]) : [];
  if (!Array.isArray(def.drs)) {
    const find = (kmax, minLen) => {
      const straight = (i) => Math.abs(T.k[i]) < kmax, runs = [];
      let st = 0; while (straight(st) && st < n) st++; // begin scanning just after a corner
      let run = -1;
      for (let k = 1; k <= n; k++) { const i = wrap(st + k, n); if (straight(i)) { if (run < 0) run = k; } else if (run >= 0) { runs.push([st + run, st + k - 1]); run = -1; } }
      runs.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
      return runs.slice(0, def.drs || 1).filter(([a, b]) => (b - a) * STEP > minLen).map(([a, b]) => [a + 40, b - 30]);
    };
    zones = find(0.0032, 300);
    if (!zones.length) zones = find(0.007, 220); // a curving street "straight", like Monaco's
  }
  for (const [a, b] of zones) for (let i = a; i < b; i++) T.drs[wrap(i, n)] = 1;
  T.drsRuns = zones;
  // barrier offsets each side (pulled in on the inside of tight corners so the wall never folds over itself)
  const wp = new Float32Array(n), wm = new Float32Array(n), WALL = def.street ? T.half + (def.wall ?? 3.6) : 21;
  for (let i = 0; i < n; i++) {
    const kk = T.k[i], inner = Math.max(Math.min(WALL, T.half + 5), Math.min(WALL, 0.72 / (Math.abs(kk) + 1e-6)));
    wp[i] = kk > 0 ? inner : WALL; wm[i] = kk < 0 ? inner : WALL;
  }
  // Never let a barrier come closer to any other part of the circuit than to its own: where two stretches of track
  // run close together (or a corner is tight), pull the wall in so it can never cross tarmac or fold over itself.
  const CELL = 24, grid = new Map(), key = (cx, cz) => cx * 100003 + cz;
  for (let j = 0; j < n; j += 2) { const k = key(Math.floor(x[j] / CELL), Math.floor(z[j] / CELL)); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(j); }
  T.near = (px, pz, r, fn) => { const r2 = Math.ceil(r / CELL), cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL); for (let a = -r2; a <= r2; a++) for (let b = -r2; b <= r2; b++) { const l = grid.get(key(cx + a, cz + b)); if (l) for (const j of l) if (fn(j) === false) return false; } return true; };
  // distance to the nearest centreline sample (searches outwards; exact within `max`)
  T.dist = (px, pz, max = 400) => {
    let best = Infinity;
    for (let r = CELL; r <= max + CELL; r *= 2) { T.near(px, pz, r, (j) => { const d = (px - x[j]) ** 2 + (pz - z[j]) ** 2; if (d < best) best = d; }); if (best < (r - CELL) * (r - CELL)) break; }
    return Math.min(Math.sqrt(best), max + 1e-3 + (best === Infinity ? 1e9 : 0));
  };
  const geo = (o, i, sgn) => {
    let lo = T.half + (def.street ? 1.2 : 2.2), hi = o;
    const ok = (d) => { const px = x[i] + T.nx[i] * sgn * d, pz = z[i] + T.nz[i] * sgn * d, lim = (d - 0.6) * (d - 0.6); return T.near(px, pz, d, (j) => T.apart(i, j) || (px - x[j]) ** 2 + (pz - z[j]) ** 2 >= lim); }; // track on the other level does not count
    if (ok(hi)) return hi;
    for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
    return lo;
  };
  const gp = new Float32Array(n), gm = new Float32Array(n);
  for (let i = 0; i < n; i++) { gp[i] = geo(wp[i], i, 1); gm[i] = geo(wm[i], i, -1); }
  T.wp = smoothCyclic(gp, 6, 2); T.wm = smoothCyclic(gm, 6, 2);
  const wmin = T.half + (def.street ? 1.2 : 2.2);
  for (let i = 0; i < n; i++) { T.wp[i] = Math.max(wmin, Math.min(T.wp[i], gp[i])); T.wm[i] = Math.max(wmin, Math.min(T.wm[i], gm[i])); }
  for (let i = 0; i < n; i++) if (T.y[i] > 0.5) { T.wp[i] = T.wm[i] = wmin; } // raised: tight parapets on the bridge and its ramps
  T.wallMax = Math.max(...T.wp, ...T.wm);
  // DRS: one detection point 120 m before each activation zone
  T.drsZones = zones.map(([a, b]) => ({ a: wrap(a, n), b: wrap(b, n), det: wrap(a - 60, n) }));
  T.box = boxOf(x, z);
  T.sector = (i) => Math.min(2, Math.floor(wrap(i, n) / n * 3));
  T.heading = (i) => Math.atan2(T.tz[i], T.tx[i]);
  return T;
}

// Speed profile along the racing line (m/s) for a car class driven on the limit; cached per class.
export function speedProfile(T, cls) {
  if (T.vc[cls.id]) return T.vc[cls.id];
  const n = T.n, v = new Float32Array(n), g = (s) => cls.g0 + cls.gk * s * s, VT = cls.vtop + 6;
  for (let i = 0; i < n; i++) {
    // direction changes (S-bends) cost speed too: the car cannot flip its yaw instantly
    const kk = (Math.abs(T.lk[i]) + 0.35 * Math.abs(T.lk[wrap(i + 12, n)] - T.lk[wrap(i - 12, n)])) / (cls.margin || 0.86);
    v[i] = kk > cls.gk + 1e-5 ? Math.min(VT, Math.sqrt(cls.g0 / (kk - cls.gk))) : VT;
  }
  for (let pass = 0; pass < 2; pass++) for (let i = n - 1; i >= 0; i--) {
    const nxt = v[(i + 1) % n], brake = Math.min(cls.brake, g(nxt)) * 0.62 + cls.drag * nxt * nxt;
    v[i] = Math.min(v[i], Math.sqrt(nxt * nxt + 2 * brake * T.step));
  }
  // braking points: where the profile starts falling by more than 15 m/s
  const bz = [];
  for (let i = 0; i < n; i++) { const a = v[i], p = v[wrap(i - 1, n)]; if (p >= a + 0.05 && v[wrap(i - 2, n)] < p + 0.05 && a - v[wrap(i + 70, n)] > 15) bz.push(i); }
  T.vc[cls.id] = v; v.brakeAt = bz;
  return v;
}

// nearest sample in a window around a hint (O(1) per car per step)
export function locate(T, px, pz, hint, back = 10, fwd = 40) {
  let best = hint, bd = Infinity;
  for (let j = -back; j <= fwd; j++) {
    const i = wrap(hint + j, T.n), dx = px - T.x[i], dz = pz - T.z[i], d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
export function locateGlobal(T, px, pz) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < T.n; i += 3) { const dx = px - T.x[i], dz = pz - T.z[i], d = dx * dx + dz * dz; if (d < bd) { bd = d; best = i; } }
  return locate(T, px, pz, best, 4, 4);
}
export const lateral = (T, i, px, pz) => (px - T.x[i]) * T.nx[i] + (pz - T.z[i]) * T.nz[i];

// Grid slot g (0 = pole) -> pose behind the line, staggered two-wide.
export function gridPose(T, g) {
  const back = 9 + g * 5.2, i = wrap(Math.round(-back / T.step), T.n), side = (g % 2 ? 1 : -1) * T.half * 0.42;
  return { x: T.x[i] + T.nx[i] * side, z: T.z[i] + T.nz[i] * side, h: T.heading(i), i };
}
export { wrap };
