# DeskGP

Electric sedans on proper circuits, raced from your desk. Multiplayer by room code, bots when you are alone. One HTML file, no server.

**Play: [abhieq31.com/deskgp](https://abhieq31.com/deskgp/)**

## What is in it

- **Three circuits** with kerbs, gravel traps, barriers, grandstands and a pit building: Silverline Circuit (day), Harbour Lights (night, floodlit), Sunset Ridge (golden hour).
- **Multiplayer for up to 8** by sharing a six-character code or a link. Bots fill the rest of the grid; the host picks circuit, laps, bot pace and teams.
- **Solo** against bots at four pace levels, plus a ghost of your best lap and a live delta to it.
- **Racing model**: grip rises with speed (downforce), braking and cornering share one friction budget, slipstream, DRS zones, kerbs, lift-off regeneration, grass and gravel that slow you down, solid barriers, and a boost that recharges under braking and in a tow.
- **Race craft**: five-light start with reaction time and jump-start penalty, sector colours, fastest-lap point, reverse-championship grids, two-team scoring, emotes, timing tower, minimap (bottom right), four cameras.
- **Boss key (B)**: a spreadsheet covers the screen, sound cuts, and the autopilot keeps your car in the race.

## Controls

| | |
| :-- | :-- |
| Drive | WASD or arrow keys (gamepad and touch also work) |
| Boost | Space or Shift |
| Reset to track | R |
| Camera | C |
| Mute | M |
| Boss key | B |
| Emotes | 1 to 4 |
| Menu | Esc |

## How multiplayer works

There is no game server. Players with the same room code find each other on public Nostr relays (messages are encrypted with a key derived from the code), then open direct WebRTC data channels and race over those at 20 updates a second. Each player simulates their own car, so steering never waits for the network; other cars are drawn about 0.1 s in the past and interpolated. The host simulates the bots; if the host leaves, the next player takes over. If two players cannot connect directly (strict firewall), their updates fall back to the relays at a lower rate.

## Develop

```
npm install
npm run build     # writes deskgp.html (single self-contained file)
npm test          # headless: circuits are legal, bots finish clean races
```

`test/shot.mjs` and `test/mp.mjs` drive the built file in headless Chromium (solo race, and two or more browsers racing each other).

Source is in `src/`: `track.js` (circuits, racing line), `physics.js` (car model), `ai.js` (bots), `world.js` (three.js scene), `net.js` (relays + WebRTC), `audio.js` (synthesised sound), `main.js` (race rules, lobby, HUD).

## Licence

MIT. Uses [three.js](https://threejs.org) (MIT) and [noble-curves](https://github.com/paulmillr/noble-curves) (MIT).
