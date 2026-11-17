// Headless checks: circuits are legal (no self-overlap, inside bounds) and bots race cleanly in both car classes.
import { TRACKS, buildTrack, gridPose, speedProfile } from "../src/track.js";
import { makeCar, placeCar, stepCar, collideCars, updateTow, CLASSES, respawn } from "../src/physics.js";
import { makeBrain, drive } from "../src/ai.js";
import { layout, distToTrack, clearance } from "../src/layout.js";

let fail = 0;
const d0 = (v) => Math.round(v);
const bad = (m) => { console.log("  FAIL " + m); fail++; };
const only = process.env.CLS ? [CLASSES[process.env.CLS]] : Object.values(CLASSES);
for (const def of TRACKS) {
  const T = buildTrack(def);
  console.log(`\n${def.name}: ${(T.len / 1000).toFixed(2)} km`);
  console.log(`  official ${d0(def.length)} m, built ${d0(T.len)} m, ${T.drsZones.length} DRS zones`);
  if (Math.abs(T.len - def.length) / def.length > 0.04) bad("length differs from the real circuit by more than 4%");
  let minSelf = 1e9;
  for (let i = 0; i < T.n; i += 2) for (let j = i + 40; j < T.n; j += 2) { if (T.n - j + i < 40) continue; const d = Math.hypot(T.x[i] - T.x[j], T.z[i] - T.z[j]); if (d < minSelf) minSelf = d; }
  console.log(`  closest approach of two stretches: ${minSelf.toFixed(0)} m`); if (minSelf < T.width + 2) bad(`track passes ${minSelf.toFixed(1)} m from itself`);
  // barriers: never closer to another part of the circuit than to their own stretch, never on tarmac
  let wallBad = 0;
  for (let i = 0; i < T.n; i += 2) for (const sg of [1, -1]) {
    const o = sg > 0 ? T.wp[i] : T.wm[i], px = T.x[i] + T.nx[i] * sg * o, pz = T.z[i] + T.nz[i] * sg * o, d = distToTrack(T, px, pz, 1);
    if (d < o - 1.2 || d < T.half + 0.5) wallBad++; // never on, or within 0.5 m of, any tarmac
  }
  if (wallBad) bad(`${wallBad} barrier points intrude on another part of the circuit`);
  // scenery footprints, exactly as world.js draws them, must clear every barrier
  const L = layout(T), C = clearance(T), clear = (pts, what) => { const m = Math.min(...pts.map(([x, z]) => distToTrack(T, x, z, 1))); if (m < C - 0.5) bad(`${what} is ${m.toFixed(1)} m from the centreline (needs ${C.toFixed(1)})`); };
  const box = (cx, cz, th, x0, x1, z0, z1) => { const pts = []; for (let u = 0; u <= 8; u++) for (let v = 0; v <= 4; v++) { const lx = x0 + (x1 - x0) * u / 8, lz = z0 + (z1 - z0) * v / 4; pts.push([cx + lx * Math.cos(th) + lz * Math.sin(th), cz - lx * Math.sin(th) + lz * Math.cos(th)]); } return pts; };
  L.stands.forEach((st, k) => clear(box(st.x, st.z, st.rot, -23, 23, -1.8, 18), `grandstand ${k}`));
  if (L.pit) clear(box(L.pit.x, L.pit.z, -L.pit.rot + (L.pit.flip ? Math.PI : 0), -57, 57, -8.5, 8.5), "pit building");
  if (L.screen) { const r = L.screen.rot, pts = []; for (let u = -15; u <= 15; u += 2.5) for (const v of [-1, 1]) pts.push([L.screen.x + Math.cos(r) * u - Math.sin(r) * v, L.screen.z + Math.sin(r) * u + Math.cos(r) * v]); clear(pts, "big screen"); }
  L.buildings.forEach(([x, z, w, d], k) => clear(box(x, z, 0, -w / 2, w / 2, -d / 2, d / 2), `building ${k}`));
  L.trees.forEach(([x, z], k) => clear([[x, z]].map(([a, b]) => [a, b]), `tree ${k}`));
  console.log(`  scenery: ${L.stands.length} grandstands, pit ${L.pit ? "yes" : "no"}, ${L.buildings.length} buildings, ${L.trees.length} trees - all clear`);
  for (const cls of only) {
    T.v = speedProfile(T, cls);
    for (const skill of (process.env.SKILLS || "0.84,1.0").split(",").map(Number)) {
      const cars = [], brains = [];
      for (let g = 0; g < 6; g++) { const c = makeCar("b" + g, cls); const p = gridPose(T, g); placeCar(c, p); c.total = p.i - T.n; cars.push(c); brains.push(makeBrain(skill, g / 6)); }
      const dt = 1 / 120, laps = +(process.env.LAPS || 2), fin = new Set(), best = cars.map(() => Infinity), lapStart = cars.map(() => 0), last = cars.map(() => 0);
      let t = 0, respawns = 0, offs = 0, vtop = 0, walls = 0, retired = 0;
      while (t < 900 && fin.size < cars.length) {
        for (let k = 0; k < cars.length; k++) {
          const c = cars[k]; if (fin.has(c)) { stepCar(c, { brk: 0.6, direct: true }, dt, T); continue; }
          const inp = drive(c, brains[k], T, cars, dt, t);
          updateTow(c, cars);
          if (inp.respawn) { respawns++; respawn(c, T); }
          const b0 = c.bump; c.bump = 0;
          stepCar(c, inp, dt, T, { damage: 1 });
          if (c.bump > 0.2) walls++;
          if (c.surf === 2) offs += dt;
          vtop = Math.max(vtop, c.speed);
          const lap = Math.floor(c.total / T.n);
          if (c.total >= 0 && lap > last[k]) { if (last[k] >= 1 || lapStart[k] > 0) best[k] = Math.min(best[k], t - lapStart[k]); lapStart[k] = t; last[k] = lap; if (lap >= laps) fin.add(c); }
          if (c.total >= 0 && !lapStart[k]) lapStart[k] = t;
        }
        for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) collideCars(cars[a], cars[b], true, { damage: 1 });
        t += dt;
      }
      const bl = Math.min(...best);
      console.log(`  ${cls.id} skill ${skill}: ${fin.size}/6 finished, ${t.toFixed(0)}s, best lap ${bl.toFixed(2)}s, top ${(vtop * 3.6).toFixed(0)} km/h, off-track ${offs.toFixed(1)} car-s, wall hits ${walls}, recoveries ${respawns}`);
      if (fin.size < 6) bad("not every bot finished");
      if (offs > 60) bad("bots spend too long off the track");
    }
  }
}
console.log(fail ? `\n${fail} problem(s)` : "\nall good");
process.exit(fail ? 1 : 0);
