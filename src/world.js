// Everything you can see: a proper circuit (tarmac, kerbs, gravel, barriers, grandstands, pit lane building),
// electric sedans, effects and the camera.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { wrap, gridPose } from "./track.js";

const V3 = THREE.Vector3;
const rnd = (a, b) => a + Math.random() * (b - a);

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = opts.aniso || 8;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
  return t;
}
const std = (o) => new THREE.MeshStandardMaterial(o);

const MOODS = {
  day: { top: "#3f86d8", mid: "#a9cdf0", low: "#dfeaf2", hill: "#6f8f7a", fog: 0xcfdde8, fogD: 0.00075, sun: 0xfff1d6, sunI: 3.1, sunDir: [-0.45, 0.8, 0.4], hemiS: 0xcfe2ff, hemiG: 0x5c6b46, hemiI: 1.0, exp: 0.95, env: 0.9, grass: "#4f8a3c", grass2: "#447a34" },
  sunset: { top: "#28306b", mid: "#f08a5d", low: "#ffd08a", hill: "#5a3d55", fog: 0xe0a07c, fogD: 0.0009, sun: 0xffa35c, sunI: 3.2, sunDir: [0.75, 0.32, -0.4], hemiS: 0xb9a0e0, hemiG: 0x6a4a34, hemiI: 0.85, exp: 1.0, env: 0.7, grass: "#5d7d36", grass2: "#51702f" },
  night: { top: "#02040a", mid: "#0a1226", low: "#1a2440", hill: "#0a0f1c", fog: 0x0a1020, fogD: 0.0011, sun: 0xdfe8ff, sunI: 1.9, sunDir: [-0.2, 0.95, 0.25], hemiS: 0x6f86c0, hemiG: 0x1c2418, hemiI: 0.75, exp: 1.1, env: 0.45, grass: "#274a2a", grass2: "#213f24" },
};
const BRANDS = ["VOLTA", "APEX", "NIMBUS", "HALO ENERGY", "DESKGP", "KINETIK", "AURORA", "ZENITH TYRES", "PULSE", "NORTHWIND"];

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 4000);
  camera.position.set(0, 300, 500);
  const W = { renderer, scene, camera, cars: new Map(), T: null, scale: 1 };
  { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); }

  let trackGroup = null, lights = [], monitorTex = null, monitorCtx = null;
  const tmp = new V3(), tmp2 = new V3();

  // ---------- textures ----------
  const asphalt = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = "#33353a"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14000; i++) { const v = 34 + Math.random() * 46; g.fillStyle = `rgba(${v},${v},${v + 3},${0.2 + Math.random() * 0.4})`; g.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4); }
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.5, "rgba(0,0,0,0.25)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = "#f4f4f0"; g.fillRect(6, 0, 4, h); g.fillRect(w - 10, 0, 4, h);
  }, { repeat: [1, 1], aniso: 16 });
  const kerbTex = canvasTex(32, 64, (g, w, h) => { g.fillStyle = "#f1f1ec"; g.fillRect(0, 0, w, h); g.fillStyle = "#d21f26"; g.fillRect(0, 0, w, h / 2); }, { repeat: [1, 1] });
  const gravelTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = "#c9b58d"; g.fillRect(0, 0, w, h); for (let i = 0; i < 3500; i++) { const v = rnd(150, 225); g.fillStyle = `rgb(${v},${v * 0.9},${v * 0.7})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, { repeat: [1, 1] });
  const wallTex = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = "#e9ebee"; g.fillRect(0, 0, w, h);
    const cols = ["#d21f26", "#1d4ed8", "#111318", "#f59e0b"];
    for (let i = 0; i < 4; i++) { g.fillStyle = cols[i]; g.fillRect(i * 128 + 8, 10, 112, 44); g.fillStyle = "#fff"; g.font = "bold 24px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(BRANDS[i], i * 128 + 64, 33, 100); }
    g.fillStyle = "#9aa0a8"; g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4);
  }, { repeat: [1, 1], aniso: 16 });
  const checker = canvasTex(128, 32, (g) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? "#111" : "#f4f4f4"; g.fillRect(x * 8, y * 8, 8, 8); } });
  const crowdTex = canvasTex(256, 64, (g, w, h) => { g.fillStyle = "#3a3f4a"; g.fillRect(0, 0, w, h); const c = ["#e63946", "#f1faee", "#ffd60a", "#3a86ff", "#ff9f1c", "#8ecae6", "#222", "#ffb4a2"]; for (let i = 0; i < 1500; i++) { g.fillStyle = c[Math.floor(Math.random() * c.length)]; g.fillRect(Math.random() * w, Math.random() * h, 3, 4); } }, { repeat: [1, 1] });
  const softDot = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.4, "rgba(255,255,255,0.5)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0xffffff, 0x556644, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3); scene.add(sun); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.25;
  let shadowR = 0; const sunDir = new V3(0, 1, 0);
  function setShadowRange(r) { if (r === shadowR) return; shadowR = r; Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 10, far: 1400 }); sun.shadow.camera.updateProjectionMatrix(); }
  function aimSun(x, z, r) { setShadowRange(r); const q = (r * 2) / 2048 * 4; x = Math.round(x / q) * q; z = Math.round(z / q) * q; sun.target.position.set(x, 0, z); sun.position.set(x + sunDir.x * 600, sunDir.y * 600, z + sunDir.z * 600); }
  const head = new THREE.SpotLight(0xdfeaff, 0, 150, 0.5, 0.6, 1.2); scene.add(head); scene.add(head.target);

  // ---------- sky + ground ----------
  const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 40, 20), skyMat); scene.add(sky);
  function paintSky(m, id) {
    skyMat.map?.dispose();
    skyMat.map = canvasTex(2048, 1024, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h * 0.5); gr.addColorStop(0, m.top); gr.addColorStop(0.75, m.mid); gr.addColorStop(1, m.low);
      g.fillStyle = gr; g.fillRect(0, 0, w, h * 0.5); g.fillStyle = m.low; g.fillRect(0, h * 0.5, w, h * 0.5);
      if (id === "night") for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0.2, 0.9)})`; g.fillRect(rnd(0, w), rnd(0, h * 0.42), rnd(1, 2.2), rnd(1, 2.2)); }
      else { // sun glow + soft clouds
        const sx = id === "sunset" ? w * 0.42 : w * 0.3, sy = id === "sunset" ? h * 0.44 : h * 0.2, sg = g.createRadialGradient(sx, sy, 0, sx, sy, 260);
        sg.addColorStop(0, "rgba(255,250,225,1)"); sg.addColorStop(0.08, "rgba(255,240,200,0.9)"); sg.addColorStop(1, "rgba(255,220,170,0)"); g.fillStyle = sg; g.fillRect(0, 0, w, h * 0.5);
        g.filter = "blur(14px)";
        for (let i = 0; i < 46; i++) { g.fillStyle = id === "sunset" ? `rgba(255,${rnd(170, 215)},${rnd(150, 190)},${rnd(0.15, 0.4)})` : `rgba(255,255,255,${rnd(0.2, 0.55)})`; g.beginPath(); g.ellipse(rnd(0, w), rnd(h * 0.08, h * 0.4), rnd(60, 190), rnd(10, 26), 0, 0, 6.3); g.fill(); }
        g.filter = "none";
      }
      // far hills, then a nearer ridge / skyline
      for (const [amp, base, col, a] of [[38, 0.5, m.hill, 0.55], [22, 0.505, m.hill, 1]]) {
        g.globalAlpha = a; g.fillStyle = col; g.beginPath(); g.moveTo(0, h);
        const ph = Math.random() * 9;
        for (let x = 0; x <= w; x += 8) { const u = (x / w) * Math.PI * 2; g.lineTo(x, h * base - amp * (0.55 + 0.25 * Math.sin(u * 3 + ph) + 0.15 * Math.sin(u * 7 + ph * 2) + 0.08 * Math.sin(u * 17 + ph))); }
        g.lineTo(w, h); g.fill();
      }
      g.globalAlpha = 1;
      if (id === "night") for (let x = 0; x < w; x += rnd(10, 26)) { // harbour skyline with lit windows
        const bw = rnd(8, 22), bh = rnd(12, 70); g.fillStyle = "#070b16"; g.fillRect(x, h * 0.5 - bh, bw, bh);
        for (let k = 0; k < bh / 5; k++) if (Math.random() < 0.5) { g.fillStyle = `rgba(255,${rnd(190, 240)},${rnd(130, 200)},${rnd(0.4, 0.95)})`; g.fillRect(x + rnd(1, bw - 3), h * 0.5 - bh + 3 + k * 5, 2, 2); }
      }
    }, { aniso: 4 });
    skyMat.needsUpdate = true;
  }
  const groundMat = std({ roughness: 1, metalness: 0, envMapIntensity: 0.15 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), groundMat); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true; scene.add(ground);
  function paintGround(m) {
    groundMat.map?.dispose();
    groundMat.map = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = m.grass; g.fillRect(0, 0, w, h); g.fillStyle = m.grass2; g.fillRect(0, 0, w / 2, h); // mowing stripes
      for (let i = 0; i < 5000; i++) { g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,200,0.07)" : "rgba(0,30,0,0.12)"; g.fillRect(Math.random() * w, Math.random() * h, 1.5, rnd(2, 5)); }
    }, { repeat: [300, 300], aniso: 16 });
    groundMat.needsUpdate = true;
  }

  // ---------- geometry helpers ----------
  const shadowed = (m, cast = true) => { m.castShadow = cast; m.receiveShadow = true; return m; };
  const box = (w, h, d, mat) => shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
  // flat strip between lateral offsets a(i)..b(i)
  function ribbon(T, i0, i1, a, b, y, vScale) {
    const fa = typeof a === "function" ? a : () => a, fb = typeof b === "function" ? b : () => b;
    const cnt = i1 - i0 + 1, pos = new Float32Array(cnt * 6), uv = new Float32Array(cnt * 4), idx = [];
    for (let k = 0; k < cnt; k++) {
      const i = wrap(i0 + k, T.n), A = fa(i), B = fb(i);
      pos.set([T.x[i] + T.nx[i] * A, y, T.z[i] + T.nz[i] * A, T.x[i] + T.nx[i] * B, y, T.z[i] + T.nz[i] * B], k * 6);
      uv.set([0, (i0 + k) * vScale, 1, (i0 + k) * vScale], k * 4);
      if (k < cnt - 1) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  // vertical wall following a lateral offset
  function wallGeo(T, off, hgt, uScale) {
    const cnt = T.n + 1, pos = new Float32Array(cnt * 6), uv = new Float32Array(cnt * 4), idx = [];
    for (let k = 0; k < cnt; k++) {
      const i = k % T.n, o = off(i), x = T.x[i] + T.nx[i] * o, z = T.z[i] + T.nz[i] * o;
      pos.set([x, 0, z, x, hgt, z], k * 6); uv.set([k * uScale, 0, k * uScale, 1], k * 4);
      if (k < cnt - 1) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const decal = (o) => std({ roughness: 0.9, envMapIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...o });
  const flat = (w, d, mat, x, z, rot, y) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.set(-Math.PI / 2, 0, -rot); m.position.set(x, y, z); m.receiveShadow = true; return m; };
  function distToTrack(T, x, z) { let b = 1e9; for (let i = 0; i < T.n; i += 4) { const d = (x - T.x[i]) ** 2 + (z - T.z[i]) ** 2; if (d < b) b = d; } return Math.sqrt(b); }

  W.setTrack = function (T) {
    if (trackGroup) { scene.remove(trackGroup); trackGroup.traverse((o) => { o.geometry?.dispose(); }); }
    W.T = T; lights = []; monitorTex = null; monitorCtx = null;
    const G = trackGroup = new THREE.Group(); scene.add(G);
    const id = T.def.mood, m = MOODS[id]; W.mood = m; W.night = id === "night";
    paintSky(m, id); paintGround(m);
    scene.fog = new THREE.FogExp2(m.fog, m.fogD); renderer.toneMappingExposure = m.exp; scene.environmentIntensity = m.env;
    hemi.color.set(m.hemiS); hemi.groundColor.set(m.hemiG); hemi.intensity = m.hemiI;
    sun.color.set(m.sun); sun.intensity = m.sunI; sunDir.set(...m.sunDir).normalize(); aimSun(0, 0, 620);
    head.intensity = 0;

    // tarmac + rubbered line
    const road = new THREE.Mesh(ribbon(T, 0, T.n, -T.half, T.half, 0.02, T.step / 22), decal({ map: asphalt, roughness: 0.82, envMapIntensity: 0.35, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); road.receiveShadow = true; G.add(road);
    const line = new THREE.Mesh(ribbon(T, 0, T.n, (i) => T.lo[i] - 1.6, (i) => T.lo[i] + 1.6, 0.03, 1), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    G.add(line);
    // gravel traps on the outside of corners, kerbs both sides
    const gravelMat = decal({ map: gravelTex, roughness: 1, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), kerbMat = decal({ map: kerbTex, roughness: 0.6, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    let run = -1;
    for (let i = 0; i <= T.n; i++) {
      const on = i < T.n && Math.abs(T.k[i]) > 0.006;
      if (on && run < 0) run = i;
      if (!on && run >= 0) {
        if (i - run > 5) {
          const a = Math.max(0, run - 8), b = Math.min(T.n, i + 8), mid = Math.floor((run + i) / 2), out = T.k[wrap(mid, T.n)] > 0 ? -1 : 1;
          for (const s of [-1, 1]) { const km = new THREE.Mesh(ribbon(T, a, b, s * (T.half - 0.3), s * (T.half + 1.6), 0.05, T.step / 5), kerbMat); km.receiveShadow = true; G.add(km); }
          const a2 = Math.max(0, run - 14), b2 = Math.min(T.n, i + 22);
          const gm = new THREE.Mesh(ribbon(T, a2, b2, out * (T.half + 1.6), (j) => out * ((out > 0 ? T.wp[j] : T.wm[j]) - 0.3), 0.012, T.step / 9), gravelMat); gm.receiveShadow = true; G.add(gm);
        }
        run = -1;
      }
    }
    // barriers
    const wallMat = std({ map: wallTex, roughness: 0.55, side: THREE.DoubleSide, envMapIntensity: 0.4 });
    for (const s of [-1, 1]) { const wm = new THREE.Mesh(wallGeo(T, (i) => s * (s > 0 ? T.wp[i] : T.wm[i]), 1.25, T.step / 26), wallMat); wm.castShadow = true; wm.receiveShadow = true; G.add(wm); }
    // start line + grid
    const h0 = T.heading(0);
    G.add(flat(3, T.width, decal({ map: checker, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }), T.x[0], T.z[0], h0, 0.05));
    const white = decal({ color: 0xf2f2ee, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    for (let g = 0; g < 8; g++) { const p = gridPose(T, g), fx = Math.cos(p.h), fz = Math.sin(p.h); G.add(flat(0.3, 2.8, white, p.x + fx * 2.9, p.z + fz * 2.9, p.h, 0.05)); G.add(flat(1.2, 0.3, white, p.x + fx * 2.3 - fz * 1.4, p.z + fz * 2.3 + fx * 1.4, p.h, 0.05)); G.add(flat(1.2, 0.3, white, p.x + fx * 2.3 + fz * 1.4, p.z + fz * 2.3 - fx * 1.4, p.h, 0.05)); }
    // start gantry
    { const gx = T.x[0], gz = T.z[0], steel = std({ color: 0x2a2d34, roughness: 0.4, metalness: 0.8 }), span = T.width + 10;
      for (const s of [-1, 1]) { const p = box(0.7, 9, 0.7, steel); p.position.set(gx + T.nx[0] * s * span / 2, 4.5, gz + T.nz[0] * s * span / 2); G.add(p); }
      const bt = canvasTex(512, 64, (c, w, h) => { c.fillStyle = "#101318"; c.fillRect(0, 0, w, h); c.fillStyle = "#fff"; c.font = "italic 900 44px system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("DESK", w / 2 - 44, 34); c.fillStyle = "#ff2d2d"; c.fillText("GP", w / 2 + 62, 34); });
      const beam = box(span + 0.7, 2.2, 0.8, [steel, steel, steel, steel, std({ map: bt, roughness: 0.5 }), std({ map: bt, roughness: 0.5 })]); beam.position.set(gx, 9, gz); beam.rotation.y = -h0 + Math.PI / 2; G.add(beam);
      for (let i = 0; i < 5; i++) { const lm = new THREE.MeshBasicMaterial({ color: 0x2a0505 }); const l = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), lm), o = (i - 2) * 1.5; l.position.set(gx + T.nx[0] * o - Math.cos(h0) * 0.6, 7.3, gz + T.nz[0] * o - Math.sin(h0) * 0.6); G.add(l); lights.push(lm); }
    }
    // pit building + big screen beside the start, grandstand opposite
    const place = (obj, i, side, dist, face = 0) => { obj.position.set(T.x[i] + T.nx[i] * side * dist, 0, T.z[i] + T.nz[i] * side * dist); obj.rotation.y = -T.heading(i) + face; G.add(obj); };
    const pitSide = T.k[wrap(40, T.n)] > 0 ? -1 : 1;
    { const pit = new THREE.Group(), gt = canvasTex(1024, 128, (c, w, h) => { c.fillStyle = "#eef0f2"; c.fillRect(0, 0, w, h); c.fillStyle = "#16181d"; c.fillRect(0, 0, w, 34); for (let i = 0; i < 8; i++) { c.fillStyle = "#2a2e36"; c.fillRect(i * 128 + 14, 52, 100, 76); c.fillStyle = "#ff2d2d"; c.fillRect(i * 128 + 14, 46, 100, 6); c.fillStyle = "#fff"; c.font = "bold 20px system-ui"; c.fillText(String(i + 1).padStart(2, "0"), i * 128 + 20, 24); } });
      const b = box(110, 9, 14, [std({ color: 0xe8eaed }), std({ color: 0xe8eaed }), std({ color: 0xd9dce0 }), std({ color: 0xe8eaed }), std({ map: gt, roughness: 0.6 }), std({ map: gt, roughness: 0.6 })]); b.position.y = 4.5; pit.add(b);
      const glass = box(110, 3.4, 12, std({ color: 0x10202e, roughness: 0.05, metalness: 0.9 })); glass.position.y = 10.7; pit.add(glass);
      const roof = box(114, 0.5, 17, std({ color: 0xf4f5f7 })); roof.position.y = 12.7; pit.add(roof);
      place(pit, wrap(34, T.n), pitSide, 21 + 12, Math.PI / 2 * 0 );
      pit.rotation.y = -T.heading(wrap(34, T.n)) + (pitSide > 0 ? 0 : Math.PI);
      // big screen
      const scr = new THREE.Group(), c = document.createElement("canvas"); c.width = 1024; c.height = 576; monitorCtx = c.getContext("2d");
      monitorTex = new THREE.CanvasTexture(c); monitorTex.colorSpace = THREE.SRGBColorSpace;
      const steel = std({ color: 0x1b1d22, roughness: 0.5, metalness: 0.6 });
      const fr = box(30, 17.5, 1, steel); fr.position.y = 15; scr.add(fr);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(28.6, 16.1), new THREE.MeshBasicMaterial({ map: monitorTex, toneMapped: false })); pl.position.set(0, 15, 0.52); scr.add(pl);
      for (const s of [-1, 1]) { const leg = box(0.8, 7, 0.8, steel); leg.position.set(s * 11, 3.5, 0); scr.add(leg); }
      const si = wrap(-70, T.n); scr.position.set(T.x[si] + T.nx[si] * -pitSide * 27, 0, T.z[si] + T.nz[si] * -pitSide * 27); scr.lookAt(T.x[wrap(si - 60, T.n)], 6, T.z[wrap(si - 60, T.n)]); G.add(scr);
    }
    const standMat = std({ color: 0x8b929c, roughness: 0.8 }), crowdMat = std({ map: crowdTex, roughness: 0.9 }), roofMat = std({ color: 0xf1f3f5, roughness: 0.5, side: THREE.DoubleSide });
    function grandstand() {
      const g = new THREE.Group();
      for (let t = 0; t < 4; t++) { const st = box(44, 2.2, 3.4, [standMat, standMat, crowdMat, standMat, crowdMat, standMat]); st.position.set(0, 1.1 + t * 2.2, t * 3.4); g.add(st); }
      const back = box(44, 13, 0.6, standMat); back.position.set(0, 6.5, 12.2); g.add(back);
      const roof = box(46, 0.4, 15, roofMat); roof.position.set(0, 13.6, 5.5); roof.rotation.x = 0.1; g.add(roof);
      return g;
    }
    { let last = -999, count = 0;
      for (let i = 10; i < T.n - 10 && count < 7; i += 6) {
        if (Math.abs(T.k[i]) > 0.0022 || i - last < 30) continue;
        const side = i < 120 ? -pitSide : (count % 2 ? 1 : -1), d = 21 + 6, x = T.x[i] + T.nx[i] * side * (d + 8), z = T.z[i] + T.nz[i] * side * (d + 8);
        if (i > 20 && i < 95 && side === pitSide) continue;
        if (distToTrack(T, x, z) < d + 5) continue;
        const gs = grandstand(); gs.position.set(T.x[i] + T.nx[i] * side * d, 0, T.z[i] + T.nz[i] * side * d);
        gs.rotation.y = -T.heading(i) + (side > 0 ? 0 : Math.PI); G.add(gs); last = i; count++;
      }
    }
    // trees, and floodlight masts at night
    { const pts = [];
      for (let k = 0; k < 2600 && pts.length < 300; k++) { const x = rnd(-760, 760), z = rnd(-540, 540); if (distToTrack(T, x, z) > 42) pts.push([x, z]); }
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.7, 4, 6), std({ color: 0x5b4030, roughness: 1 }), pts.length), crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(4.2, 1), std({ color: id === "night" ? 0x1f4428 : id === "sunset" ? 0x56752f : 0x3f7f37, roughness: 1, flatShading: true, envMapIntensity: 0.2 }), pts.length);
      const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new V3(), col = new THREE.Color();
      pts.forEach(([x, z], k) => { const s = rnd(0.8, 1.9); mt.compose(new V3(x, 2 * s, z), q, sc.set(s, s, s)); trunk.setMatrixAt(k, mt); mt.compose(new V3(x, 6.4 * s, z), q.setFromEuler(new THREE.Euler(0, rnd(0, 6), 0)), sc.set(s, s * rnd(1.1, 1.6), s)); crown.setMatrixAt(k, mt); crown.setColorAt(k, col.setScalar(rnd(0.75, 1.1))); });
      trunk.castShadow = crown.castShadow = true; crown.receiveShadow = true; G.add(trunk, crown);
      if (id === "night") {
        const mp = []; for (let i = 0; i < T.n; i += 34) { const s = (i / 34) % 2 ? 1 : -1; mp.push([T.x[i] + T.nx[i] * s * 25, T.z[i] + T.nz[i] * s * 25]); }
        const mast = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 16, 6), std({ color: 0x3a3d44, metalness: 0.7, roughness: 0.4 }), mp.length), lampM = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.7, 1.2), new THREE.MeshBasicMaterial({ color: 0xf2f6ff }), mp.length);
        mp.forEach(([x, z], k) => { mt.makeTranslation(x, 8, z); mast.setMatrixAt(k, mt); mt.makeTranslation(x, 16.2, z); lampM.setMatrixAt(k, mt); });
        const glow = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(mp.flatMap(([x, z]) => [x, 16.2, z])), 3)), new THREE.PointsMaterial({ map: softDot, size: 26, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xbfd4ff, opacity: 0.55 }));
        G.add(mast, lampM, glow);
      }
    }
    W.setLights(0, false); W.setMonitor(null);
    skidReset();
  };

  W.setLights = function (n, green) { lights.forEach((m, i) => m.color.set(green ? 0x22ff55 : i < n ? 0xff1a1a : 0x2a0505)); };

  W.setMonitor = function (rows, title = "DESKGP LIVE TIMING") {
    const g = monitorCtx; if (!g) return;
    g.fillStyle = "#0b0e14"; g.fillRect(0, 0, 1024, 576);
    g.fillStyle = "#d8262c"; g.fillRect(0, 0, 1024, 64); g.fillStyle = "#fff"; g.font = "bold 38px system-ui, sans-serif"; g.textBaseline = "middle"; g.textAlign = "left"; g.fillText(title, 28, 34);
    if (!rows) { g.font = "italic 900 120px system-ui, sans-serif"; g.textAlign = "center"; g.fillText("DESK", 420, 320); g.fillStyle = "#ff2d2d"; g.fillText("GP", 720, 320); }
    else rows.slice(0, 8).forEach((r, i) => {
      const y = 100 + i * 58; g.fillStyle = i % 2 ? "#121722" : "#171d2b"; g.fillRect(16, y - 26, 992, 52);
      g.fillStyle = r.color; g.fillRect(84, y - 20, 10, 40);
      g.fillStyle = "#fff"; g.font = "bold 34px system-ui, sans-serif"; g.fillText(String(i + 1), 36, y); g.fillText(r.name.slice(0, 20), 112, y);
      g.fillStyle = "#b9c2d6"; g.textAlign = "right"; g.fillText(r.gap, 990, y); g.textAlign = "left";
    });
    monitorTex.needsUpdate = true;
  };

  // ---------- cars: electric fastback sedan ----------
  const sh = (pts) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const bodyGeo = new THREE.ExtrudeGeometry(sh([[2.36, 0.3], [2.42, 0.52], [2.3, 0.7], [1.5, 0.84], [0.8, 0.9], [-1.55, 0.97], [-2.25, 0.95], [-2.4, 0.78], [-2.4, 0.42], [-2.3, 0.3]]), { depth: 1.72, bevelEnabled: true, bevelSize: 0.13, bevelThickness: 0.13, bevelSegments: 4, curveSegments: 4 }); bodyGeo.translate(0, 0, -0.86);
  const cabinGeo = new THREE.ExtrudeGeometry(sh([[0.95, 0.86], [0.2, 1.33], [-0.55, 1.4], [-1.2, 1.26], [-2.0, 0.95]]), { depth: 1.3, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 4 }); cabinGeo.translate(0, 0, -0.65);
  const wheelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.3, 20); wheelGeo.rotateX(Math.PI / 2);
  const capGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.32, 14); capGeo.rotateX(Math.PI / 2);
  const tyreMat = std({ color: 0x0e0e11, roughness: 0.9, envMapIntensity: 0.2 }), capMat = std({ color: 0x30333a, roughness: 0.3, metalness: 0.9 }), glassMat = std({ color: 0x06080c, roughness: 0.04, metalness: 0.85, envMapIntensity: 1.6 }), underMat = std({ color: 0x0b0c0e, roughness: 0.8 });
  const glowGeo = new THREE.PlaneGeometry(6.4, 3.6);

  function tagTexture(name, color, emote) {
    return canvasTex(256, 64, (g, w, h) => {
      g.font = "bold 26px system-ui, sans-serif"; const text = emote || name, tw = Math.min(236, g.measureText(text).width + (emote ? 20 : 34));
      g.fillStyle = emote ? "rgba(255,255,255,0.95)" : "rgba(10,12,18,0.72)"; g.beginPath(); g.roundRect((w - tw) / 2, 12, tw, 40, 12); g.fill();
      if (!emote) { g.fillStyle = color; g.fillRect((w - tw) / 2 + 8, 20, 6, 24); }
      g.fillStyle = emote ? "#111" : "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2 + (emote ? 0 : 6), 33, 210);
    });
  }

  W.addCar = function (id, color, name, opts = {}) {
    W.removeCar(id);
    const g = new THREE.Group(), tilt = new THREE.Group(); g.add(tilt);
    const ghost = !!opts.ghost;
    const paint = ghost ? std({ color, transparent: true, opacity: 0.28, depthWrite: false, roughness: 0.4 }) : new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.3 });
    const add = (m, x, y, z) => { m.position.set(x, y, z); m.castShadow = !ghost; m.receiveShadow = !ghost; tilt.add(m); return m; };
    add(new THREE.Mesh(bodyGeo, paint), 0, 0, 0);
    add(new THREE.Mesh(cabinGeo, ghost ? paint : glassMat), 0, 0, 0);
    if (!ghost) add(new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.14, 1.8), underMat), 0, 0.24, 0);
    const flap = add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 1.6), ghost ? paint : underMat), -2.2, 1.02, 0);
    const wheels = [];
    for (const [x, z, front] of [[1.48, 0.9, 1], [1.48, -0.9, 1], [-1.45, 0.9, 0], [-1.45, -0.9, 0]]) {
      const piv = new THREE.Group(); piv.position.set(x, 0.37, z); tilt.add(piv);
      const w = new THREE.Mesh(wheelGeo, ghost ? paint : tyreMat); w.castShadow = !ghost; piv.add(w);
      if (!ghost) { w.add(new THREE.Mesh(capGeo, capMat)); const sp = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.07, 0.33), capMat); w.add(sp); const sp2 = sp.clone(); sp2.rotation.z = Math.PI / 2; w.add(sp2); }
      wheels.push({ piv, w, front });
    }
    let brake = null, glow = null, tag = null;
    if (!ghost) {
      for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.5), new THREE.MeshBasicMaterial({ color: 0xf4f8ff })), 2.47, 0.66, s * 0.62).castShadow = false;
      brake = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 1.72), new THREE.MeshBasicMaterial({ color: 0x7a0000 })), -2.52, 0.8, 0); brake.castShadow = false;
      glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ map: softDot, color: 0x49b6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.06; g.add(glow);
      tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTexture(name, color), transparent: true, depthWrite: false })); tag.scale.set(5.6, 1.4, 1); tag.position.y = 2.9; g.add(tag);
    }
    scene.add(g);
    const view = { id, g, tilt, wheels, flap, brake, glow, tag, name, color, ghost, spin: 0, roll: 0, pitch: 0, lastSkid: null, emoteT: 0 };
    W.cars.set(id, view);
    return view;
  };
  W.removeCar = function (id) { const v = W.cars.get(id); if (!v) return; scene.remove(v.g); v.tag?.material.map.dispose(); W.cars.delete(id); };
  W.clearCars = function () { for (const id of [...W.cars.keys()]) W.removeCar(id); };
  W.emote = function (id, text) { const v = W.cars.get(id); if (!v || !v.tag) return; v.tag.material.map.dispose(); v.tag.material.map = tagTexture(v.name, v.color, text); v.emoteT = 2.6; v.tag.scale.set(7.2, 1.8, 1); };
  W.showTag = function (id, on) { const v = W.cars.get(id); if (v?.tag) v.tag.visible = on; };

  W.syncCar = function (id, c, dt) {
    const v = W.cars.get(id); if (!v) return;
    v.g.position.set(c.x, 0.02 + (c.y || 0), c.z); v.g.rotation.y = -c.h;
    v.g.visible = !c.hidden;
    const sp = c.speed ?? Math.hypot(c.vx, c.vz), fx = Math.cos(c.h), fz = Math.sin(c.h), vf = c.vx * fx + c.vz * fz;
    v.spin -= (vf / 0.37) * dt;
    for (const w of v.wheels) { w.w.rotation.z = v.spin; if (w.front) w.piv.rotation.y = -(c.steer || 0) * 0.5; }
    // body language: roll out of the corner, dive under brakes, squat under power
    const latG = (c.w || 0) * sp;
    v.roll += (Math.max(-0.075, Math.min(0.075, latG * 0.0026)) - v.roll) * Math.min(1, 9 * dt);
    v.pitch += (((c.brk || 0) * 0.04 - (c.thr || 0) * 0.016 * (sp < 45 ? 1 : 0.3)) - v.pitch) * Math.min(1, 8 * dt);
    v.tilt.rotation.x = v.roll; v.tilt.rotation.z = v.pitch;
    if (v.ghost) return;
    v.flap.position.y = c.drs ? 0.99 : 1.06; v.flap.rotation.z = c.drs ? 0 : -0.35;
    v.brake.material.color.setHex(c.brk > 0.1 ? 0xff1818 : 0x7a0000);
    const boost = c.boosting || c.padT > 0; v.glow.material.opacity += ((boost ? 0.85 : 0) - v.glow.material.opacity) * Math.min(1, 10 * dt);
    if (v.emoteT > 0) { v.emoteT -= dt; if (v.emoteT <= 0) { v.tag.material.map.dispose(); v.tag.material.map = tagTexture(v.name, v.color); v.tag.scale.set(5.6, 1.4, 1); } }
    // skid marks and smoke from the rear tyres
    const sliding = Math.max(c.slip > 0.3 ? c.slip : 0, c.brk > 0.9 && sp > 25 ? 0.4 : 0);
    if (sliding > 0 && sp > 6) {
      const rx = -fz, rz = fx, bx = c.x - fx * 1.45, bz = c.z - fz * 1.45, now = [bx + rx * 0.9, bz + rz * 0.9, bx - rx * 0.9, bz - rz * 0.9];
      if (v.lastSkid && c.surf !== 2) { skidQuad(v.lastSkid[0], v.lastSkid[1], now[0], now[1], sliding); skidQuad(v.lastSkid[2], v.lastSkid[3], now[2], now[3], sliding); }
      v.lastSkid = now;
      if (Math.random() < 0.5) W.puff(bx, 0.4, bz, c.surf === 2 ? 0xc9b58d : 0xe6e6e6, 0.5 + sliding);
    } else v.lastSkid = null;
    if (c.surf === 2 && sp > 12 && Math.random() < 0.5) W.puff(c.x - fx * 1.6, 0.4, c.z - fz * 1.6, 0xbfae88, 0.9);
  };

  // ---------- skid marks ----------
  const SK = 1600, skPos = new Float32Array(SK * 12), skCol = new Float32Array(SK * 16), skGeo = new THREE.BufferGeometry();
  { const idx = new Uint16Array(SK * 6); for (let i = 0; i < SK; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    skGeo.setAttribute("position", new THREE.BufferAttribute(skPos, 3)); skGeo.setAttribute("color", new THREE.BufferAttribute(skCol, 4)); skGeo.setIndex(new THREE.BufferAttribute(idx, 1)); }
  const skids = new THREE.Mesh(skGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7, side: THREE.DoubleSide }));
  skids.frustumCulled = false; scene.add(skids);
  let skN = 0;
  function skidQuad(x0, z0, x1, z1, a) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.01 || l > 6) return;
    const px = (-dz / l) * 0.16, pz = (dx / l) * 0.16, o = (skN % SK) * 12, al = Math.min(0.55, 0.2 + a * 0.25);
    skPos.set([x0 - px, 0.06, z0 - pz, x0 + px, 0.06, z0 + pz, x1 - px, 0.06, z1 - pz, x1 + px, 0.06, z1 + pz], o);
    for (let k = 0; k < 4; k++) skCol.set([0.02, 0.02, 0.02, al], (skN % SK) * 16 + k * 4);
    skN++; skGeo.attributes.position.needsUpdate = true; skGeo.attributes.color.needsUpdate = true;
  }
  function skidReset() { skPos.fill(0); skCol.fill(0); skN = 0; skGeo.attributes.position.needsUpdate = true; skGeo.attributes.color.needsUpdate = true; for (const v of W.cars.values()) v.lastSkid = null; }

  // ---------- particles ----------
  const PN = 700, pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 4), pSize = new Float32Array(PN), pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN), pMax = new Float32Array(PN), pGrow = new Float32Array(PN), pGrav = new Float32Array(PN);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute("aCol", new THREE.BufferAttribute(pCol, 4)); pGeo.setAttribute("aSize", new THREE.BufferAttribute(pSize, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: softDot }, scale: { value: 600 } }, transparent: true, depthWrite: false,
    vertexShader: "attribute vec4 aCol; attribute float aSize; varying vec4 vCol; uniform float scale; void main(){ vCol=aCol; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*scale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }",
    fragmentShader: "uniform sampler2D map; varying vec4 vCol; void main(){ vec4 t=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vCol.rgb,vCol.a*t.a); if(gl_FragColor.a<0.01) discard; }",
  });
  const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);
  let pN = 0; const col = new THREE.Color();
  function emit(x, y, z, vx, vy, vz, hex, size, life, alpha, grow, grav) {
    const i = pN++ % PN; pPos.set([x, y, z], i * 3); pVel.set([vx, vy, vz], i * 3); col.setHex(hex);
    pCol.set([col.r, col.g, col.b, alpha], i * 4); pSize[i] = size; pLife[i] = pMax[i] = life; pGrow[i] = grow; pGrav[i] = grav;
  }
  W.puff = (x, y, z, hex, s = 1) => emit(x, y, z, rnd(-1, 1), rnd(0.6, 2), rnd(-1, 1), hex, 1.4 * s, rnd(0.5, 1), 0.35, 4, 0);
  W.sparks = (x, z, n = 10) => { for (let i = 0; i < n; i++) emit(x, 0.6, z, rnd(-9, 9), rnd(3, 11), rnd(-9, 9), [0xffd060, 0xffffff, 0xff9030][i % 3], 0.45, rnd(0.25, 0.6), 1, 0, 26); };
  W.confetti = (x, z, n = 90) => { for (let i = 0; i < n; i++) emit(x + rnd(-6, 6), rnd(6, 14), z + rnd(-6, 6), rnd(-7, 7), rnd(4, 16), rnd(-7, 7), [0xd8262c, 0xffd84a, 0x2a63d4, 0x35b56a, 0xffffff, 0xff7fb0][i % 6], 0.8, rnd(1.4, 2.8), 1, 0, 14); };
  function stepParticles(dt) {
    for (let i = 0; i < PN; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt; const o = i * 3;
      pVel[o + 1] -= pGrav[i] * dt;
      pPos[o] += pVel[o] * dt; pPos[o + 1] += pVel[o + 1] * dt; pPos[o + 2] += pVel[o + 2] * dt;
      if (pPos[o + 1] < 0.1 && pGrav[i]) { pPos[o + 1] = 0.1; pVel[o + 1] *= -0.35; pVel[o] *= 0.6; pVel[o + 2] *= 0.6; }
      pSize[i] += pGrow[i] * dt;
      if (pLife[i] <= 0) pCol[i * 4 + 3] = 0; else if (!pGrav[i]) pCol[i * 4 + 3] = 0.35 * (pLife[i] / pMax[i]);
    }
    pGeo.attributes.position.needsUpdate = pGeo.attributes.aCol.needsUpdate = pGeo.attributes.aSize.needsUpdate = true;
  }

  // ---------- camera ----------
  // The camera is rigidly attached to the car's exact position; only its heading, distance and FOV are eased.
  // (Easing the position itself makes the car judder on screen whenever frame times vary.)
  const cam = { h: 0, d: 7, fov: 62, shake: 0, orbit: 0, init: false, look: 0 };
  const angd = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  W.shake = (a) => { cam.shake = Math.max(cam.shake, a); };
  W.snapCamera = () => { cam.init = false; };
  W.updateCamera = function (c, mode, dt) {
    let wantFov = 60;
    if (!c) { // lobby and menus: slow flyover
      cam.orbit += dt * 0.06;
      camera.position.set(Math.sin(cam.orbit) * 420, 120 + Math.sin(cam.orbit * 0.7) * 30, Math.cos(cam.orbit) * 360 + 60); tmp2.set(0, 0, 0); wantFov = 48;
      aimSun(0, 0, 620); head.intensity = 0; cam.init = false; cam.fov = wantFov;
    } else {
      const sp = c.speed || 0, y = c.y || 0;
      const vh = sp > 8 ? Math.atan2(c.vz, c.vx) : c.h;
      const target = c.h + Math.max(-0.6, Math.min(0.6, angd(vh, c.h))) * 0.6; // lean toward where the car is actually going
      if (!cam.init) { cam.h = target; cam.d = 7; cam.look = 0; }
      cam.h += angd(target, cam.h) * (1 - Math.exp(-dt * (mode === 2 ? 30 : 5.5)));
      cam.look += ((c.steer || 0) * 0.18 - cam.look) * (1 - Math.exp(-dt * 4));
      const wantD = 6.6 + sp * 0.03 + (c.boosting ? 1.2 : 0); cam.d += (wantD - cam.d) * (1 - Math.exp(-dt * 3));
      const fx = Math.cos(cam.h), fz = Math.sin(cam.h), lx = Math.cos(cam.h + cam.look), lz = Math.sin(cam.h + cam.look);
      if (mode === 0) { camera.position.set(c.x - fx * cam.d, 3.0 + sp * 0.006 + y, c.z - fz * cam.d); tmp2.set(c.x + lx * 9, -0.2 + y, c.z + lz * 9); wantFov = 60 + 22 * Math.min(1, sp / 92) + (c.boosting || c.padT > 0 ? 7 : 0); }
      else if (mode === 1) { camera.position.set(c.x - fx * 24, 30, c.z - fz * 24); tmp2.set(c.x + fx * 10, 0, c.z + fz * 10); wantFov = 52 + 8 * Math.min(1, sp / 92); }
      else if (mode === 2) { const hx = Math.cos(c.h), hz = Math.sin(c.h); camera.position.set(c.x + hx * 0.5, 1.18 + y, c.z + hz * 0.5); tmp2.set(c.x + hx * 14, 1.0 + y, c.z + hz * 14); wantFov = 72 + 16 * Math.min(1, sp / 92); }
      else { camera.position.set(c.x - 14, 58, c.z + 50); tmp2.set(c.x, 0, c.z); wantFov = 44; }
      aimSun(c.x, c.z, mode === 3 ? 130 : 95);
      if (W.night) { const hx = Math.cos(c.h), hz = Math.sin(c.h); head.intensity = 900; head.position.set(c.x + hx * 2, 0.9, c.z + hz * 2); head.target.position.set(c.x + hx * 30, 0, c.z + hz * 30); } else head.intensity = 0;
      cam.fov += (wantFov - cam.fov) * (cam.init ? 1 - Math.exp(-dt * 4) : 1);
      cam.init = true;
    }
    camera.fov = cam.fov;
    if (cam.shake > 0.001) { camera.position.x += rnd(-1, 1) * cam.shake; camera.position.y += rnd(-1, 1) * cam.shake * 0.6; camera.position.z += rnd(-1, 1) * cam.shake; cam.shake *= Math.pow(0.002, dt); }
    camera.updateProjectionMatrix(); camera.lookAt(tmp2);
    sky.position.set(camera.position.x, 0, camera.position.z); ground.position.x = Math.round(camera.position.x / 60) * 60; ground.position.z = Math.round(camera.position.z / 60) * 60;
  };

  // ---------- frame ----------
  let fAvg = 16, fT = 0;
  W.resize = function () {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * W.scale);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    pMat.uniforms.scale.value = h * renderer.getPixelRatio() * 0.9;
  };
  W.render = function (dt) {
    stepParticles(dt);
    renderer.render(scene, camera);
    // hold the frame rate on weak laptops: drop internal resolution before dropping frames
    fAvg += (dt * 1000 - fAvg) * 0.05; fT += dt;
    if (fT > 2.5) {
      fT = 0;
      if (fAvg > 21 && W.scale > 0.55) { W.scale = Math.max(0.55, W.scale * 0.85); W.resize(); }
      else if (fAvg < 17.2 && W.scale < 1) { W.scale = Math.min(1, W.scale * 1.08); W.resize(); }
    }
  };
  addEventListener("resize", W.resize);
  W.resize();
  return W;
}
