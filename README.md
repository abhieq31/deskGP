# DeskGP

Grand Prix racing in the browser. Race friends with a room code, or a full AI grid when you are alone. One HTML file, no server.

**Play: [abhieq31.com/deskgp](https://abhieq31.com/deskgp/)**

## What is in it

- **Three circuits**: Silverline Circuit (day, permanent circuit with gravel traps and tyre walls), Harbour Lights Street Circuit (night, concrete walls lining the track, city towers, the harbour), Sunset Ridge (golden hour, painted run-off, hills).
- **Two car classes**: Electric GT (instant torque, regen when you lift) and Formula (more downforce, a V6 note, eight gears, DRS flap).
- **Grand Prix format, without the paperwork**: five red lights with a random hold and your reaction time, DRS in the zones when you are within one second of the car ahead, the chequered flag (once the leader finishes, everyone finishes at their next crossing), and points 25-18-15-12-10-8-6-4-2-1. No penalties, no flags to obey.
- **Damage you can see**: dents where you hit, and splitters, mirrors, wings and endplates that break off and stay on the track.
- **Racing line** (per driver): turns yellow and red where you need to lift and brake. Corners only, full lap, or off.
- **Pauses when the host is away**: if the host switches tab or opens the pause menu, the race stops for everyone and picks up where it left off.
- **Multiplayer for up to 10 cars** by room code or link; AI drivers fill the grid.
- **Quick-hide (B)**: a plain spreadsheet covers the screen and the autopilot keeps your car in the race.

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
| Quick-hide | B |

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

Driver names on the AI grid are used as a tribute; DeskGP is a fan project with no connection to Formula 1, its teams or drivers.

## Licence

MIT. Uses [three.js](https://threejs.org) (MIT) and [noble-curves](https://github.com/paulmillr/noble-curves) (MIT).
