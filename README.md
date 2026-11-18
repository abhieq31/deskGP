# DeskGP

Grand Prix racing in the browser. Race friends with a room code, or a full AI grid when you are alone. One HTML file, no server.

**Play: [abhieq31.com/deskgp](https://abhieq31.com/deskgp/)**

## What is in it

- **Five real Grand Prix circuits** from their actual centrelines at full scale, each in its own setting: Monza (royal park), Silverstone (open airfield), Spa-Francorchamps (Ardennes forest and hills), Monaco (harbour, yachts, Riviera streets) and Interlagos (inside the São Paulo skyline).
- **Planted, realistic car feel**: the wheel asks for a yaw rate the tyres can hold at that speed, grip builds from slip, and downforce adds grip with speed. Real power, drag and braking: the Electric GT does 0-100 km/h in 2.3 s and stops from 200 km/h in 96 m; the Formula car pulls 4 g at 290 km/h and stops from 200 km/h in 62 m.
- **2026-style cornering system**: active aero that opens in Straight Mode and snaps to Corner Mode when you brake or turn (automatic, or manual with F), with a flap sound and HUD badge. Trail braking moves weight forward for more front grip; adjustable brake bias; four tyre temperatures with an 85-110 °C grip window; three ERS modes; Overtake mode (extra energy) when you are within a second at the detection line.
- **Cockpit HUD and engineer**: a steering wheel you can drag to steer, throttle and brake pedal bars, tyre temperature and grip gauge, dials for brake bias, ERS and aero. The racing line is coloured green, yellow or red by braking need, apex cones sit at every corner with a ring on the next one, and a race engineer talks over radio (spoken and on screen): gaps each lap, tyre temperatures, battery, defending.
- **Skill that shows**: brake in a straight line, turn in, feed the throttle as you unwind. Every lap shows the gap to your all-time best; cut laps do not count as records; sector times go purple, green or yellow. Skill points (places gained, overtakes, clean laps, starts, records) build your career.
- **Race like the broadcasts**: five-light start, live timing tower with real gaps, an interval board after each sector, Overtake mode on the straights, chequered flag, F1 points, and a classification screen with your race summary.
- **Two rule sets**: *Casual* (start lights, DRS, chequered flag, points; nothing to obey) and *Grand Prix* (qualifying, track limits, penalties, yellow and blue flags, DRS from lap 3, full damage), where race control explains each rule the first time it comes up.
- **Challenge links**: share your best lap as a link; whoever opens it races your ghost with a live gap. No accounts.
- **Multiplayer for up to 10 cars** by room code or link; AI drivers (named after famous drivers) fill the grid. The race pauses for everyone if the host steps away.
- **The 2026 grid**: all eleven teams (McLaren, Mercedes, Red Bull Racing, Ferrari, Williams, Racing Bulls, Aston Martin, Haas, Audi, Alpine, Cadillac) with their real drivers and numbers; pick a team and take one of its two seats. Detailed cars: suspension, multi-element wings, brake discs and callipers, dents and parts that break off.
- **Lineup and podium**: drivers posed in front of their cars before the lights, and a podium with a stats board (grid, gap, best lap, top speed, overtakes, points, rating) before the classification.

## Controls

| | |
| :-- | :-- |
| Drive | WASD or arrow keys (gamepad and touch also work) |
| ERS boost | Space or Shift |
| Aero flap (manual) / auto aero | F / T |
| Brake bias / ERS mode | [ and ] / E |
| HUD full or minimal / engineer voice | V / K |
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

Driver and circuit names are used as a tribute; DeskGP is a fan project with no connection to Formula 1, its teams, drivers or circuits. Team, driver and sponsor names are set in plain lettering as a tribute (no logos); DeskGP has no affiliation with, and is not endorsed by, Formula 1, any team or any sponsor.

## Licence

MIT. Uses [three.js](https://threejs.org) (MIT) and [noble-curves](https://github.com/paulmillr/noble-curves) (MIT). Circuit centrelines come from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT, (c) Tomislav Bacinger); `tools/make-circuits.mjs` regenerates `src/circuits.js` from it.
