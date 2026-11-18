# DeskGP

Grand Prix racing in the browser. Race friends with a room code, or a full AI grid when you are alone. One HTML file, no server.

**Play: [abhieq31.com/deskgp](https://abhieq31.com/deskgp/)**

## What is in it

- **Five real Grand Prix circuits** from their actual centrelines at full scale, each in its own setting: Monza (royal park), Silverstone (open airfield), Spa-Francorchamps (Ardennes forest and hills), Monaco (harbour, yachts, Riviera streets) and Interlagos (inside the São Paulo skyline).
- **Car physics from first principles**: each axle's tyres make grip from their own slip angle and load; weight moves forward under braking and back under power; downforce adds grip with speed. Understeer, lift-off rotation and wide exits come from the physics, not a script. Real numbers: the Electric GT does 0-100 km/h in 2.1 s and corners at about 1.3 g; the Formula car pulls 4 g at 290 km/h and stops from 200 km/h in 60 m.
- **Skill that shows**: brake in a straight line, turn in, feed the throttle as you unwind. Every lap shows the gap to your all-time best; cut laps do not count as records; sector times go purple, green or yellow. Skill points (places gained, overtakes, clean laps, starts, records) build your career.
- **Race like the broadcasts**: five-light start, live timing tower with real gaps, an interval board after each sector, DRS on the straights, chequered flag, F1 points, and a classification screen with your race summary.
- **Two rule sets**: *Casual* (start lights, DRS, chequered flag, points; nothing to obey) and *Grand Prix* (qualifying, track limits, penalties, yellow and blue flags, DRS from lap 3, full damage), where race control explains each rule the first time it comes up.
- **Challenge links**: share your best lap as a link; whoever opens it races your ghost with a live gap. No accounts.
- **Multiplayer for up to 10 cars** by room code or link; AI drivers (named after famous drivers) fill the grid. The race pauses for everyone if the host steps away.
- **Liveries** with (fictional) tech sponsors, dents and parts that break off.

## Controls

| | |
| :-- | :-- |
| Drive | WASD or arrow keys (gamepad and touch also work) |
| ERS boost | Space or Shift |
| Camera | C (chase, far chase, onboard, TV) |
| Back on track | R |
| Mute | M |
| Emotes | 1 to 4 |
| Pause (pauses everyone if you are the host) / graphics | Esc |
| Controls card | H |

## How multiplayer works

There is no game server. Players with the same room code find each other on public Nostr relays (messages are encrypted with a key derived from the code), then open direct WebRTC data channels and race over those at 30 updates a second. Each player simulates their own car, so steering never waits for the network; other cars are drawn about 0.1 s in the past and interpolated. The host simulates the AI drivers; if the host leaves, the next player takes over. If two players cannot connect directly (strict firewall), their updates fall back to the relays at a lower rate. 

## Develop

```
npm install
npm run build     # writes deskgp.html (single self-contained file)
npm test          # headless: no barrier or scenery overlaps the circuit, AI drivers finish clean races in both classes
node test/feel.mjs  # how fast the car responds to a key press
```

`test/shot.mjs`, `test/still.mjs` and `test/mp.mjs` drive the built file in headless Chromium (solo race, high-quality stills, two or more browsers racing each other).

Source is in `src/`: `track.js` (circuits, racing line, speed profiles, barriers), `layout.js` (where scenery may go), `physics.js` (car model, damage), `ai.js` (AI drivers), `world.js` (three.js scene, cars, post-processing), `net.js` (relays + WebRTC), `audio.js` (synthesised sound), `main.js` (sporting rules, lobby, HUD).

Driver and circuit names are used as a tribute; DeskGP is a fan project with no connection to Formula 1, its teams, drivers or circuits. Sponsor names on cars and boards are invented.

## Licence

MIT. Uses [three.js](https://threejs.org) (MIT) and [noble-curves](https://github.com/paulmillr/noble-curves) (MIT). Circuit centrelines come from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT, (c) Tomislav Bacinger); `tools/make-circuits.mjs` regenerates `src/circuits.js` from it.
