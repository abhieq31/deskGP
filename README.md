# DeskGP

Grand Prix racing in the browser. Race friends with a room code, or a full AI grid when you are alone. One HTML file, no server.

**Play: [abhieq31.com/deskgp](https://abhieq31.com/deskgp/)**

## Why DeskGP

**Mission:** the thrill of a Grand Prix, in a browser tab, with your friends, in under ten seconds.

**Vision:** the racing game you reach for between two meetings and are still playing years later, because the
driving is honest and there is always a tenth to find.

How we decide what goes in (and, more often, what stays out):

1. **One obvious thing per screen.** Home has one big button: Race. The lobby has one: Lights out. Results: Race again.
2. **Defaults so good you never need settings.** Name, team and number are optional. Everything else is one tap away
   ("More settings"), never in the way.
3. **It just works.** No account, no install, no server. "Race with friends" creates the room and copies the invite
   link in the same tap; opening the link lands on one button, Join.
4. **The details nobody asked for.** Real circuits to the metre, a real bridge at Suzuka, tyres that warm up, a brake
   bias you can feel, an engineer who only talks when it matters, a cockpit that appears when you need it and fades away.
5. **Our own look.** The DeskGP mark (a D drawn as a corner, a chequered start and the racing line through the apex),
   an original crest for every team, circuit art in broadcast sector colours. No borrowed logos.

### Growth, speed and stability (the second lens)

- **Every race is an invitation.** "Race with friends" puts the link on the clipboard (or the phone's share sheet).
  After any race, "Challenge a friend" sends your best lap as a ghost to beat. The **Daily challenge** (one circuit and car
  a day, the same for everyone, a fair time trial) keeps a streak and shares like a puzzle score. Friends you race get a
  running head-to-head record.
- **Fast is a feature.** Racing lines are solved once when the circuits are generated (12 circuits built in 0.16 s,
  was 1.6 s); terrain distances come from one distance transform instead of 30,000 searches; texture noise is drawn in
  batches and cached; the menu backdrop is built in 10 ms slices so buttons never freeze; shader error read-back is off
  in production so the browser compiles in parallel.
- **Move fast with stable infrastructure.** Every push runs CI: the committed build must be current, circuits legal,
  AI races clean, and the game must run in a real browser within its speed and memory budgets (`test/perf.mjs` fails if
  a click gets slow or memory grows race after race; a texture leak of ~16 per race was found and fixed this way).

## What is in it

- **Twelve real Grand Prix circuits** from their actual centrelines at full scale, each in its own setting: Monza (royal park), Silverstone (open airfield), Spa-Francorchamps (Ardennes forest and hills), the Red Bull Ring (Styrian mountains and snow-capped peaks), Interlagos (inside the São Paulo skyline), Imola (riverside park), **Suzuka** (the figure of eight, with the back straight crossing the Degner section on a real bridge: ramps, embankments, gravity on the climb), Zandvoort (North Sea dunes), Circuit of the Americas (Texas hills), the Hungaroring (dusty valley), Barcelona-Catalunya (Mediterranean pines) and Albert Park (Melbourne lakeside).
- **Three car classes**: the Electric GT, the modern Formula car (active aero, ERS, Overtake mode) and the Classic, a late-1960s Grand Prix car: about 410 hp in 500 kg, no wings, narrow tyres, 0-100 km/h in 4 s and 1.15 g of grip everywhere, so it slides, steps out under power and rewards a delicate right foot.
- **Planted, realistic car feel**: the wheel asks for a yaw rate the tyres can hold at that speed, grip builds from slip, and downforce adds grip with speed. Real power, drag and braking: the Electric GT does 0-100 km/h in 2.3 s and stops from 200 km/h in 96 m; the Formula car pulls 4 g at 290 km/h and stops from 200 km/h in 62 m.
- **2026-style cornering system**: active aero that opens in Straight Mode and snaps to Corner Mode when you brake or turn (automatic, or manual with F), with a flap sound and HUD badge. Trail braking moves weight forward for more front grip; brake bias that changes how the car behaves (rearward rotates it into corners and can slide it, forward locks the front tyres and understeers, with smoke and engineer advice); four tyre temperatures with an 85-110 °C grip window; three ERS modes; Overtake mode (extra energy) when you are within a second at the detection line.
- **Cockpit HUD and engineer**: a steering wheel you can drag to steer, throttle and brake pedal bars, tyre temperature and grip gauge, dials for brake bias, ERS and aero. The racing line is coloured green, yellow or red by braking need, apex cones sit at every corner with a ring on the next one, and a race engineer talks over radio (spoken and on screen): gaps each lap, tyre temperatures, battery, defending.
- **Skill that shows**: brake in a straight line, turn in, feed the throttle as you unwind. Every lap shows the gap to your all-time best; cut laps do not count as records; sector times go purple, green or yellow. Skill points (places gained, overtakes, clean laps, starts, records) build your career.
- **Race like the broadcasts**: five-light start, live timing tower with real gaps, an interval board after each sector, Overtake mode on the straights, chequered flag, F1 points, and a classification screen with your race summary.
- **Two rule sets**: *Casual* (start lights, DRS, chequered flag, points; nothing to obey) and *Grand Prix* (qualifying, track limits, penalties, yellow and blue flags, DRS from lap 3, full damage), where race control explains each rule the first time it comes up.
- **Challenge links**: share your best lap as a link; whoever opens it races your ghost with a live gap. No accounts.
- **Multiplayer for up to 10 cars** by room code or link; AI drivers (named after famous drivers) fill the grid. The race pauses for everyone if the host steps away for more than 4 seconds (a quick alt-tab does not; the host's AI cars keep running in a hidden tab).
- **The 2026 grid**: all eleven teams (McLaren, Mercedes, Red Bull Racing, Ferrari, Williams, Racing Bulls, Aston Martin, Haas, Audi, Alpine, Cadillac) with their real drivers and numbers; pick a team and take one of its two seats. Detailed cars: suspension, multi-element wings, brake discs and callipers, dents and parts that break off.
- **Lineup and podium**: drivers posed in front of their cars before the lights, and a podium with a stats board (grid, gap, best lap, top speed, overtakes, points, rating) before the classification.

## Controls

| | |
| :-- | :-- |
| Drive | WASD or arrow keys (gamepad and touch also work) |
| Browse circuits (lobby) | Left and right arrows |
| ERS boost | Space or Shift |
| Aero flap (manual) / auto aero | F / T |
| Brake bias (rearward / forward) / ERS mode | [ and ] / E |
| Cockpit (when it matters / always / off) / engineer voice | V / K |
| Camera | C (chase, far chase, onboard, TV) |
| Back on track | R |
| Mute | M |
| Emotes | 1 to 4 |
| Pause (pauses everyone if you are the host) / graphics | Esc |
| Controls card | B or H |

## How multiplayer works

There is no game server. Players with the same room code find each other on public Nostr relays (messages are encrypted with a key derived from the code), then open direct WebRTC data channels and race over those at 30 updates a second. Each player simulates their own car, so steering never waits for the network; other cars are drawn about 0.1 s in the past and interpolated. The host simulates the AI drivers; if the host leaves, the next player takes over. If two players cannot connect directly (strict firewall), their updates fall back to the relays at a lower rate. 

## Develop

```
npm install
npm run build     # writes deskgp.html (single self-contained file)
npm test          # headless: no barrier or scenery overlaps the circuit, AI drivers finish clean races in all three classes
                  # (TRACKS=monza,spa or CLS=classic to narrow it)
node test/feel.mjs  # how fast the car responds to a key press
```

These drive the built file in headless Chromium (set `PW` to a Playwright path if it is not installed locally):

| Script | Checks |
| :-- | :-- |
| `test/smoke.mjs` | every circuit, rotating the car classes: no page errors, cars moving |
| `test/mp.mjs` | two or more browsers find each other and race (`MODE=relay` uses only the public relays, `HOLD=1` tests the host pause) |
| `test/hidden.mjs` | host tab hidden: the race keeps running 4 s, then pauses, and resumes on return |
| `test/perf.mjs` | time to a usable home screen, click latency, and memory across races (fails on a leak or a slow click) |
| `test/lineup.mjs`, `test/car.mjs`, `test/shot.mjs`, `test/still.mjs` | screenshots: lineup and podium, car close-ups, race views |

Source is in `src/`: `track.js` (circuits, racing line, speed profiles, barriers), `layout.js` (where scenery may go), `physics.js` (car model, damage), `ai.js` (AI drivers), `world.js` (three.js scene, cars, post-processing), `net.js` (relays + WebRTC), `teams.js` (the grid), `circuits.js` (generated by `tools/make-circuits.mjs`), `audio.js` (synthesised sound), `main.js` (sporting rules, lobby, HUD), `brand.js` (the DeskGP mark, team crests, circuit art).

Driver and circuit names are used as a tribute; DeskGP is a fan project with no connection to Formula 1, its teams, drivers or circuits. Team and driver names are set in plain lettering as a tribute (no logos); DeskGP has no affiliation with, and is not endorsed by, Formula 1, any team or any sponsor.

## Licence

MIT. Uses [three.js](https://threejs.org) (MIT) and [noble-curves](https://github.com/paulmillr/noble-curves) (MIT). Circuit centrelines come from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT, (c) Tomislav Bacinger); `tools/make-circuits.mjs` regenerates `src/circuits.js` from it.
