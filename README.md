# DeskGP

Grand Prix racing in the browser. Race friends with a room code, or a full AI grid when you are alone. One HTML file, no server.

**Play: [abhieq31.com/deskgp](https://abhieq31.com/deskgp/)**

## What is in it

- **Three circuits**: Silverline Circuit (day, permanent circuit with gravel traps and tyre walls), Harbour Lights Street Circuit (night, concrete walls lining the track, city towers, the harbour), Sunset Ridge (golden hour, painted run-off, hills).
- **Two car classes**: Electric GT (instant torque, regen when you lift) and Formula (more downforce, a V6 note, eight gears, DRS flap).
- **Sporting rules**, enforced by race control:
  - five red lights, one a second, then a random hold; throttle before lights out is a jump start (+5 s)
  - track limits: all four wheels over the white line deletes the lap; three warnings, a black-and-white flag, then +5 s penalties
  - running into the back of another car: +5 s for causing a collision
  - yellow flags in a sector after an incident: no DRS there, and overtaking under yellow is +5 s
  - blue flags when a car a lap ahead is right behind you
  - DRS enabled from lap 3, only if you are within one second of the car ahead at the detection point
  - chequered flag: once the leader finishes, everyone finishes at their next crossing
  - time penalties are added to the race time; points 25-18-15-12-10-8-6-4-2-1
  - optional one-shot qualifying (out lap and two flying laps) sets the grid
- **Damage**: dents where you hit, front wings, endplates, mirrors and spoilers break off and stay on the track, damage costs grip, top speed or pulls the steering, and a big enough accident retires the car. Off, visual-only or full.
- **Assists** (per driver): racing line that turns yellow and red where you need to lift and brake, braking assist, steering assist.
- **Multiplayer for up to 10 cars** by room code or link; AI drivers fill the grid.
- **Quick-hide (B)**: a plain spreadsheet covers the screen and the autopilot keeps your car in the race.

## Controls

| | |
| :-- | :-- |
| Drive | WASD or arrow keys (gamepad and touch also work) |
| ERS boost | Space or Shift |
| Camera | C (chase, far chase, onboard, TV) |
| Recover when stopped or beached | R |
| Mute | M |
| Emotes | 1 to 4 |
| Pause / graphics | Esc |
| Quick-hide | B |

## How multiplayer works

There is no game server. Players with the same room code find each other on public Nostr relays (messages are encrypted with a key derived from the code), then open direct WebRTC data channels and race over those at 30 updates a second. Each player simulates their own car, so steering never waits for the network; other cars are drawn about 0.1 s in the past and interpolated. The host simulates the AI drivers; if the host leaves, the next player takes over. If two players cannot connect directly (strict firewall), their updates fall back to the relays at a lower rate. Each driver's own client judges its own incidents (track limits, contact from behind, yellow flags) and announces penalties to everyone.

## Develop

```
npm install
npm run build     # writes deskgp.html (single self-contained file)
npm test          # headless: circuits are legal, AI drivers finish clean races in both classes
node test/feel.mjs  # how fast the car responds to a key press
```

`test/shot.mjs`, `test/still.mjs` and `test/mp.mjs` drive the built file in headless Chromium (solo race, high-quality stills, two or more browsers racing each other).

Source is in `src/`: `track.js` (circuits, racing line, speed profiles), `physics.js` (car model, damage), `ai.js` (AI drivers), `world.js` (three.js scene, cars, post-processing), `net.js` (relays + WebRTC), `audio.js` (synthesised sound), `main.js` (sporting rules, lobby, HUD).

Driver names on the AI grid are used as a tribute; DeskGP is a fan project with no connection to Formula 1, its teams or drivers.

## Licence

MIT. Uses [three.js](https://threejs.org) (MIT) and [noble-curves](https://github.com/paulmillr/noble-curves) (MIT).
