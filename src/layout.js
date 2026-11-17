// Where trackside scenery goes. Pure and seeded, so every player sees the same circuit, and testable in Node:
// nothing is allowed to sit on the tarmac or inside the barriers of any part of the circuit.
import { wrap } from "./track.js";

export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function distToTrack(T, x, z, step = 3) { let b = 1e12; for (let i = 0; i < T.n; i += step) { const d = (x - T.x[i]) ** 2 + (z - T.z[i]) ** 2; if (d < b) b = d; } return Math.sqrt(b); }
// clearance every scenery footprint must keep from the centreline of every stretch of track
export const clearance = (T) => T.wallMax + 4;

// Rectangle centred at (x, z), half-sizes (hw along `rot` heading, hd across); sample its outline and inside.
export function rectPoints(x, z, rot, hw, hd) {
  const c = Math.cos(rot), s = Math.sin(rot), pts = [];
  for (let u = -1; u <= 1.001; u += 0.25) for (let v = -1; v <= 1.001; v += 0.5) { const a = u * hw, b = v * hd; pts.push([x + c * a - s * b, z + s * a + c * b]); }
  return pts;
}
export const rectClear = (T, x, z, rot, hw, hd, margin = 0) => rectPoints(x, z, rot, hw, hd).every(([px, pz]) => distToTrack(T, px, pz) > clearance(T) + margin);

export function layout(T) {
  const R = rng(T.n * 7919 + T.def.id.length), out = { stands: [], pit: null, screen: null, buildings: [], trees: [] }, taken = [];
  const free = (x, z, r) => taken.every(([tx, tz, tr]) => Math.hypot(x - tx, z - tz) > r + tr);
  const side = (i, s, d) => [T.x[i] + T.nx[i] * s * d, T.z[i] + T.nz[i] * s * d];
  const wall = (i, s) => (s > 0 ? T.wp[i] : T.wm[i]);
  const pitSide = T.k[wrap(40, T.n)] > 0 ? -1 : 1;
  // pit building along the start straight (110 x 14 m), slid back until it clears every part of the track
  for (let extra = 6; extra < 60 && !out.pit; extra += 4) {
    const i = wrap(34, T.n), d = wall(i, pitSide) + extra + 7, [x, z] = side(i, pitSide, d), rot = T.heading(i);
    if (rectClear(T, x, z, rot, 55, 7)) { out.pit = { x, z, rot, flip: pitSide < 0 }; taken.push([x, z, 58]); }
  }
  // big screen before the line, opposite the pits
  for (let extra = 4; extra < 50 && !out.screen; extra += 4) {
    const i = wrap(-70, T.n), d = wall(i, -pitSide) + extra + 2, [x, z] = side(i, -pitSide, d), t = wrap(i - 60, T.n);
    const face = Math.atan2(T.z[t] - z, T.x[t] - x), rot = face + Math.PI / 2; // the panel faces back down the track
    if (rectClear(T, x, z, rot, 16, 2) && free(x, z, 16)) { out.screen = { x, z, i, rot }; taken.push([x, z, 17]); }
  }
  // grandstands (46 x 20 m) beside straights
  let last = -999;
  for (let i = 10; i < T.n - 10 && out.stands.length < 8; i += 6) {
    if (Math.abs(T.k[i]) > 0.0022 || i - last < 30) continue;
    const s = i < 120 ? -pitSide : out.stands.length % 2 ? 1 : -1;
    if (i > 20 && i < 95 && s === pitSide) continue;
    for (const extra of [5, 9, 14]) {
      const d = wall(i, s) + extra + 10, [x, z] = side(i, s, d), rot = T.heading(i);
      if (rectClear(T, x, z, rot, 23, 10) && free(x, z, 26)) {
        const [fx, fz] = side(i, s, d - 8); // the front row (which reaches 1.7 m forward) faces the track
        out.stands.push({ x: fx, z: fz, rot: -rot + (s > 0 ? 0 : Math.PI) }); taken.push([x, z, 26]); last = i; break;
      }
    }
  }
  if (T.def.street) {
    for (let x = -900; x <= 900; x += 46) for (let z = -700; z <= 650; z += 46) {
      if (z < -560) continue; // harbour water
      const w = 22 + R() * 12, d = 22 + R() * 12, jx = x + (R() - 0.5) * 16, jz = z + (R() - 0.5) * 16;
      if (!rectClear(T, jx, jz, 0, w / 2, d / 2, 2) || !free(jx, jz, Math.hypot(w, d) / 2)) continue;
      const near = distToTrack(T, jx, jz, 6) < 90, k = near ? (R() < 0.6 ? 0 : 1) : R() < 0.4 ? 2 : R() < 0.6 ? 1 : 0;
      out.buildings.push([jx, jz, w, d, [14 + R() * 12, 32 + R() * 28, 70 + R() * 70][k], k]);
    }
  } else {
    for (let k = 0; k < 6000 && out.trees.length < 520; k++) {
      const x = (R() - 0.5) * 2600, z = (R() - 0.5) * 2100;
      if (distToTrack(T, x, z, 6) > clearance(T) + 22 && free(x, z, 8)) out.trees.push([x, z, 0.8 + R() * 1.1, R()]);
    }
  }
  return out;
}
