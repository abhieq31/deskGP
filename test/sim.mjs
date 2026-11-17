// Headless checks: circuits are legal (no props on the tarmac, no self-overlap) and bots lap cleanly.
import { TRACKS, buildTrack, gridPose, DESK, PROP_SHAPES } from "../src/track.js";
import { makeCar, placeCar, stepCar, collideCars, updateTow } from "../src/physics.js";
import { makeBrain, drive } from "../src/ai.js";

let fail = 0;
const bad = (m) => { console.log("  FAIL " + m); fail++; };
for (const def of TRACKS) {
  const T = buildTrack(def);
  console.log(`\n${def.name}: length ${T.len.toFixed(0)} n=${T.n} vmin ${(Math.min(...T.v) * 3.6).toFixed(0)} km/h`);
  // bounds
  for (let i = 0; i < T.n; i++) if (Math.abs(T.x[i]) > DESK.hx - 30 || Math.abs(T.z[i]) > DESK.hz - 30) { bad(`track near desk edge at ${i} (${T.x[i].toFixed(0)},${T.z[i].toFixed(0)})`); break; }
  // self overlap
  let minSelf = 1e9;
  for (let i = 0; i < T.n; i += 2) for (let j = i + 40; j < T.n; j += 2) {
    if (T.n - j + i < 40) continue;
    const d = Math.hypot(T.x[i] - T.x[j], T.z[i] - T.z[j]); if (d < minSelf) minSelf = d;
  }
  if (minSelf < T.width + 16) bad(`track passes ${minSelf.toFixed(1)} from itself`); else console.log(`  self clearance ${minSelf.toFixed(0)}`);
  // props
  (def.props || []).forEach((p, pi) => {
    const col = T.colliders[pi]; let md = 1e9;
    for (let i = 0; i < T.n; i++) {
      let d;
      if (col.c) d = Math.hypot(T.x[i] - col.x, T.z[i] - col.z) - col.r;
      else { const dx = T.x[i] - col.x, dz = T.z[i] - col.z, lx = Math.abs(dx * col.cos + dz * col.sin) - col.hw, lz = Math.abs(-dx * col.sin + dz * col.cos) - col.hd; d = Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(0, Math.max(lx, lz)); }
      if (d < md) md = d;
    }
    if (md < T.half + 9) bad(`${p.t} at (${p.x},${p.z}) is ${md.toFixed(1)} from centreline`);
    const sh = PROP_SHAPES[p.t], r = p.rot || 0;
    const ex = sh.r || Math.abs(Math.cos(r)) * sh.w / 2 + Math.abs(Math.sin(r)) * sh.d / 2, ez = sh.r || Math.abs(Math.sin(r)) * sh.w / 2 + Math.abs(Math.cos(r)) * sh.d / 2;
    if (Math.abs(p.x) + ex > DESK.hx - 4 || Math.abs(p.z) + ez > DESK.hz - 4) bad(`${p.t} at (${p.x},${p.z}) hangs off the desk`);
  });
  for (let a = 0; a < (def.props || []).length; a++) for (let b = a + 1; b < def.props.length; b++) {
    const A = def.props[a], B = def.props[b], ra = PROP_SHAPES[A.t].r || Math.min(PROP_SHAPES[A.t].w, PROP_SHAPES[A.t].d) / 2, rb = PROP_SHAPES[B.t].r || Math.min(PROP_SHAPES[B.t].w, PROP_SHAPES[B.t].d) / 2;
    if (Math.hypot(A.x - B.x, A.z - B.z) < ra + rb) bad(`${A.t} and ${B.t} overlap`);
  }
  // race: 6 bots, 3 laps
  for (const skill of [0.82, 0.89, 1.0]) {
    const cars = [], brains = [];
    for (let g = 0; g < 6; g++) { const c = makeCar("b" + g); placeCar(c, gridPose(T, g), T); c.total = -Math.round((9 + g * 5.2) / T.step); cars.push(c); brains.push(makeBrain(skill, g / 6)); }
    const dt = 1 / 120, laps = 3, fin = new Map(), lapT = cars.map(() => []), last = cars.map(() => 0);
    let t = 0, respawns = 0, falls = 0, offs = 0, vtop = 0;
    while (t < 400 && fin.size < cars.length) {
      for (let k = 0; k < cars.length; k++) {
        const c = cars[k]; if (fin.has(c)) { stepCar(c, { brk: 0.6 }, dt, T); continue; }
        const inp = drive(c, brains[k], T, cars, dt, t);
        inp.drsOk = updateTow(c, cars, T);
        if (inp.respawn) { respawns++; c.total = c.total; }
        const wasFall = c.fall > 0, wasOff = c.offT;
        stepCar(c, inp, dt, T);
        if (c.fall > 0 && !wasFall) falls++;
        if (c.surf === 2) offs += dt;
        vtop = Math.max(vtop, c.speed);
        const lap = Math.floor(c.total / T.n);
        if (lap > last[k]) { lapT[k].push(t - (lapT[k].reduce((a, b) => a + b, 0) + (lapT[k].start ?? 0))); last[k] = lap; if (lap >= laps) fin.set(c, t); }
        if (c.total >= 0 && lapT[k].start == null) lapT[k].start = t;
      }
      for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) collideCars(cars[a], cars[b], true);
      t += dt;
    }
    const best = Math.min(...lapT.flat().filter(Boolean));
    console.log(`  skill ${skill}: finished ${fin.size}/6 in ${t.toFixed(1)}s, best lap ${best.toFixed(2)}s, top ${(vtop * 3.6).toFixed(0)} km/h, off-track ${offs.toFixed(1)} car-s, falls ${falls}, respawns ${respawns}`);
    if (fin.size < 6) bad("not every bot finished");
    if (falls) bad("bots fell off the desk");
  }
}
console.log(fail ? `\n${fail} problem(s)` : "\nall good");
process.exit(fail ? 1 : 0);
