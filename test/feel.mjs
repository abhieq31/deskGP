// Step response of the human handling model: what happens when a key goes down. Targets are in the comments.
import { TRACKS, buildTrack } from "../src/track.js";
import { makeCar, stepCar, CLASSES } from "../src/physics.js";
const T = buildTrack(TRACKS[0]), dt = 1 / 120;
const pin = (c) => { c.x = T.x[100]; c.z = T.z[100]; c.idx = 100; c.lat = 0; };
for (const cls of Object.values(CLASSES)) {
  console.log(`\n${cls.name}  (target: yaw 50% < 110 ms at low speed, < 160 ms flat out; no overshoot above 15% past 150 km/h)`);
  for (const v0 of [20, 40, 60, 80]) {
    const c = makeCar("t", cls); pin(c); c.vx = v0; c.thr = 0.55;
    const log = [];
    for (let i = 0; i < 240; i++) { stepCar(c, { steer: 1, thr: 0.55, brk: 0 }, dt, T, { damage: 0 }); pin(c); log.push(c.w); }
    const ss = log[log.length - 1], peak = Math.max(...log);
    const t50 = (log.findIndex((w) => w >= 0.5 * ss) + 1) * dt, t90 = (log.findIndex((w) => w >= 0.9 * ss) + 1) * dt, sp = Math.hypot(c.vx, c.vz);
    console.log(`  ${(v0 * 3.6).toFixed(0).padStart(3)} km/h: yaw 50% ${(t50 * 1000).toFixed(0)} ms, 90% ${(t90 * 1000).toFixed(0)} ms, ${(ss * sp / 9.81).toFixed(1)} g, overshoot ${((peak / ss - 1) * 100).toFixed(0)}%`);
  }
  const c = makeCar("t", cls); pin(c); let t = 0, t100 = null, t200 = null;
  while (t < 20 && t200 == null) { stepCar(c, { steer: 0, thr: 1 }, dt, T, { damage: 0 }); pin(c); t += dt; if (t100 == null && c.speed >= 27.8) t100 = t; if (c.speed >= 55.6) t200 = t; }
  let d = 0, tb = 0; while (c.speed > 0.5) { stepCar(c, { steer: 0, brk: 1 }, dt, T, { damage: 0 }); d += c.speed * dt; pin(c); tb += dt; }
  console.log(`  0-100 ${t100.toFixed(2)} s, 0-200 ${t200.toFixed(2)} s, 200-0 in ${d.toFixed(0)} m`);
}
