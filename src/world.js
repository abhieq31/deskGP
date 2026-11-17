// Everything you can see: the desk, the circuit taped onto it, office props, cars, effects, camera.
import * as THREE from "three";
import { DESK, PROP_SHAPES, wrap, gridPose } from "./track.js";

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
  day: { top: "#7fb4e6", mid: "#cfe3f2", low: "#e8e2d6", fog: 0xd9dfe2, fogD: 0.00042, sun: 0xfff3dd, sunI: 2.6, sunPos: [-380, 620, 260], hemiS: 0xdcebff, hemiG: 0x8a6a4a, hemiI: 1.15, exp: 1.0, wood: "#b98654" },
  sunset: { top: "#2a2a5e", mid: "#e9785a", low: "#ffc27a", fog: 0xd08a6c, fogD: 0.0006, sun: 0xff9a55, sunI: 2.9, sunPos: [620, 260, -160], hemiS: 0xa58ad0, hemiG: 0x70452c, hemiI: 0.8, exp: 1.05, wood: "#a8703f" },
  night: { top: "#03050c", mid: "#0b1224", low: "#141c30", fog: 0x070b16, fogD: 0.0007, sun: 0x8fa8ff, sunI: 0.35, sunPos: [-300, 600, 300], hemiS: 0x40507a, hemiG: 0x201a14, hemiI: 0.55, exp: 1.15, wood: "#8d6238" },
};

const SLOGANS = ["SYNERGY", "CIRCLE BACK", "PER MY LAST EMAIL", "LET'S TAKE THIS OFFLINE", "Q4", "KPI", "PIVOT", "ASAP", "REPLY ALL", "OUT OF OFFICE", "QUICK SYNC", "LOW-HANGING FRUIT", "DEEP DIVE", "EOD", "TOUCH BASE", "NO AGENDA"];

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.4, 3200);
  camera.position.set(0, 300, 500);
  const W = { renderer, scene, camera, cars: new Map(), T: null, quality: 1, scale: 1 };

  let trackGroup = null, lights = [], monitorTex = null, monitorCtx = null, phoneGlow = [], disposables = [];
  const tmp = new V3(), tmp2 = new V3();

  // ---------- shared textures ----------
  const asphalt = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = "#2c2d31"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = 30 + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + Math.random() * 0.4})`; g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6); }
    const gr = g.createLinearGradient(0, 0, w, 0); // darker rubbered-in middle
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.5, "rgba(0,0,0,0.22)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = "#f2f2ee"; g.fillRect(7, 0, 5, h); g.fillRect(w - 12, 0, 5, h);
  }, { repeat: [1, 1], aniso: 16 });
  const kerbTex = canvasTex(32, 64, (g, w, h) => { g.fillStyle = "#e9e9e4"; g.fillRect(0, 0, w, h); g.fillStyle = "#d8262c"; g.fillRect(0, 0, w, h / 2); }, { repeat: [1, 1] });
  const checker = canvasTex(128, 32, (g, w, h) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? "#111" : "#f4f4f4"; g.fillRect(x * 8, y * 8, 8, 8); } });
  const padTex = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = "#ffe14a"; g.fillRect(0, 0, w, h); g.strokeStyle = "#ff7a00"; g.lineWidth = 7;
    for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(8 + k * 18, 10); g.lineTo(26 + k * 18, 32); g.lineTo(8 + k * 18, 54); g.stroke(); }
  });
  const blobTex = canvasTex(64, 64, (g, w, h) => { const r = g.createRadialGradient(32, 32, 4, 32, 32, 31); r.addColorStop(0, "rgba(0,0,0,0.55)"); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  const softDot = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.4, "rgba(255,255,255,0.5)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2); scene.add(sun); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -600, right: 600, top: 420, bottom: -420, near: 50, far: 1800 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
  const lampLight = new THREE.SpotLight(0xffd9a0, 0, 0, 1.05, 0.7, 0); scene.add(lampLight); scene.add(lampLight.target);
  const screenLight = new THREE.PointLight(0x9ec4ff, 0, 600, 1.2); scene.add(screenLight);

  // ---------- sky dome ----------
  const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 16), skyMat); scene.add(sky);
  function paintSky(m, id) {
    skyMat.map?.dispose();
    skyMat.map = canvasTex(1024, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, m.top); gr.addColorStop(0.47, m.mid); gr.addColorStop(0.56, m.low); gr.addColorStop(1, "#15120f");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      // out-of-focus office: windows, strip lights, somebody else's monitor
      g.filter = "blur(9px)";
      for (let i = 0; i < 26; i++) {
        const x = (i / 26) * w + rnd(-10, 10), ww = rnd(18, 34), y = h * 0.5 - rnd(40, 120), hh = rnd(50, 120);
        if (id === "night") { g.fillStyle = Math.random() < 0.25 ? `rgba(${rnd(180, 255)},${rnd(170, 220)},${rnd(120, 200)},${rnd(0.25, 0.7)})` : "rgba(20,30,60,0.5)"; }
        else if (id === "sunset") g.fillStyle = `rgba(255,${rnd(150, 210)},${rnd(90, 140)},${rnd(0.25, 0.6)})`;
        else g.fillStyle = `rgba(255,255,255,${rnd(0.25, 0.7)})`;
        g.fillRect(x, y, ww, hh);
      }
      g.fillStyle = id === "night" ? "rgba(30,40,70,0.9)" : "rgba(90,80,70,0.55)";
      for (let i = 0; i < 9; i++) g.fillRect(rnd(0, w), h * 0.5 + rnd(0, 20), rnd(40, 120), rnd(30, 80));
      g.filter = "none";
    });
    skyMat.needsUpdate = true;
  }

  // ---------- desk ----------
  const deskMat = std({ roughness: 0.62, metalness: 0.02 });
  const desk = new THREE.Mesh(new THREE.BoxGeometry(DESK.hx * 2, 14, DESK.hz * 2), deskMat);
  desk.position.y = -7; desk.receiveShadow = true; scene.add(desk);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), std({ color: 0x2a2826, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -520; scene.add(floor);
  function paintDesk(m) {
    deskMat.map?.dispose();
    deskMat.map = canvasTex(1024, 1024, (g, w, h) => {
      g.fillStyle = m.wood; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 520; i++) {
        const y = Math.random() * h, a = rnd(0.03, 0.14), f = Math.floor(rnd(1, 4)) * Math.PI * 2 / w, amp = rnd(1, 6);
        g.strokeStyle = Math.random() < 0.5 ? `rgba(60,30,10,${a})` : `rgba(255,225,180,${a})`;
        g.lineWidth = rnd(0.5, 3.5); g.beginPath();
        for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * f + i) * amp);
        g.stroke();
      }
      for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(40,20,5,${rnd(0.03, 0.1)})`; g.fillRect(Math.random() * w, Math.random() * h, rnd(2, 9), 1); }
    }, { repeat: [7, 4.5], aniso: 16 });
    deskMat.needsUpdate = true;
  }

  // ---------- props ----------
  const shadowed = (m, cast = true) => { m.castShadow = cast; m.receiveShadow = true; return m; };
  const box = (w, h, d, mat) => shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
  const cyl = (rt, rb, h, mat, seg = 28) => shadowed(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat));
  const builders = {
    mug(p) {
      const g = new THREE.Group(), col = p.c || "#f4f1ea", m = std({ color: col, roughness: 0.25 });
      const body = cyl(27, 25, 64, m, 40); body.position.y = 32; g.add(body);
      const band = cyl(27.3, 27.1, 12, std({ color: "#d8262c", roughness: 0.3 }), 40); band.position.y = 40; g.add(band);
      const coffee = new THREE.Mesh(new THREE.CircleGeometry(24, 32), std({ color: "#2b1509", roughness: 0.05 })); coffee.rotation.x = -Math.PI / 2; coffee.position.y = 64.2; g.add(coffee);
      const handle = shadowed(new THREE.Mesh(new THREE.TorusGeometry(17, 4.5, 10, 20, Math.PI), m)); handle.rotation.z = -Math.PI / 2; handle.position.set(27, 34, 0); g.add(handle);
      return g;
    },
    keyboard() {
      const g = new THREE.Group(); const base = box(275, 8, 87, std({ color: "#2b2d33", roughness: 0.6 })); base.position.y = 4; g.add(base);
      const keyG = new THREE.BoxGeometry(14.5, 5, 14.5), keyM = std({ color: "#e4e2dc", roughness: 0.7 });
      const inst = new THREE.InstancedMesh(keyG, keyM, 14 * 4 + 9); const mtx = new THREE.Matrix4(); let k = 0;
      for (let r = 0; r < 4; r++) for (let c = 0; c < 14; c++) { mtx.makeTranslation(-117 + c * 18 + (r % 2) * 3, 10.5, -31 + r * 18); inst.setMatrixAt(k++, mtx); }
      for (let c = 0; c < 9; c++) { if (c > 2 && c < 7) continue; mtx.makeTranslation(-117 + c * 18 + (c > 6 ? 54 : 0), 10.5, 41 - 18 + 18); inst.setMatrixAt(k++, mtx); }
      inst.count = k; inst.castShadow = true; inst.receiveShadow = true; g.add(inst);
      const space = box(86, 5, 14.5, keyM); space.position.set(-9, 10.5, 41); g.add(space);
      return g;
    },
    mouse() {
      const g = new THREE.Group(); const b = shadowed(new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: "#1c1d21", roughness: 0.35 })));
      b.scale.set(19, 17, 33); g.add(b);
      const wheel = cyl(3, 3, 3, std({ color: "#888" }), 12); wheel.rotation.z = Math.PI / 2; wheel.position.set(0, 14.5, -14); g.add(wheel);
      return g;
    },
    monitor() {
      const g = new THREE.Group(), dark = std({ color: "#17181c", roughness: 0.4, metalness: 0.3 });
      const base = box(150, 5, 100, dark); base.position.y = 2.5; g.add(base);
      const neck = box(16, 120, 10, dark); neck.position.set(0, 60, -30); g.add(neck);
      const frame = box(370, 215, 9, dark); frame.position.set(0, 190, -22); frame.rotation.x = -0.06; g.add(frame);
      const c = document.createElement("canvas"); c.width = 1024; c.height = 576; monitorCtx = c.getContext("2d");
      monitorTex = new THREE.CanvasTexture(c); monitorTex.colorSpace = THREE.SRGBColorSpace;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(356, 200), new THREE.MeshBasicMaterial({ map: monitorTex, toneMapped: false }));
      scr.position.set(0, 190, -17.2); scr.rotation.x = -0.06; g.add(scr);
      g.userData.screen = new V3(0, 190, 10);
      return g;
    },
    phone() {
      const g = new THREE.Group(); const b = box(46, 4, 94, std({ color: "#101114", roughness: 0.3, metalness: 0.5 })); b.position.y = 2; g.add(b);
      const t = canvasTex(128, 256, (c, w, h) => {
        const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#1b2a55"); gr.addColorStop(1, "#52245e"); c.fillStyle = gr; c.fillRect(0, 0, w, h);
        c.fillStyle = "#fff"; c.font = "bold 34px system-ui"; c.textAlign = "center"; c.fillText("9:41", w / 2, 60);
        c.fillStyle = "rgba(255,255,255,0.9)"; c.beginPath(); c.roundRect(8, 90, w - 16, 62, 10); c.fill();
        c.fillStyle = "#111"; c.font = "bold 13px system-ui"; c.textAlign = "left"; c.fillText("Calendar", 16, 110); c.font = "12px system-ui"; c.fillText("Quick sync - now", 16, 128); c.fillText("\"Should be 5 mins\"", 16, 144);
      });
      const s = new THREE.Mesh(new THREE.PlaneGeometry(42, 90), new THREE.MeshBasicMaterial({ map: t, toneMapped: false })); s.rotation.x = -Math.PI / 2; s.position.y = 4.1; g.add(s);
      return g;
    },
    pad(p) {
      const g = new THREE.Group(), col = p.c || "#ffd84a";
      const t = canvasTex(128, 128, (c, w, h) => {
        c.fillStyle = col; c.fillRect(0, 0, w, h); c.fillStyle = "rgba(0,0,0,0.75)"; c.font = "italic 20px Georgia, serif";
        const notes = [["TODO:", "1. win race", "2. timesheet"], ["call back", "the client", "(after lap)"], ["DO NOT", "unplug!!"], ["lunch?", "12:30", "bring keys"]][Math.floor(Math.random() * 4)];
        notes.forEach((s, i) => c.fillText(s, 12, 34 + i * 28));
      });
      const b = box(47, 6, 47, [std({ color: col }), std({ color: col }), std({ map: t, roughness: 0.9 }), std({ color: col }), std({ color: col }), std({ color: col })]); b.position.y = 3; g.add(b);
      return g;
    },
    pen(p) {
      const g = new THREE.Group(), m = std({ color: p.c || "#2a63d4", roughness: 0.3 });
      const b = cyl(3, 3, 78, m, 10); b.rotation.z = Math.PI / 2; b.position.y = 3; g.add(b);
      const tip = cyl(0.4, 3, 9, std({ color: "#c9c9c9", metalness: 0.8, roughness: 0.3 }), 10); tip.rotation.z = Math.PI / 2; tip.position.set(-43.5, 3, 0); g.add(tip);
      const cap = cyl(3.2, 3.2, 8, std({ color: "#111" }), 10); cap.rotation.z = Math.PI / 2; cap.position.set(41, 3, 0); g.add(cap);
      return g;
    },
    plant() {
      const g = new THREE.Group(); const pot = cyl(34, 26, 52, std({ color: "#c0603a", roughness: 0.85 }), 28); pot.position.y = 26; g.add(pot);
      const leaf = std({ color: "#3d8a45", roughness: 0.8, flatShading: true });
      for (let i = 0; i < 9; i++) { const s = shadowed(new THREE.Mesh(new THREE.IcosahedronGeometry(rnd(16, 26), 1), leaf)); s.position.set(rnd(-22, 22), rnd(62, 112), rnd(-22, 22)); s.scale.y = rnd(0.8, 1.4); g.add(s); }
      return g;
    },
    stapler() {
      const g = new THREE.Group(), red = std({ color: "#c9252b", roughness: 0.35 });
      const b = box(100, 6, 26, std({ color: "#222", roughness: 0.5 })); b.position.y = 3; g.add(b);
      const top = box(98, 13, 23, red); top.position.set(0, 19, 0); top.rotation.z = -0.07; g.add(top);
      const hinge = box(12, 16, 22, red); hinge.position.set(44, 10, 0); g.add(hinge);
      return g;
    },
    lamp(p) {
      const g = new THREE.Group(), m = std({ color: "#2f3238", roughness: 0.4, metalness: 0.6 });
      const base = cyl(40, 42, 6, m, 36); base.position.y = 3; g.add(base);
      const a1 = cyl(3.5, 3.5, 190, m, 10); a1.position.set(0, 98, 0); a1.rotation.z = 0.18; g.add(a1);
      const dir = new V3(-p.x, 0, -p.z).normalize();
      const a2 = cyl(3.5, 3.5, 150, m, 10); a2.position.set(-17 + dir.x * 60, 210, dir.z * 60); a2.lookAt(new V3(-17 + dir.x * 200, 250, dir.z * 200)); a2.rotateX(Math.PI / 2); g.add(a2);
      const head = shadowed(new THREE.Mesh(new THREE.ConeGeometry(34, 44, 24, 1, true), std({ color: "#d8a12a", roughness: 0.4, side: THREE.DoubleSide }))); head.position.set(-17 + dir.x * 130, 222, dir.z * 130); g.add(head);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(11, 12, 8), new THREE.MeshBasicMaterial({ color: p.on ? 0xfff0c0 : 0x999080 })); bulb.position.copy(head.position).y -= 12; g.add(bulb);
      g.userData.bulb = bulb.position.clone();
      return g;
    },
    notebook() {
      const g = new THREE.Group(); const pages = box(127, 7, 177, std({ color: "#f3efe4", roughness: 0.9 })); pages.position.y = 3.5; g.add(pages);
      const cover = box(130, 1.6, 180, std({ color: "#1e2b4f", roughness: 0.6 })); cover.position.y = 8; g.add(cover);
      const band = box(6, 1.9, 180.5, std({ color: "#101010" })); band.position.set(48, 8.1, 0); g.add(band);
      return g;
    },
    donut() {
      const g = new THREE.Group(); const nap = box(70, 0.6, 70, std({ color: "#f6f6f2", roughness: 1 })); nap.position.y = 0.3; nap.rotation.y = 0.5; nap.castShadow = false; g.add(nap);
      const d = shadowed(new THREE.Mesh(new THREE.TorusGeometry(16, 9.5, 14, 30), std({ color: "#c98d4b", roughness: 0.8 }))); d.rotation.x = Math.PI / 2; d.position.y = 10; g.add(d);
      const ice = new THREE.Mesh(new THREE.TorusGeometry(16, 8.2, 10, 30), std({ color: "#ff7fb0", roughness: 0.3 })); ice.rotation.x = Math.PI / 2; ice.position.y = 13; ice.scale.z = 0.8; g.add(ice);
      return g;
    },
  };

  function ribbon(T, i0, i1, a, b, y, vScale, closed) {
    // strip between lateral offsets a..b for samples i0..i1 (inclusive, may wrap)
    const cnt = i1 - i0 + 1, pos = new Float32Array(cnt * 6), uv = new Float32Array(cnt * 4), idx = [];
    for (let k = 0; k < cnt; k++) {
      const i = wrap(i0 + k, T.n);
      pos.set([T.x[i] + T.nx[i] * a, y, T.z[i] + T.nz[i] * a, T.x[i] + T.nx[i] * b, y, T.z[i] + T.nz[i] * b], k * 6);
      uv.set([0, (i0 + k) * vScale, 1, (i0 + k) * vScale], k * 4);
      if (k < cnt - 1) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const decal = (o) => std({ roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...o });
  const flat = (w, d, mat, x, z, rot, y) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.set(-Math.PI / 2, 0, -rot); m.position.set(x, y, z); m.receiveShadow = true; return m; };

  W.setTrack = function (T) {
    if (trackGroup) { scene.remove(trackGroup); trackGroup.traverse((o) => { o.geometry?.dispose(); }); }
    W.T = T; lights = []; monitorTex = null; monitorCtx = null;
    const G = trackGroup = new THREE.Group(); scene.add(G);
    const m = MOODS[T.def.mood]; W.mood = m;
    paintSky(m, T.def.mood); paintDesk(m);
    scene.fog = new THREE.FogExp2(m.fog, m.fogD);
    renderer.toneMappingExposure = m.exp;
    hemi.color.set(m.hemiS); hemi.groundColor.set(m.hemiG); hemi.intensity = m.hemiI;
    sun.color.set(m.sun); sun.intensity = m.sunI; sun.position.set(...m.sunPos); sun.target.position.set(0, 0, 0);
    lampLight.intensity = 0; screenLight.intensity = 0;

    // tarmac
    const road = new THREE.Mesh(ribbon(T, 0, T.n, -T.half, T.half, 0.1, T.step / 22), decal({ map: asphalt, roughness: 0.88 })); road.receiveShadow = true; G.add(road);
    // rubbered racing line
    const line = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    { const pos = new Float32Array((T.n + 1) * 6), idx = [];
      for (let k = 0; k <= T.n; k++) { const i = k % T.n; pos.set([T.lx[i] - T.nx[i] * 1.5, 0.13, T.lz[i] - T.nz[i] * 1.5, T.lx[i] + T.nx[i] * 1.5, 0.13, T.lz[i] + T.nz[i] * 1.5], k * 6); if (k < T.n) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2); }
      line.geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3)); line.geometry.setIndex(idx); }
    G.add(line);
    // kerbs through the corners
    const kerbMat = decal({ map: kerbTex, roughness: 0.7, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    let run = -1;
    for (let i = 0; i <= T.n; i++) {
      const on = i < T.n && Math.abs(T.k[i]) > 0.0075;
      if (on && run < 0) run = i;
      if (!on && run >= 0) {
        if (i - run > 4) {
          const a = Math.max(0, run - 6), b = Math.min(T.n, i + 6);
          for (const s of [-1, 1]) { const km = new THREE.Mesh(ribbon(T, a, b, s * (T.half - 0.3), s * (T.half + 1.7), 0.16, T.step / 5), kerbMat); km.receiveShadow = true; G.add(km); }
        }
        run = -1;
      }
    }
    // start line, grid, pads, spills
    const h0 = T.heading(0);
    G.add(flat(3, T.width, decal({ map: checker, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }), T.x[0], T.z[0], h0, 0.18));
    const white = decal({ color: 0xf2f2ee, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    for (let g = 0; g < 8; g++) { const p = gridPose(T, g), fx = Math.cos(p.h), fz = Math.sin(p.h); G.add(flat(0.35, 2.8, white, p.x + fx * 2.9, p.z + fz * 2.9, p.h, 0.18)); }
    for (const p of T.pads) G.add(flat(7, 7, decal({ map: padTex, emissive: 0xffc400, emissiveIntensity: 0.25, emissiveMap: padTex, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }), p.x, p.z, p.h, 0.19));
    for (const s of T.spills) {
      const sm = new THREE.Mesh(new THREE.CircleGeometry(s.r, 24), std({ color: 0x3a1c0a, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.82, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
      sm.rotation.x = -Math.PI / 2; sm.position.set(s.x, 0.2, s.z); sm.scale.set(1, rnd(0.7, 1), 1); sm.rotation.z = rnd(0, 3); G.add(sm);
    }
    // start gantry: two pencils and a ruler
    { const gx = T.x[0], gz = T.z[0], pencil = std({ color: 0xf2b21c, roughness: 0.5 });
      for (const s of [-1, 1]) {
        const p = cyl(1.1, 1.1, 15, pencil, 6); p.position.set(gx + T.nx[0] * s * (T.half + 3), 7.5, gz + T.nz[0] * s * (T.half + 3)); G.add(p);
        const tip = cyl(0.1, 1.1, 2.4, std({ color: 0xe8c9a0 }), 6); tip.position.copy(p.position).y = 16.2; G.add(tip);
      }
      const rulerT = canvasTex(256, 32, (c, w, h) => { c.fillStyle = "#f5e9b8"; c.fillRect(0, 0, w, h); c.fillStyle = "#333"; for (let i = 0; i < 52; i++) c.fillRect(i * 5, 0, 1, i % 5 ? 8 : 15); c.font = "bold 11px system-ui"; c.fillText("DESKGP", 104, 28); });
      const ruler = box(T.width + 9, 2.6, 0.5, std({ map: rulerT, roughness: 0.5 })); ruler.position.set(gx, 13.5, gz); ruler.rotation.y = -h0 + Math.PI / 2; G.add(ruler);
      for (let i = 0; i < 5; i++) {
        const lm = new THREE.MeshBasicMaterial({ color: 0x2a0505 });
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.78, 12, 8), lm); const o = (i - 2) * 2.2;
        l.position.set(gx + T.nx[0] * o - Math.cos(h0) * 0.5, 11.4, gz + T.nz[0] * o - Math.sin(h0) * 0.5); G.add(l); lights.push(lm);
      }
    }
    // sponsor boards (business cards) along the straights, push pins at the corners
    { let last = -999, bi = 0;
      for (let i = 20; i < T.n; i++) {
        if (Math.abs(T.k[i]) < 0.0015 && i - last > 45) {
          last = i; const side = bi % 2 ? 1 : -1, text = SLOGANS[(bi * 5 + T.n) % SLOGANS.length]; bi++;
          const t = canvasTex(256, 96, (c, w, h) => { c.fillStyle = ["#ffffff", "#101820", "#d8262c", "#ffd84a"][bi % 4]; c.fillRect(0, 0, w, h); c.fillStyle = bi % 4 === 0 || bi % 4 === 3 ? "#111" : "#fff"; c.font = `bold ${text.length > 12 ? 22 : 36}px system-ui, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(text, w / 2, h / 2); });
          const b = box(13, 4.6, 0.3, std({ map: t, roughness: 0.6 })); const d = T.half + 6.5;
          b.position.set(T.x[i] + T.nx[i] * side * d, 2.5, T.z[i] + T.nz[i] * side * d); b.rotation.y = -T.heading(i) + (side > 0 ? Math.PI : 0); G.add(b);
        }
      }
      const pinPos = [];
      for (let i = 0; i < T.n; i += 9) if (Math.abs(T.k[i]) > 0.009) { const s = T.k[i] > 0 ? -1 : 1, d = T.half + 4.5; pinPos.push([T.x[i] + T.nx[i] * s * d, T.z[i] + T.nz[i] * s * d]); }
      if (pinPos.length) {
        const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 10, 8), std({ roughness: 0.3 }), pinPos.length), pins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 5), std({ color: 0xcccccc, metalness: 0.8, roughness: 0.3 }), pinPos.length);
        const mt = new THREE.Matrix4(), cols = [0xd8262c, 0x2a63d4, 0xffd84a, 0x35b56a, 0xffffff];
        pinPos.forEach(([x, z], k) => { mt.makeTranslation(x, 2.6, z); heads.setMatrixAt(k, mt); heads.setColorAt(k, new THREE.Color(cols[k % 5])); mt.makeTranslation(x, 1.1, z); pins.setMatrixAt(k, mt); });
        heads.castShadow = true; G.add(heads, pins);
      }
    }
    { const ringT = canvasTex(128, 128, (c) => { c.strokeStyle = "rgba(70,35,10,0.5)"; c.lineWidth = 5; c.beginPath(); c.arc(64, 64, 54, 0.3, 6.1); c.stroke(); c.lineWidth = 1.5; c.beginPath(); c.arc(66, 63, 50, 0, 6.3); c.stroke(); });
      const rm = new THREE.MeshBasicMaterial({ map: ringT, transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      for (let i = 0; i < 4; i++) { const r = flat(58, 58, rm, rnd(-430, 430), rnd(-260, 260), rnd(0, 6), 0.04); r.receiveShadow = false; G.add(r); } }
    // props
    for (const p of T.def.props) {
      const o = builders[p.t](p); o.position.set(p.x, 0, p.z); o.rotation.y = -(p.rot || 0); G.add(o);
      if (p.t === "lamp" && p.on) {
        o.updateMatrixWorld(); const bp = o.userData.bulb.clone().applyMatrix4(o.matrixWorld);
        lampLight.position.copy(bp).y += 60; lampLight.target.position.set(p.x * 0.25, 0, p.z * 0.25); lampLight.intensity = 5.2;
      }
      if (p.t === "monitor") { o.updateMatrixWorld(); screenLight.position.copy(o.userData.screen.clone().applyMatrix4(o.matrixWorld)); screenLight.intensity = T.def.mood === "night" ? 2.2 : 0.4; }
    }
    renderer.shadowMap.needsUpdate = true;
    W.setLights(0, false); W.setMonitor(null);
    skidReset();
  };

  W.setLights = function (n, green) {
    lights.forEach((m, i) => m.color.set(green ? 0x22ff55 : i < n ? 0xff1a1a : 0x2a0505));
  };

  let monT = 0;
  W.setMonitor = function (rows, title = "DESKGP LIVE TIMING") {
    const g = monitorCtx; if (!g) return;
    g.fillStyle = "#0b0e14"; g.fillRect(0, 0, 1024, 576);
    g.fillStyle = "#d8262c"; g.fillRect(0, 0, 1024, 64); g.fillStyle = "#fff"; g.font = "bold 38px system-ui, sans-serif"; g.textBaseline = "middle"; g.fillText(title, 28, 34);
    if (!rows) { g.fillStyle = "#6b7385"; g.font = "30px system-ui"; g.fillText("Q4_forecast_FINAL_v7 (not responding)", 28, 300); }
    else rows.slice(0, 8).forEach((r, i) => {
      const y = 100 + i * 58; g.fillStyle = i % 2 ? "#121722" : "#171d2b"; g.fillRect(16, y - 26, 992, 52);
      g.fillStyle = r.color; g.fillRect(84, y - 20, 10, 40);
      g.fillStyle = "#fff"; g.font = "bold 34px system-ui, sans-serif"; g.fillText(String(i + 1), 36, y); g.fillText(r.name.slice(0, 20), 112, y);
      g.fillStyle = "#b9c2d6"; g.textAlign = "right"; g.fillText(r.gap, 990, y); g.textAlign = "left";
    });
    monitorTex.needsUpdate = true;
  };

  // ---------- cars ----------
  const wheelGeoF = new THREE.CylinderGeometry(0.44, 0.44, 0.46, 16), wheelGeoR = new THREE.CylinderGeometry(0.47, 0.47, 0.58, 16);
  wheelGeoF.rotateX(Math.PI / 2); wheelGeoR.rotateX(Math.PI / 2);
  const tyreMat = std({ color: 0x15151a, roughness: 0.85 }), carbon = std({ color: 0x1b1c20, roughness: 0.5, metalness: 0.3 });
  const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.6, 10); hubGeo.rotateX(Math.PI / 2);
  const bodyShape = new THREE.Shape([[2.35, 0.2], [2.3, 0.32], [1.2, 0.5], [0.55, 0.62], [0.35, 0.62], [0.3, 0.5], [-0.25, 0.5], [-0.35, 0.98], [-0.75, 1.0], [-1.95, 0.5], [-2.05, 0.2]].map(([x, y]) => new THREE.Vector2(x, y)));
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, { depth: 0.74, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 }); bodyGeo.translate(0, 0, -0.37);
  const blobGeo = new THREE.PlaneGeometry(6.2, 3.6);
  const flameGeo = new THREE.ConeGeometry(0.28, 1.8, 8); flameGeo.rotateZ(Math.PI / 2); flameGeo.translate(-0.9, 0, 0);

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
    const paint = std({ color, roughness: 0.32, metalness: 0.25, transparent: ghost, opacity: ghost ? 0.3 : 1, depthWrite: !ghost });
    const dark = ghost ? paint : carbon, tyre = ghost ? paint : tyreMat;
    const add = (m, x, y, z) => { m.position.set(x, y, z); m.castShadow = false; m.receiveShadow = !ghost; tilt.add(m); return m; };
    add(new THREE.Mesh(bodyGeo, paint), 0, 0, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.12, 1.5), dark), -0.2, 0.16, 0);
    for (const s of [-1, 1]) { add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 0.5), paint), -0.45, 0.42, s * 0.68); add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.06), dark), 2.15, 0.36, s * 0.98); add(new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.06), paint), -2.05, 0.85, s * 0.82); }
    add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 2.0), paint), 2.15, 0.2, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 1.64), dark), -2.05, 0.95, 0);
    const flap = add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 1.64), paint), -2.12, 1.17, 0); flap.rotation.z = -0.5;
    add(new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), std({ color: opts.helmet || 0xffffff, roughness: 0.2, transparent: ghost, opacity: ghost ? 0.3 : 1 })), 0.02, 0.72, 0);
    const halo = add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 6, 14, Math.PI), dark), 0.12, 0.74, 0); halo.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
    const wheels = [];
    for (const [x, z, front] of [[1.5, 0.98, 1], [1.5, -0.98, 1], [-1.5, 0.98, 0], [-1.5, -0.98, 0]]) {
      const piv = new THREE.Group(); piv.position.set(x, front ? 0.44 : 0.47, z); tilt.add(piv);
      const w = new THREE.Mesh(front ? wheelGeoF : wheelGeoR, tyre); piv.add(w);
      const hub = new THREE.Mesh(hubGeo, ghost ? paint : std({ color: 0xd9d9d9, metalness: 0.7, roughness: 0.3 })); w.add(hub);
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, front ? 0.48 : 0.6), ghost ? paint : std({ color, roughness: 0.5 })); w.add(mark);
      wheels.push({ piv, w, front });
    }
    const brake = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.36), new THREE.MeshBasicMaterial({ color: 0x400000 })), -2.1, 0.42, 0);
    const flame = add(new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })), -2.0, 0.42, 0); flame.visible = false;
    let blob = null, tag = null;
    if (!ghost) {
      blob = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 })); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.08; g.add(blob);
      tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTexture(name, color), transparent: true, depthWrite: false })); tag.scale.set(5.6, 1.4, 1); tag.position.y = 2.7; g.add(tag);
    }
    scene.add(g);
    const view = { id, g, tilt, wheels, flap, brake, flame, tag, blob, name, color, ghost, spin: 0, roll: 0, pitch: 0, lastSkid: null, emoteT: 0 };
    W.cars.set(id, view);
    return view;
  };
  W.removeCar = function (id) { const v = W.cars.get(id); if (!v) return; scene.remove(v.g); v.tag?.material.map.dispose(); W.cars.delete(id); };
  W.clearCars = function () { for (const id of [...W.cars.keys()]) W.removeCar(id); };
  W.emote = function (id, text) { const v = W.cars.get(id); if (!v || !v.tag) return; v.tag.material.map.dispose(); v.tag.material.map = tagTexture(v.name, v.color, text); v.emoteT = 2.6; v.tag.scale.set(7.2, 1.8, 1); };
  W.showTag = function (id, on) { const v = W.cars.get(id); if (v?.tag) v.tag.visible = on; };

  // per frame: push a physics state onto its mesh
  W.syncCar = function (id, c, dt) {
    const v = W.cars.get(id); if (!v) return;
    v.g.position.set(c.x, 0.1 + (c.y || 0), c.z); v.g.rotation.y = -c.h;
    v.g.visible = !c.hidden;
    const sp = c.speed ?? Math.hypot(c.vx, c.vz), fx = Math.cos(c.h), fz = Math.sin(c.h);
    const vf = c.vx * fx + c.vz * fz;
    v.spin -= (vf / 0.45) * dt;
    for (const w of v.wheels) { w.w.rotation.z = v.spin; if (w.front) w.piv.rotation.y = -(c.steer || 0) * 0.42; }
    // body language: roll into the slide, dive under brakes, squat under power
    const latG = (c.w || 0) * sp;
    v.roll += (Math.max(-0.09, Math.min(0.09, latG * 0.0022)) - v.roll) * Math.min(1, 10 * dt);
    v.pitch += (((c.brk || 0) * 0.035 - (c.thr || 0) * 0.012 * (sp < 40 ? 1 : 0.3)) - v.pitch) * Math.min(1, 8 * dt);
    v.tilt.rotation.x = v.roll; v.tilt.rotation.z = v.pitch;
    if (c.fall > 0) { v.tilt.rotation.x += c.fall * 5; v.tilt.rotation.z += c.fall * 3; }
    v.flap.rotation.z = c.drs ? -0.05 : -0.5;
    v.brake.material.color.setHex(c.brk > 0.1 ? 0xff2020 : 0x400000);
    v.flame.visible = !!c.boosting || c.padT > 0;
    if (v.flame.visible) { v.flame.scale.x = 0.7 + Math.random() * 0.7; v.flame.material.color.setHex(c.padT > 0 ? 0xffc040 : 0x66ccff); }
    if (v.blob) v.blob.visible = !(c.fall > 0);
    if (v.emoteT > 0) { v.emoteT -= dt; if (v.emoteT <= 0) { v.tag.material.map.dispose(); v.tag.material.map = tagTexture(v.name, v.color); v.tag.scale.set(5.6, 1.4, 1); } }
    if (v.ghost) return;
    // skid marks and smoke from the rear tyres
    const sliding = c.fall > 0 ? 0 : Math.max(c.slip > 0.3 ? c.slip : 0, c.brk > 0.9 && sp > 25 ? 0.4 : 0, c.surf === 3 ? 0.5 : 0);
    if (sliding > 0 && sp > 6) {
      const rx = -fz, rz = fx, bx = c.x - fx * 1.5, bz = c.z - fz * 1.5;
      const now = [bx + rx * 0.98, bz + rz * 0.98, bx - rx * 0.98, bz - rz * 0.98];
      if (v.lastSkid && c.surf !== 2) { skidQuad(v.lastSkid[0], v.lastSkid[1], now[0], now[1], sliding); skidQuad(v.lastSkid[2], v.lastSkid[3], now[2], now[3], sliding); }
      v.lastSkid = now;
      if (Math.random() < 0.5) W.puff(bx, 0.5, bz, c.surf === 3 ? 0x6b4a30 : c.surf === 2 ? 0xc9a57a : 0xdddddd, 0.5 + sliding);
    } else v.lastSkid = null;
    if (c.surf === 2 && sp > 14 && Math.random() < 0.4) W.puff(c.x - fx * 1.6, 0.4, c.z - fz * 1.6, 0xc9a57a, 0.8);
  };

  // ---------- skid marks ----------
  const SK = 1400, skPos = new Float32Array(SK * 12), skCol = new Float32Array(SK * 16), skGeo = new THREE.BufferGeometry();
  { const idx = new Uint16Array(SK * 6); for (let i = 0; i < SK; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    skGeo.setAttribute("position", new THREE.BufferAttribute(skPos, 3)); skGeo.setAttribute("color", new THREE.BufferAttribute(skCol, 4)); skGeo.setIndex(new THREE.BufferAttribute(idx, 1)); }
  const skids = new THREE.Mesh(skGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7, side: THREE.DoubleSide }));
  skids.frustumCulled = false; scene.add(skids);
  let skN = 0;
  function skidQuad(x0, z0, x1, z1, a) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.01 || l > 6) return;
    const px = (-dz / l) * 0.26, pz = (dx / l) * 0.26, o = (skN % SK) * 12, al = Math.min(0.5, 0.18 + a * 0.25);
    skPos.set([x0 - px, 0.15, z0 - pz, x0 + px, 0.15, z0 + pz, x1 - px, 0.15, z1 - pz, x1 + px, 0.15, z1 + pz], o);
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
  W.puff = (x, y, z, hex, s = 1) => emit(x, y, z, rnd(-1, 1), rnd(0.6, 2), rnd(-1, 1), hex, 1.6 * s, rnd(0.5, 1), 0.35, 4, 0);
  W.sparks = (x, z, n = 10) => { for (let i = 0; i < n; i++) emit(x, 0.6, z, rnd(-9, 9), rnd(3, 11), rnd(-9, 9), [0xffd060, 0xffffff, 0xff9030][i % 3], 0.5, rnd(0.25, 0.6), 1, 0, 26); };
  W.confetti = (x, z, n = 90) => { for (let i = 0; i < n; i++) emit(x + rnd(-6, 6), rnd(6, 14), z + rnd(-6, 6), rnd(-7, 7), rnd(4, 16), rnd(-7, 7), [0xd8262c, 0xffd84a, 0x2a63d4, 0x35b56a, 0xffffff, 0xff7fb0][i % 6], 0.8, rnd(1.4, 2.8), 1, 0, 14); };
  function stepParticles(dt) {
    for (let i = 0; i < PN; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt; const o = i * 3;
      pVel[o + 1] -= pGrav[i] * dt;
      pPos[o] += pVel[o] * dt; pPos[o + 1] += pVel[o + 1] * dt; pPos[o + 2] += pVel[o + 2] * dt;
      if (pPos[o + 1] < 0.15 && pGrav[i]) { pPos[o + 1] = 0.15; pVel[o + 1] *= -0.35; pVel[o] *= 0.6; pVel[o + 2] *= 0.6; }
      pSize[i] += pGrow[i] * dt;
      if (pLife[i] <= 0) pCol[i * 4 + 3] = 0; else if (!pGrav[i]) pCol[i * 4 + 3] = 0.35 * (pLife[i] / pMax[i]);
    }
    pGeo.attributes.position.needsUpdate = pGeo.attributes.aCol.needsUpdate = pGeo.attributes.aSize.needsUpdate = true;
  }

  // ---------- camera ----------
  const cam = { h: 0, pos: new V3(0, 300, 500), look: new V3(), fov: 62, shake: 0, orbit: 0, init: false };
  W.shake = (a) => { cam.shake = Math.max(cam.shake, a); };
  W.snapCamera = () => { cam.init = false; };
  W.updateCamera = function (c, mode, dt) {
    let wantFov = 60;
    if (!c) { // lobby and menus: slow flyover
      cam.orbit += dt * 0.07;
      tmp.set(Math.sin(cam.orbit) * 470, 210 + Math.sin(cam.orbit * 0.7) * 40, Math.cos(cam.orbit) * 400 + 80); tmp2.set(0, 0, 0);
      cam.pos.lerp(tmp, cam.init ? Math.min(1, dt * 1.5) : 1); cam.look.lerp(tmp2, cam.init ? Math.min(1, dt * 2) : 1); wantFov = 50;
    } else {
      const sp = c.speed || 0;
      const vh = sp > 6 ? Math.atan2(c.vz, c.vx) : c.h;
      let target = c.h + Math.max(-0.5, Math.min(0.5, angd(vh, c.h))) * 0.5;
      if (!cam.init) cam.h = target;
      cam.h += angd(target, cam.h) * Math.min(1, dt * (mode === 0 ? 7 : 4));
      const fx = Math.cos(cam.h), fz = Math.sin(cam.h), y = c.y || 0;
      if (mode === 0) { // chase
        const d = 7.6 + sp * 0.022; tmp.set(c.x - fx * d, 3.0 + sp * 0.006 + y, c.z - fz * d); tmp2.set(c.x + fx * 7, 1.1 + y, c.z + fz * 7); wantFov = 62 + 20 * Math.min(1, sp / 95) + (c.boosting || c.padT > 0 ? 7 : 0);
      } else if (mode === 1) { // desk cam: tiny cars, big world
        tmp.set(c.x - fx * 26, 34, c.z - fz * 26); tmp2.set(c.x + fx * 10, 0, c.z + fz * 10); wantFov = 52 + 8 * Math.min(1, sp / 95);
      } else if (mode === 2) { // nose
        tmp.set(c.x + fx * 0.6, 1.15 + y, c.z + fz * 0.6); tmp2.set(c.x + fx * 12, 0.9 + y, c.z + fz * 12); wantFov = 74 + 16 * Math.min(1, sp / 95);
      } else { // office drone
        tmp.set(c.x - 14, 62, c.z + 52); tmp2.set(c.x, 0, c.z); wantFov = 44;
      }
      const k = cam.init ? Math.min(1, dt * (mode === 2 ? 40 : 12)) : 1;
      cam.pos.lerp(tmp, k); cam.look.lerp(tmp2, cam.init ? Math.min(1, dt * 16) : 1);
    }
    cam.init = true;
    cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 4);
    camera.position.copy(cam.pos); camera.fov = cam.fov;
    if (cam.shake > 0.001) { camera.position.x += rnd(-1, 1) * cam.shake; camera.position.y += rnd(-1, 1) * cam.shake * 0.6; camera.position.z += rnd(-1, 1) * cam.shake; cam.shake *= Math.pow(0.002, dt); }
    camera.updateProjectionMatrix(); camera.lookAt(cam.look);
    sky.position.copy(camera.position);
  };
  const angd = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

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
    // keep 60 fps on tired laptops: drop internal resolution before dropping frames
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
