// Track geometry: closed spline -> uniform samples, racing line, speed profile, lookups.
// Plane coordinates are (x, z). Heading h: forward = (cos h, sin h). "Right" = (-sin h, cos h).

// Units are metres. The circuits fit in a 1040 x 660 m box.
export const BOUNDS = { hx: 520, hz: 330 };
export const DESK = BOUNDS;
export const STEP = 2;
export const TRACKS = [
  {
    id: "silverline", name: "Silverline Circuit", mood: "day", width: 14, country: "GB",
    blurb: "Fast and flowing. A long pit straight, a sweeping back section and one tight loop to get wrong.",
    pts: [[-260, 178], [0, 182], [240, 178], [345, 150], [385, 70], [350, -10], [270, -45], [180, -20], [90, -60], [-10, -25],
      [-120, -60], [-200, -130], [-250, -215], [-340, -235], [-410, -170], [-390, -80], [-320, -20], [-400, 50], [-410, 130], [-340, 180]],
    drs: [[0.0, 0.2]],
  },
  {
    id: "harbour", name: "Harbour Lights Street Circuit", mood: "night", width: 13, street: true, country: "SG",
    blurb: "Night street race. Concrete walls a metre from the white line, city towers all round, no room for mistakes.",
    pts: [[-150, 205], [80, 210], [250, 200], [330, 235], [420, 215], [440, 130], [370, 80], [300, 10], [380, -60], [440, -150],
      [380, -240], [280, -250], [230, -170], [160, -120], [70, -160], [20, -250], [-70, -270], [-110, -190], [-40, -110], [-60, -40],
      [-160, -60], [-250, -120], [-340, -250], [-430, -230], [-440, -120], [-380, -40], [-420, 60], [-380, 160], [-280, 190]],
    drs: [[0.0, 0.11]],
  },
  {
    id: "ridge", name: "Sunset Ridge", mood: "sunset", width: 15, country: "US",
    blurb: "Golden hour. Two long DRS straights, two hairpins, and a lot of slipstream.",
    pts: [[-330, 255], [0, 262], [330, 255], [440, 215], [455, 120], [380, 80], [290, 120], [200, 160], [140, 95], [200, 20],
      [330, -20], [440, -80], [450, -200], [360, -270], [180, -275], [0, -200], [-180, -275], [-360, -270], [-450, -190], [-430, -80],
      [-320, -40], [-200, -70], [-110, -20], [-170, 60], [-290, 80], [-420, 60], [-460, 150], [-430, 230]],
    drs: [[0.0, 0.16], [0.48, 0.6]],
  },
];


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

  // zones
  T.drs = new Uint8Array(n);
  for (const [a, b] of def.drs || []) for (let i = Math.floor(a * n); i < Math.floor(b * n); i++) T.drs[wrap(i, n)] = 1;
  // barrier offsets each side (pulled in on the inside of tight corners so the wall never folds over itself)
  const wp = new Float32Array(n), wm = new Float32Array(n), WALL = def.street ? T.half + 3.6 : 21;
  for (let i = 0; i < n; i++) {
    const kk = T.k[i], inner = Math.max(Math.min(WALL, T.half + 5), Math.min(WALL, 0.72 / (Math.abs(kk) + 1e-6)));
    wp[i] = kk > 0 ? inner : WALL; wm[i] = kk < 0 ? inner : WALL;
  }
  // Never let a barrier come closer to any other part of the circuit than to its own: where two stretches of track
  // run close together (or a corner is tight), pull the wall in so it can never cross tarmac or fold over itself.
  const geo = (o, i, sgn) => {
    let lo = T.half + 2.2, hi = o;
    const ok = (d) => { const px = x[i] + T.nx[i] * sgn * d, pz = z[i] + T.nz[i] * sgn * d; for (let j = 0; j < n; j += 2) { const dx = px - x[j], dz = pz - z[j]; if (dx * dx + dz * dz < (d - 0.6) * (d - 0.6)) return false; } return true; };
    if (ok(hi)) return hi;
    for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
    return lo;
  };
  const gp = new Float32Array(n), gm = new Float32Array(n);
  for (let i = 0; i < n; i++) { gp[i] = geo(wp[i], i, 1); gm[i] = geo(wm[i], i, -1); }
  T.wp = smoothCyclic(gp, 6, 2); T.wm = smoothCyclic(gm, 6, 2);
  for (let i = 0; i < n; i++) { T.wp[i] = Math.max(T.half + 2.2, Math.min(T.wp[i], gp[i])); T.wm[i] = Math.max(T.half + 2.2, Math.min(T.wm[i], gm[i])); }
  T.wallMax = Math.max(...T.wp, ...T.wm);
  // DRS: one detection point 120 m before each activation zone
  T.drsZones = (def.drs || []).map(([a, b]) => ({ a: wrap(Math.floor(a * n), n), b: wrap(Math.floor(b * n), n), det: wrap(Math.floor(a * n) - 60, n) }));
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
