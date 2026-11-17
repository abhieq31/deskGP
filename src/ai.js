// Bot driver. Also used as the autopilot while a human hides behind the boss key.
import { wrap } from "./track.js";

export const BOT_NAMES = ["Reply-All Ray", "Synergy Sam", "KPI Kim", "Standup Stan", "Circle-Back Cy", "Deck Dana", "Low-Hanging Lou", "Bandwidth Bo", "Offsite Olu", "Pivot Priya", "Touch-Base Tom"];
export const DIFFS = [
  { id: "intern", name: "Intern", skill: 0.82 }, { id: "manager", name: "Manager", skill: 0.89 },
  { id: "director", name: "Director", skill: 0.95 }, { id: "ceo", name: "Founder mode", skill: 1.0 },
];

export function makeBrain(skill, seed = Math.random()) {
  return { skill, off: 0, offTarget: 0, react: 0.16 + seed * 0.3, noise: seed * 100, mood: 1, stuck: 0, band: 1 };
}

const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// returns {steer, thr, brk, boost}
export function drive(c, br, T, cars, dt, raceT) {
  const out = { steer: 0, thr: 0, brk: 0, boost: false, drsOk: false };
  if (raceT < br.react) return out;
  const v = c.speed, n = T.n;

  // every few seconds the bot's confidence drifts a little, so pace is not robotic
  br.noise += dt;
  br.mood = 1 + 0.018 * Math.sin(br.noise * 0.7) + 0.012 * Math.sin(br.noise * 1.93 + 2);
  const skill = br.skill * br.mood * br.band;

  // traffic: pick a side to pass, or lift if boxed in
  let lift = 1; br.offTarget = 0;
  const ux = Math.cos(c.h), uz = Math.sin(c.h);
  for (const o of cars) {
    if (o === c || o.fall > 0) continue;
    const dx = o.x - c.x, dz = o.z - c.z, along = dx * ux + dz * uz, side = -dx * uz + dz * ux;
    if (along > 0 && along < 9 + v * 0.35 && Math.abs(side) < 3.2) {
      const closing = v - o.speed;
      if (closing > -2) {
        const room = T.half - 2;
        const want = (side > 0 ? -1 : 1) * 4.2 + (o.lat - T.lo[o.idx]);
        br.offTarget = Math.max(-room - T.lo[c.idx], Math.min(room - T.lo[c.idx], want));
        if (along < 6 && Math.abs(side) < 2.2 && closing > 1) lift = 0.5;
      }
    }
  }
  br.off += (br.offTarget - br.off) * Math.min(1, 2.5 * dt);

  // aim at a point ahead on the racing line
  const look = 7 + v * 0.3, li = wrap(c.idx + Math.round(look / T.step), n);
  const keep = Math.max(-T.half + 1.6, Math.min(T.half - 1.6, T.lo[li] + br.off));
  const tx = T.x[li] + T.nx[li] * keep, tz = T.z[li] + T.nz[li] * keep;
  const want = Math.atan2(tz - c.z, tx - c.x);
  const err = angDiff(want, c.h);
  out.steer = Math.max(-1, Math.min(1, err * (2.6 + 40 / (v + 12))));

  // speed: obey the profile a little way ahead
  const ai = wrap(c.idx + Math.round((2 + v * 0.06) / T.step), n);
  let target = Math.min(T.v[ai] * skill, 58 + 40 * skill);
  if (c.surf === 2) target = Math.min(target, 30);
  const dv = target - v;
  if (dv > 0) out.thr = Math.min(1, 0.25 + dv * 0.4) * lift;
  else if (dv < -1.2) out.brk = Math.min(1, -dv * 0.22);
  if (Math.abs(err) > 0.9 && v > 14) { out.thr = 0; out.brk = Math.max(out.brk, 0.4); }

  // boost on straights
  let straight = true;
  for (let j = 0; j < 60; j += 6) if (Math.abs(T.lk[wrap(c.idx + j, n)]) > 0.006) { straight = false; break; }
  out.boost = straight && c.energy > 0.35 && out.thr > 0.9 && skill > 0.9;
  out.drsOk = true; // caller overrides with the real slipstream check

  // wedged against a mug? reverse out, then ask for a respawn
  if (v < 2.5 && raceT > br.react + 1) br.stuck += dt; else br.stuck = Math.max(0, br.stuck - dt * 2);
  if (br.stuck > 1.2) { out.reverse = true; out.thr = 0; out.brk = 0; out.steer = -out.steer; }
  if (br.stuck > 2.6) { out.respawn = true; br.stuck = 0; }
  return out;
}
