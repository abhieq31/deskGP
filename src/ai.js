// Bot driver. Also used as the autopilot while a human uses the quick-hide key.
import { wrap } from "./track.js";
import { steerLimit } from "./physics.js";

// Grid names (name, three-letter code, livery colour).
export const DRIVERS = [
  ["Max Verstappen", "VER", "#1e3a8a"], ["Lewis Hamilton", "HAM", "#dc0000"], ["Charles Leclerc", "LEC", "#e10600"],
  ["Lando Norris", "NOR", "#ff8000"], ["Oscar Piastri", "PIA", "#ff9a2e"], ["George Russell", "RUS", "#27f4d2"],
  ["Fernando Alonso", "ALO", "#006f62"], ["Carlos Sainz", "SAI", "#2a63d4"], ["Kimi Antonelli", "ANT", "#9ef0e2"],
  ["Pierre Gasly", "GAS", "#ff87bc"], ["Alex Albon", "ALB", "#64c4ff"], ["Yuki Tsunoda", "TSU", "#6692ff"],
  ["Ayrton Senna", "SEN", "#f7f7f2"], ["Michael Schumacher", "MSC", "#ffd60a"],
];
export const BOT_NAMES = DRIVERS.map((d) => d[0]);
export const DIFFS = [
  { id: "rookie", name: "Rookie", skill: 0.84 }, { id: "pro", name: "Pro", skill: 0.9 },
  { id: "expert", name: "Expert", skill: 0.955 }, { id: "legend", name: "Legend", skill: 1.0 },
];
export const codeOf = (name) => {
  const d = DRIVERS.find((x) => x[0] === name); if (d) return d[1];
  const w = String(name || "").trim().split(/\s+/), s = (w.length > 1 ? w[w.length - 1] : w[0] || "DRV").replace(/[^A-Za-z]/g, "");
  if (s.length < 3) { const all = String(name || "").replace(/[^A-Za-z]/g, ""); return all.length >= 3 && !/^Driver/i.test(name) ? all.slice(0, 3).toUpperCase() : "YOU"; }
  return s.slice(0, 3).toUpperCase();
};

export function makeBrain(skill, seed = Math.random()) {
  return { skill, off: 0, offTarget: 0, react: 0.18 + seed * 0.28, noise: seed * 100, mood: 1, stuck: 0, band: 1, st: 0 };
}

const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// Returns smooth inputs ({direct: true} tells the car model not to filter them again).
export function drive(c, br, T, cars, dt, raceT, ctx = {}) {
  const out = { steer: 0, thr: 0, brk: 0, boost: false, direct: true };
  if (raceT < br.react) return out;
  const v = c.speed, n = T.n, prof = T.v;

  br.noise += dt;
  br.mood = 1 + 0.016 * Math.sin(br.noise * 0.7) + 0.01 * Math.sin(br.noise * 1.93 + 2);
  const skill = br.skill * br.mood * br.band;

  // traffic: pick a side to pass, lift if boxed in, move over for blue flags
  let lift = 1; br.offTarget = 0;
  const ux = Math.cos(c.h), uz = Math.sin(c.h);
  for (const o of cars) {
    if (o === c) continue;
    const dx = o.x - c.x, dz = o.z - c.z, along = dx * ux + dz * uz, side = -dx * uz + dz * ux;
    if (along > 0 && along < 9 + v * 0.35 && Math.abs(side) < 3.2) {
      const closing = v - o.speed;
      if (closing > -2) {
        const room = T.half - 2, want = (side > 0 ? -1 : 1) * 4.2 + (o.lat - T.lo[o.idx]);
        br.offTarget = Math.max(-room - T.lo[c.idx], Math.min(room - T.lo[c.idx], want));
        if (along < 6 && Math.abs(side) < 2.2 && closing > 1) lift = 0.5;
        if (ctx.yellow && along < 30 && o.speed > 15) { lift = Math.min(lift, closing > 0 ? 0 : 0.6); br.offTarget = 0; } // no overtaking under yellow
      }
    }
    // a car one lap up is right behind: let it through
    if (along < 0 && along > -45 && o.total > c.total + n * 0.6) { br.offTarget = (T.lo[c.idx] > 0 ? -1 : 1) * (T.half - 2.2) - T.lo[c.idx]; lift = Math.min(lift, 0.85); }
  }
  br.off += (br.offTarget - br.off) * Math.min(1, 2.5 * dt);

  // aim at a point ahead on the racing line (pure pursuit), smoothed like a driver's hands
  const heavy = c.cls.id === "gt", look = (heavy ? 9 : 6) + v * (heavy ? 0.5 : 0.34), li = wrap(c.idx + Math.round(look / T.step), n);
  const keep = Math.max(-T.half + 1.5, Math.min(T.half - 1.5, T.lo[li] + br.off));
  const tx = T.x[li] + T.nx[li] * keep, tz = T.z[li] + T.nz[li] * keep;
  const err = angDiff(Math.atan2(tz - c.z, tx - c.x), c.h), dist = Math.hypot(tx - c.x, tz - c.z);
  // pure pursuit: the arc through the aim point, turned into a road-wheel angle with the car's own geometry,
  // plus yaw-rate feedback so the car settles instead of weaving
  const kappa = 2 * Math.sin(err) / Math.max(dist, 4), cls = c.cls;
  let delta = Math.atan(cls.L * kappa) + 0.6 * cls.peak * Math.tanh(kappa * v * v / 12) - (heavy ? 0.09 : 0.045) * (c.w - kappa * v);
  const raw = Math.max(-1, Math.min(1, delta / steerLimit(cls, v)));
  br.st += (raw - br.st) * (1 - Math.exp(-dt * 30));
  out.steer = br.st;

  // speed: obey the profile a little way ahead
  const ai = wrap(c.idx + Math.round((3 + v * 0.16) / T.step), n);
  let target = Math.min(prof[ai] * skill, c.cls.vtop * (0.6 + 0.4 * skill));
  if (c.surf === 2) target = Math.min(target, 28);
  if (ctx.yellow) target = Math.min(target, prof[ai] * 0.9);
  const dv = target - v;
  if (dv > 0) out.thr = Math.min(1, 0.25 + dv * 0.4) * lift;
  else if (dv < -1.2) out.brk = Math.min(1, -dv * 0.22);
  if (Math.abs(err) > 0.9 && v > 14) { out.thr = 0; out.brk = Math.max(out.brk, 0.4); }
  // feed the power in as the wheel unwinds: full throttle at full lock only washes the car wide
  const lock = Math.abs(br.st); if (lock > 0.55) out.thr *= Math.max(0.25, 1.45 - lock);

  // ERS on straights
  let straight = true;
  for (let j = 0; j < 60; j += 6) if (Math.abs(T.lk[wrap(c.idx + j, n)]) > 0.006) { straight = false; break; }
  out.boost = straight && c.energy > 0.35 && out.thr > 0.9 && skill > 0.88;

  // stuck against a wall: reverse out, then ask for a recovery
  if (v < 2.5 && raceT > br.react + 1) br.stuck += dt; else br.stuck = Math.max(0, br.stuck - dt * 2);
  if (br.stuck > 1.2) { out.reverse = true; out.thr = 0; out.brk = 0; out.steer = -out.steer; }
  if (br.stuck > 2.6) { out.respawn = true; br.stuck = 0; }
  return out;
}
