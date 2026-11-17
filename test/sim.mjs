// Headless checks: circuits are legal (no self-overlap, inside bounds) and bots race cleanly in both car classes.
import { TRACKS, buildTrack, gridPose, BOUNDS, speedProfile } from "../src/track.js";
import { makeCar, placeCar, stepCar, collideCars, updateTow, CLASSES, respawn } from "../src/physics.js";
import { makeBrain, drive } from "../src/ai.js";

let fail = 0;
const bad = (m) => { console.log("  FAIL " + m); fail++; };
const only = process.env.CLS ? [CLASSES[process.env.CLS]] : Object.values(CLASSES);
for (const def of TRACKS) {
  const T = buildTrack(def);
  console.log(`\n${def.name}: ${(T.len / 1000).toFixed(2)} km`);
  for (let i = 0; i < T.n; i++) if (Math.abs(T.x[i]) > BOUNDS.hx - 30 || Math.abs(T.z[i]) > BOUNDS.hz - 30) { bad(`track near the edge at ${i}`); break; }
  let minSelf = 1e9;
  for (let i = 0; i < T.n; i += 2) for (let j = i + 40; j < T.n; j += 2) { if (T.n - j + i < 40) continue; const d = Math.hypot(T.x[i] - T.x[j], T.z[i] - T.z[j]); if (d < minSelf) minSelf = d; }
  if (minSelf < T.width + 16) bad(`track passes ${minSelf.toFixed(1)} m from itself`);
  for (const cls of only) {
    T.v = speedProfile(T, cls);
    for (const skill of [0.84, 0.9, 1.0]) {
      const cars = [], brains = [];
      for (let g = 0; g < 6; g++) { const c = makeCar("b" + g, cls); const p = gridPose(T, g); placeCar(c, p); c.total = p.i - T.n; cars.push(c); brains.push(makeBrain(skill, g / 6)); }
      const dt = 1 / 120, laps = 3, fin = new Set(), best = cars.map(() => Infinity), lapStart = cars.map(() => 0), last = cars.map(() => 0);
      let t = 0, respawns = 0, offs = 0, vtop = 0, walls = 0, retired = 0;
      while (t < 420 && fin.size < cars.length) {
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
