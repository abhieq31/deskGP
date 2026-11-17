// Track geometry: closed spline -> uniform samples, racing line, speed profile, lookups.
// Plane coordinates are (x, z). Heading h: forward = (cos h, sin h). "Right" = (-sin h, cos h).

export const DESK = { hx: 520, hz: 330 };
export const STEP = 2;

// Grip model shared by physics and the AI speed profile.
export const GRIP0 = 19, GRIPK = 0.0032;
export const gripAt = (v) => GRIP0 + GRIPK * v * v;

/* Prop footprints (desk units; 1 unit is about 1.6 mm of real desk):
   mug r27 - keyboard 275x87 - mouse 38x66 - monitor base 150x100 - phone 46x94
   pad 47x47 - pen 90x5 - plant r34 - stapler 100x26 - lamp r40 - notebook 130x180 - donut r26 */
export const TRACKS = [
  {
    id: "standup", name: "Silverline Circuit", mood: "day", width: 14,
    blurb: "Fast and flowing. A long pit straight, a sweeping back section and one tight loop to get wrong.",
    pts: [[-260, 178], [0, 182], [240, 178], [345, 150], [385, 70], [350, -10], [270, -45], [180, -20], [90, -60], [-10, -25],
      [-120, -60], [-200, -130], [-250, -215], [-340, -235], [-410, -170], [-390, -80], [-320, -20], [-400, 50], [-410, 130], [-340, 180]],
    drs: [[0.0, 0.2]],
  },
  {
    id: "deadline", name: "Harbour Lights", mood: "night", width: 13,
    blurb: "A night race under floodlights. Tight, technical, and the walls are close.",
    pts: [[-150, 205], [80, 210], [250, 200], [330, 235], [420, 215], [440, 130], [370, 80], [300, 10], [380, -60], [440, -150],
      [380, -240], [280, -250], [230, -170], [160, -120], [70, -160], [20, -250], [-70, -270], [-110, -190], [-40, -110], [-60, -40],
      [-160, -60], [-250, -120], [-340, -250], [-430, -230], [-440, -120], [-380, -40], [-420, 60], [-380, 160], [-280, 190]],
    drs: [[0.0, 0.11]],
  },
  {
    id: "replyall", name: "Sunset Ridge", mood: "sunset", width: 15,
    blurb: "Golden hour. Two long DRS straights, two hairpins, and a lot of slipstream.",
    pts: [[-330, 255], [0, 262], [330, 255], [440, 215], [455, 120], [380, 80], [290, 120], [200, 160], [140, 95], [200, 20],
      [330, -20], [440, -80], [450, -200], [360, -270], [180, -275], [0, -200], [-180, -275], [-360, -270], [-450, -190], [-430, -80],
      [-320, -40], [-200, -70], [-110, -20], [-170, 60], [-290, 80], [-420, 60], [-460, 150], [-430, 230]],
    drs: [[0.0, 0.16], [0.48, 0.6]],
  },
];

export const PROP_SHAPES = {
  mug: { r: 27 }, keyboard: { w: 275, d: 87 }, mouse: { w: 38, d: 66 }, monitor: { w: 150, d: 100 }, phone: { w: 46, d: 94 },
  pad: { w: 47, d: 47 }, pen: { w: 90, d: 6 }, plant: { r: 34 }, stapler: { w: 100, d: 26 }, lamp: { r: 40 }, notebook: { w: 130, d: 180 }, donut: { r: 26 },
};

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

  // Speed profile along the racing line (m/s) for a driver on the limit.
  const VTOP = 96, v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const kk = Math.abs(T.lk[i]) / 0.87;
    v[i] = kk > GRIPK + 1e-4 ? Math.min(VTOP, Math.sqrt(GRIP0 / (kk - GRIPK))) : VTOP;
  }
  for (let pass = 0; pass < 2; pass++) for (let i = n - 1; i >= 0; i--) {
    const nxt = v[(i + 1) % n], brake = Math.min(28, gripAt(nxt)) * 0.62 + 0.0016 * nxt * nxt;
    v[i] = Math.min(v[i], Math.sqrt(nxt * nxt + 2 * brake * step));
  }
  T.v = v;

  // zones
  T.drs = new Uint8Array(n);
  for (const [a, b] of def.drs || []) for (let i = Math.floor(a * n); i < Math.floor(b * n); i++) T.drs[wrap(i, n)] = 1;
  // barrier offsets each side (pulled in on the inside of tight corners so the wall never folds over itself)
  const wp = new Float32Array(n), wm = new Float32Array(n), WALL = 21;
  for (let i = 0; i < n; i++) {
    const kk = T.k[i], inner = Math.max(T.half + 5, Math.min(WALL, 0.72 / (Math.abs(kk) + 1e-6)));
    wp[i] = kk > 0 ? inner : WALL; wm[i] = kk < 0 ? inner : WALL;
  }
  T.wp = smoothCyclic(wp, 6, 2); T.wm = smoothCyclic(wm, 6, 2);
  T.pads = (def.pads || []).map(([s, o]) => { const i = Math.floor(s * n); return { i, x: x[i] + T.nx[i] * o, z: z[i] + T.nz[i] * o, h: Math.atan2(T.tz[i], T.tx[i]) }; });
  T.spills = (def.spills || []).map(([s, o, r]) => { const i = Math.floor(s * n); return { i, x: x[i] + T.nx[i] * o, z: z[i] + T.nz[i] * o, r }; });
  T.colliders = (def.props || []).map((p) => {
    const sh = PROP_SHAPES[p.t];
    return sh.r ? { c: 1, x: p.x, z: p.z, r: sh.r } : { c: 0, x: p.x, z: p.z, hw: sh.w / 2, hd: sh.d / 2, cos: Math.cos(p.rot || 0), sin: Math.sin(p.rot || 0) };
  });
  T.heading = (i) => Math.atan2(T.tz[i], T.tx[i]);
  return T;
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
