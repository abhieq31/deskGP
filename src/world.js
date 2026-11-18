// Everything you can see: circuits (tarmac, kerbs, run-off, barriers, fences, grandstands, hills or a city),
// the cars (Electric GT and Formula) with dents and parts that break off, effects, post-processing and cameras.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { mergeVertices, mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { wrap, gridPose } from "./track.js";
import { layout, rng } from "./layout.js";

const V3 = THREE.Vector3;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = opts.aniso || 8;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
  return t;
}
const std = (o) => new THREE.MeshStandardMaterial(o);

const MOODS = {
  day: { top: "#2f78d0", mid: "#9cc6ee", low: "#e3edf4", hill: "#6d8c78", fog: 0xcad9e6, fogD: 0.00055, sun: 0xfff0d2, sunI: 3.2, sunDir: [-0.45, 0.8, 0.4], hemiS: 0xcfe2ff, hemiG: 0x5c6b46, hemiI: 0.9, exp: 0.95, grass: "#4f8a3c", grass2: "#467d35", hillCol: 0x5f8a45 },
  sunset: { top: "#232a63", mid: "#ef855a", low: "#ffd28c", hill: "#5a3d55", fog: 0xe3a37a, fogD: 0.0007, sun: 0xffa055, sunI: 3.4, sunDir: [0.75, 0.3, -0.4], hemiS: 0xb9a0e0, hemiG: 0x6a4a34, hemiI: 0.8, exp: 1.0, grass: "#6a8238", grass2: "#5e7631", hillCol: 0x8a7a45 },
  night: { top: "#02040a", mid: "#0a1226", low: "#1c2746", hill: "#0a0f1c", fog: 0x0b1222, fogD: 0.0009, sun: 0xdfe8ff, sunI: 1.6, sunDir: [-0.2, 0.95, 0.25], hemiS: 0x7086c0, hemiG: 0x1c2018, hemiI: 0.8, exp: 1.1, grass: "#243f27", grass2: "#1f3822", hillCol: 0x1e3322 },
};
import { BOARD_SPONSORS } from "./teams.js";
const BRANDS = BOARD_SPONSORS;

// ---------- post-processing: speed blur, chromatic kick under boost, grade, vignette ----------
const FinalShader = {
  uniforms: { tDiffuse: { value: null }, uSpeed: { value: 0 }, uBoost: { value: 0 }, uVig: { value: 0.9 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSpeed, uBoost, uVig; varying vec2 vUv;
    void main(){
      vec2 c = vec2(0.5, 0.56), d = vUv - c; float r = length(d);
      float k = uSpeed * smoothstep(0.12, 0.62, r) * 0.032;
      vec3 col = vec3(0.0);
      for (int i = 0; i < 8; i++) { float t = float(i) / 7.0; col += texture2D(tDiffuse, vUv - d * k * t).rgb; }
      col /= 8.0;
      float ca = uBoost * 0.0045 * r;
      col.r = mix(col.r, texture2D(tDiffuse, vUv + d * ca).r, uBoost);
      col.b = mix(col.b, texture2D(tDiffuse, vUv - d * ca).b, uBoost);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.12);              // saturation
      col = (col - 0.18) * 1.05 + 0.18;            // contrast around mid grey (linear)
      col *= mix(1.0, smoothstep(1.05, 0.35, r), uVig * 0.55);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 4500);
  camera.position.set(0, 300, 500);
  const W = { renderer, scene, camera, cars: new Map(), T: null, quality: 1, auto: true, speedFx: 0, boostFx: 0 };

  // post chain
  const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.92);
  composer.addPass(bloom);
  const final = new ShaderPass(FinalShader); composer.addPass(final);
  composer.addPass(new OutputPass());

  let trackGroup = null, lights = [], monitorTex = null, monitorCtx = null, flagMats = [], envRT = null;
  const tmp2 = new V3(), tmpQ = new THREE.Quaternion();

  // ---------- textures ----------
  const asphalt = canvasTex(512, 1024, (g, w, h) => {
    g.fillStyle = "#3a3c41"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 52000; i++) { const v = 40 + Math.random() * 56; g.fillStyle = `rgba(${v},${v},${v + 3},${0.18 + Math.random() * 0.4})`; g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6); }
    for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(0,0,0,${rnd(0.04, 0.09)})`; g.fillRect(rnd(0, w), 0, rnd(30, 120), h); } // repair patches
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.5, "rgba(0,0,0,0.22)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = "#f4f4f0"; g.fillRect(10, 0, 8, h); g.fillRect(w - 18, 0, 8, h);
  }, { repeat: [1, 1], aniso: 16 });
  const asphaltRough = canvasTex(256, 256, (g, w, h) => { g.fillStyle = "#c8c8c8"; g.fillRect(0, 0, w, h); for (let i = 0; i < 9000; i++) { const v = rnd(120, 255); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } }, { repeat: [1, 10], linear: true });
  const kerbTex = canvasTex(32, 64, (g, w, h) => { g.fillStyle = "#f1f1ec"; g.fillRect(0, 0, w, h); g.fillStyle = "#d21f26"; g.fillRect(0, 0, w, h / 2); g.fillStyle = "rgba(0,0,0,0.15)"; g.fillRect(0, h / 2 - 2, w, 2); g.fillRect(0, h - 2, w, 2); }, { repeat: [1, 1] });
  const gravelTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = "#c6b28a"; g.fillRect(0, 0, w, h); for (let i = 0; i < 14000; i++) { const v = rnd(140, 230); g.fillStyle = `rgb(${v},${v * 0.9},${v * 0.72})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, { repeat: [1, 1] });
  const runoffTex = canvasTex(64, 256, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#2556a8" : "#c4212b"; g.fillRect(0, i * 32, w, 32); } g.fillStyle = "rgba(0,0,0,.18)"; for (let i = 0; i < 1200; i++) g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }, { repeat: [1, 1] });
  const wallTex = canvasTex(1024, 64, (g, w, h) => {
    g.fillStyle = "#e9ebee"; g.fillRect(0, 0, w, h);
    const cols = ["#d21f26", "#1d4ed8", "#111318", "#f59e0b", "#0f8a5f", "#6d28d9", "#111318", "#e11d48"];
    for (let i = 0; i < 8; i++) { g.fillStyle = cols[i]; g.fillRect(i * 128 + 6, 8, 116, 48); g.fillStyle = "#fff"; g.font = "italic 900 26px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(BRANDS[i], i * 128 + 64, 33, 104); }
  }, { repeat: [1, 1], aniso: 16 });
  const concreteTex = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = "#b9bcc1"; g.fillRect(0, 0, w, h); for (let i = 0; i < 4000; i++) { const v = rnd(150, 210); g.fillStyle = `rgba(${v},${v},${v},.5)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    for (let i = 0; i < 4; i++) { g.fillStyle = ["#d21f26", "#111318", "#1d4ed8", "#f59e0b"][i]; g.fillRect(i * 128 + 4, 14, 120, 36); g.fillStyle = "#fff"; g.font = "italic 900 22px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(BRANDS[i + 6], i * 128 + 64, 33, 110); }
    g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, h - 5, w, 5); g.fillRect(126, 0, 3, h);
  }, { repeat: [1, 1], aniso: 16 });
  const fenceTex = canvasTex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = "rgba(200,205,210,0.75)"; g.lineWidth = 1.5; for (let i = -64; i < 128; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke(); } }, { repeat: [1, 1] });
  const turfTex = canvasTex(64, 128, (g, w, h) => { g.fillStyle = "#2f8a3a"; g.fillRect(0, 0, w, h); g.fillStyle = "#e8efe9"; g.fillRect(w * 0.42, 0, w * 0.16, h); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${rnd(0.03, 0.09)})`; g.fillRect(rnd(0, w), rnd(0, h), 1.5, 2); } }, { repeat: [1, 1] });
  const checker = canvasTex(128, 32, (g) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? "#111" : "#f4f4f4"; g.fillRect(x * 8, y * 8, 8, 8); } });
  const crowdTex = canvasTex(256, 64, (g, w, h) => { g.fillStyle = "#3a3f4a"; g.fillRect(0, 0, w, h); const c = ["#e63946", "#f1faee", "#ffd60a", "#3a86ff", "#ff9f1c", "#8ecae6", "#222", "#ffb4a2", "#ff8000", "#27f4d2"]; for (let i = 0; i < 1800; i++) { g.fillStyle = c[Math.floor(Math.random() * c.length)]; g.fillRect(Math.random() * w, Math.random() * h, 3, 4); } }, { repeat: [1, 1] });
  const blobTex = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 31); r.addColorStop(0, "rgba(0,0,0,0.75)"); r.addColorStop(0.55, "rgba(0,0,0,0.45)"); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  const softDot = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.4, "rgba(255,255,255,0.5)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  const boardTex = (txt, bg = "#ffffff", fg = "#111") => canvasTex(128, 128, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = "#111"; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); g.fillStyle = fg; g.font = `900 ${txt.length > 3 ? 34 : 56}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(txt, w / 2, h / 2 + 2, 116); });
  const boards = { 150: boardTex("150"), 100: boardTex("100"), 50: boardTex("50"), drs: boardTex("DRS", "#111318", "#2fe37a"), det: boardTex("DRS DET", "#111318", "#ffffff") };

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0xffffff, 0x556644, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3); scene.add(sun); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
  let shadowR = 0; const sunDir = new V3(0, 1, 0);
  function setShadowRange(r) { if (r === shadowR) return; shadowR = r; Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 10, far: 1600 }); sun.shadow.camera.updateProjectionMatrix(); }
  function aimSun(x, z, r) { setShadowRange(r); const q = (r * 2) / sun.shadow.mapSize.x * 4; x = Math.round(x / q) * q; z = Math.round(z / q) * q; sun.target.position.set(x, 0, z); sun.position.set(x + sunDir.x * 700, sunDir.y * 700, z + sunDir.z * 700); }
  const head = new THREE.SpotLight(0xdfeaff, 0, 170, 0.48, 0.55, 1.2); scene.add(head); scene.add(head.target);

  // ---------- sky + ground ----------
  const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3800, 40, 20), skyMat); scene.add(sky);
  function paintSky(m, id) {
    skyMat.map?.dispose();
    skyMat.map = canvasTex(2048, 1024, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h * 0.5); gr.addColorStop(0, m.top); gr.addColorStop(0.75, m.mid); gr.addColorStop(1, m.low);
      g.fillStyle = gr; g.fillRect(0, 0, w, h * 0.5); g.fillStyle = m.low; g.fillRect(0, h * 0.5, w, h * 0.5);
      if (id === "night") for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0.2, 0.9)})`; g.fillRect(rnd(0, w), rnd(0, h * 0.42), rnd(1, 2.2), rnd(1, 2.2)); }
      else {
        const sx = id === "sunset" ? w * 0.42 : w * 0.3, sy = id === "sunset" ? h * 0.45 : h * 0.2, sg = g.createRadialGradient(sx, sy, 0, sx, sy, 280);
        sg.addColorStop(0, "rgba(255,250,225,1)"); sg.addColorStop(0.07, "rgba(255,240,200,0.95)"); sg.addColorStop(1, "rgba(255,220,170,0)"); g.fillStyle = sg; g.fillRect(0, 0, w, h * 0.5);
        g.filter = "blur(14px)";
        for (let i = 0; i < 52; i++) { g.fillStyle = id === "sunset" ? `rgba(255,${rnd(170, 215)},${rnd(150, 190)},${rnd(0.15, 0.4)})` : `rgba(255,255,255,${rnd(0.2, 0.6)})`; g.beginPath(); g.ellipse(rnd(0, w), rnd(h * 0.08, h * 0.4), rnd(60, 200), rnd(10, 26), 0, 0, 6.3); g.fill(); }
        g.filter = "none";
      }
      for (const [amp, base, a] of [[42, 0.5, 0.5], [24, 0.503, 1]]) {
        g.globalAlpha = a; g.fillStyle = m.hill; g.beginPath(); g.moveTo(0, h); const ph = Math.random() * 9;
        for (let x = 0; x <= w; x += 8) { const u = (x / w) * Math.PI * 2; g.lineTo(x, h * base - amp * (0.55 + 0.25 * Math.sin(u * 3 + ph) + 0.15 * Math.sin(u * 7 + ph * 2) + 0.08 * Math.sin(u * 17 + ph))); }
        g.lineTo(w, h); g.fill();
      }
      g.globalAlpha = 1;
      if (id === "night") for (let x = 0; x < w; x += rnd(8, 22)) {
        const bw = rnd(8, 22), bh = rnd(14, 90); g.fillStyle = "#070b16"; g.fillRect(x, h * 0.5 - bh, bw, bh);
        for (let k = 0; k < bh / 5; k++) if (Math.random() < 0.5) { g.fillStyle = `rgba(255,${rnd(190, 240)},${rnd(130, 200)},${rnd(0.4, 0.95)})`; g.fillRect(x + rnd(1, bw - 3), h * 0.5 - bh + 3 + k * 5, 2, 2); }
      }
    }, { aniso: 4 });
    skyMat.needsUpdate = true;
  }
  // reflections come from this circuit's own sky, not a studio
  function buildEnv(m, id) {
    const es = new THREE.Scene();
    es.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.MeshBasicMaterial({ map: skyMat.map, side: THREE.BackSide })));
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(99, 32), new THREE.MeshBasicMaterial({ color: id === "night" ? 0x111318 : new THREE.Color(m.grass).multiplyScalar(0.6) })); gnd.rotation.x = -Math.PI / 2; gnd.position.y = -2; es.add(gnd);
    if (id === "night") for (let i = 0; i < 14; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 1), new THREE.MeshBasicMaterial({ color: 0xffffff })); const a = (i / 14) * Math.PI * 2; l.position.set(Math.cos(a) * 80, 28, Math.sin(a) * 80); l.lookAt(0, 0, 0); es.add(l); }
    const pm = new THREE.PMREMGenerator(renderer); envRT?.dispose(); envRT = pm.fromScene(es, 0.02); pm.dispose();
    scene.environment = envRT.texture; scene.environmentIntensity = id === "night" ? 0.9 : 1.0;
  }
  const groundMat = std({ roughness: 1, metalness: 0, envMapIntensity: 0.12 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), groundMat); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.25; scene.add(ground);
  function grassTex(m, stripes = true) {
    return canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = m.grass; g.fillRect(0, 0, w, h); if (stripes) { g.fillStyle = m.grass2; g.fillRect(0, 0, w / 2, h); }
      for (let i = 0; i < 40; i++) { g.fillStyle = Math.random() < 0.5 ? "rgba(90,70,30,0.05)" : "rgba(0,40,0,0.07)"; g.beginPath(); g.arc(rnd(0, w), rnd(0, h), rnd(10, 40), 0, 6.3); g.fill(); }
      for (let i = 0; i < 6000; i++) { g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,200,0.06)" : "rgba(0,30,0,0.12)"; g.fillRect(Math.random() * w, Math.random() * h, 1.5, rnd(2, 5)); }
    }, { repeat: [1, 1], aniso: 16 });
  }

  // ---------- geometry helpers ----------
  const shadowed = (m, cast = true) => { m.castShadow = cast; m.receiveShadow = true; return m; };
  const box = (w, h, d, mat) => shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
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
  function wallGeo(T, off, y0, y1, uScale) {
    const cnt = T.n + 1, pos = new Float32Array(cnt * 6), uv = new Float32Array(cnt * 4), idx = [];
    for (let k = 0; k < cnt; k++) {
      const i = k % T.n, o = off(i), x = T.x[i] + T.nx[i] * o, z = T.z[i] + T.nz[i] * o;
      pos.set([x, y0, z, x, y1, z], k * 6); uv.set([k * uScale, 0, k * uScale, 1], k * 4);
      if (k < cnt - 1) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const decal = (o) => std({ roughness: 0.9, envMapIntensity: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...o });
  const flat = (w, d, mat, x, z, rot, y) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.set(-Math.PI / 2, 0, -rot); m.position.set(x, y, z); m.receiveShadow = true; return m; };
  const distToTrack = (T, x, z) => T.dist(x, z, 600);
  const HILLS = { monza: 22, silverstone: 14, spa: 120, interlagos: 70 };
  const hillNoise = (x, z) => Math.sin(x * 0.0041 + 1.3) * Math.cos(z * 0.0053 + 0.4) * 0.6 + Math.sin(x * 0.011 + z * 0.007) * 0.25 + Math.sin(x * 0.023 - z * 0.019 + 2) * 0.1 + 0.55;
  const wallOff = (T, s) => (i) => s * (s > 0 ? T.wp[i] : T.wm[i]);

  W.setTrack = function (T, prof) {
    if (trackGroup) { scene.remove(trackGroup); trackGroup.traverse((o) => { o.geometry?.dispose(); }); }
    W.T = T; lights = []; flagMats = []; monitorTex = null; monitorCtx = null;
    const G = trackGroup = new THREE.Group(); scene.add(G);
    const id = T.def.mood, m = MOODS[id], street = !!T.def.street; W.mood = m; W.night = id === "night";
    paintSky(m, id); buildEnv(m, id);
    groundMat.map?.dispose(); groundMat.map = grassTex(m, false); groundMat.map.repeat.set(400, 400); groundMat.color.set(street ? 0x2b2d31 : 0xffffff); groundMat.needsUpdate = true;
    if (street) { groundMat.map = null; }
    scene.fog = new THREE.FogExp2(m.fog, m.fogD); renderer.toneMappingExposure = m.exp;
    hemi.color.set(m.hemiS); hemi.groundColor.set(m.hemiG); hemi.intensity = m.hemiI;
    sun.color.set(m.sun); sun.intensity = m.sunI; sunDir.set(...m.sunDir).normalize(); aimSun(0, 0, 640);
    head.intensity = 0;

    // tarmac and rubbered line
    const road = new THREE.Mesh(ribbon(T, 0, T.n, -T.half, T.half, 0.02, T.step / 30), decal({ map: asphalt, roughnessMap: asphaltRough, roughness: 0.85, envMapIntensity: 0.5, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); road.receiveShadow = true; G.add(road);
    G.add(new THREE.Mesh(ribbon(T, 0, T.n, (i) => T.lo[i] - 1.7, (i) => T.lo[i] + 1.7, 0.03, 1), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })));
    // ground beyond the white line: grass verge (permanent circuits) or concrete/asphalt (street)
    const verge = std({ map: street ? null : grassTex(m), color: street ? 0x4a4d52 : 0xffffff, roughness: 1, envMapIntensity: 0.15 });
    if (!street) { verge.map.repeat.set(1, 1); verge.map.wrapS = verge.map.wrapT = THREE.RepeatWrapping; }
    for (const s of [-1, 1]) { const vm = new THREE.Mesh(ribbon(T, 0, T.n, s * T.half, (i) => wallOff(T, s)(i) + s * 0.2, 0.005, T.step / 12), verge); vm.receiveShadow = true; G.add(vm); }
    // kerbs, and run-off (gravel or painted tarmac) on the outside of corners
    const kerbMat = decal({ map: kerbTex, roughness: 0.6, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const runMat = id === "sunset" ? decal({ map: runoffTex, roughness: 0.8, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }) : decal({ map: gravelTex, roughness: 1, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const tyreRuns = [], turfMat = decal({ map: turfTex, roughness: 0.95, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    let run = -1;
    for (let i = 0; i <= T.n; i++) {
      const on = i < T.n && Math.abs(T.k[i]) > 0.006;
      if (on && run < 0) run = i;
      if (!on && run >= 0) {
        if (i - run > 5) {
          const a = Math.max(0, run - 8), b = Math.min(T.n, i + 8), mid = Math.floor((run + i) / 2), out = T.k[wrap(mid, T.n)] > 0 ? -1 : 1;
          for (const s of [-1, 1]) { const km = new THREE.Mesh(ribbon(T, a, b, s * (T.half - 0.3), (j) => s * Math.min(T.half + 1.6, wallOff(T, s)(j) * s - 0.3), 0.05, T.step / 5), kerbMat); km.receiveShadow = true; G.add(km); }
          if (!street) { const gm = new THREE.Mesh(ribbon(T, Math.max(0, run - 14), Math.min(T.n, i + 24), out * (T.half + 1.6), (j) => wallOff(T, out)(j) - out * 0.3, 0.012, T.step / 9), runMat); gm.receiveShadow = true; G.add(gm); }
          tyreRuns.push([Math.max(0, run - 6), Math.min(T.n - 1, i + 18), out]);
          if (!street) for (const sd of [-1, 1]) { const tm = new THREE.Mesh(ribbon(T, Math.max(0, run - 10), Math.min(T.n, i + 14), sd * (T.half + 1.6), (j) => sd * Math.min(T.half + 3.6, wallOff(T, sd)(j) * sd - 0.4), 0.018, T.step / 6), turfMat); turfMat.map && (tm.receiveShadow = true); G.add(tm); }
        }
        run = -1;
      }
    }
    // barriers
    if (street) {
      const cm = std({ map: concreteTex, roughness: 0.8, envMapIntensity: 0.3 });
      for (const s of [-1, 1]) {
        const w1 = new THREE.Mesh(wallGeo(T, wallOff(T, s), 0, 1.1, T.step / 26), cm); w1.castShadow = w1.receiveShadow = true; G.add(w1);
        const top = new THREE.Mesh(ribbon(T, 0, T.n, (i) => wallOff(T, s)(i), (i) => wallOff(T, s)(i) + s * 0.5, 1.1, 1), std({ color: 0x9ea2a8, roughness: 0.9 })); G.add(top);
        const back = new THREE.Mesh(wallGeo(T, (i) => wallOff(T, s)(i) + s * 0.5, 0, 1.1, T.step / 26), cm); G.add(back);
      }
    } else {
      const wm = std({ map: wallTex, roughness: 0.5, side: THREE.DoubleSide, envMapIntensity: 0.5 });
      for (const s of [-1, 1]) { const w1 = new THREE.Mesh(wallGeo(T, wallOff(T, s), 0, 1.05, T.step / 40), wm); w1.castShadow = true; w1.receiveShadow = true; G.add(w1); }
      // armco rails above the boards
      const steel = std({ color: 0xc7ccd3, roughness: 0.3, metalness: 0.85 });
      for (const s of [-1, 1]) for (const y of [0.55, 0.95]) G.add(new THREE.Mesh(wallGeo(T, (i) => wallOff(T, s)(i) + s * 0.08, y, y + 0.28, 1), steel));
      // tyre walls on the outside of corners
      const tp = []; for (const [a, b, out] of tyreRuns) for (let i = a; i <= b; i += 1) tp.push([i, out]);
      if (tp.length) {
        const tg = new THREE.TorusGeometry(0.34, 0.16, 6, 12); tg.rotateX(Math.PI / 2);
        const ti = new THREE.InstancedMesh(tg, std({ color: 0x18181b, roughness: 0.9 }), tp.length * 3), mt = new THREE.Matrix4(); let k = 0;
        for (const [i, out] of tp) for (let lvl = 0; lvl < 3; lvl++) { const o = wallOff(T, out)(i) - out * 0.55; mt.makeTranslation(T.x[i] + T.nx[i] * o, 0.17 + lvl * 0.32, T.z[i] + T.nz[i] * o); ti.setMatrixAt(k++, mt); }
        ti.castShadow = true; G.add(ti);
      }
    }
    // catch / debris fence behind the barrier, with posts
    { const fm = new THREE.MeshStandardMaterial({ map: fenceTex, color: 0x9aa0a8, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4, envMapIntensity: 0.3 }); fenceTex.repeat.set(1, 1);
      const fh = street ? 4.2 : 3.4;
      for (const s of [-1, 1]) { const g = wallGeo(T, (i) => wallOff(T, s)(i) + s * (street ? 0.5 : 0.35), 1.0, fh, T.step / 2.6); const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) * (fh - 1) / 2.6); G.add(new THREE.Mesh(g, fm)); }
      const post = []; for (let i = 0; i < T.n; i += 3) for (const s of [-1, 1]) post.push([i, s]);
      const pg = new THREE.CylinderGeometry(0.05, 0.05, fh, 5), pm = new THREE.InstancedMesh(pg, std({ color: 0x6b7078, metalness: 0.7, roughness: 0.4 }), post.length), mt = new THREE.Matrix4();
      post.forEach(([i, s], k) => { const o = wallOff(T, s)(i) + s * (street ? 0.5 : 0.35); mt.makeTranslation(T.x[i] + T.nx[i] * o, fh / 2, T.z[i] + T.nz[i] * o); pm.setMatrixAt(k, mt); });
      G.add(pm);
    }
    // start line, grid boxes
    const h0 = T.heading(0);
    G.add(flat(3, T.width, decal({ map: checker, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }), T.x[0], T.z[0], h0, 0.05));
    const white = decal({ color: 0xf2f2ee, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    for (let g = 0; g < 10; g++) { const p = gridPose(T, g), fx = Math.cos(p.h), fz = Math.sin(p.h); G.add(flat(0.3, 2.8, white, p.x + fx * 2.9, p.z + fz * 2.9, p.h, 0.05)); G.add(flat(1.2, 0.3, white, p.x + fx * 2.3 - fz * 1.4, p.z + fz * 2.3 + fx * 1.4, p.h, 0.05)); G.add(flat(1.2, 0.3, white, p.x + fx * 2.3 + fz * 1.4, p.z + fz * 2.3 - fx * 1.4, p.h, 0.05)); }
    // DRS detection and activation lines + boards; braking boards
    const boardPost = std({ color: 0x444 }), boardMats = new Map(), boardMat = (tex) => boardMats.get(tex) || boardMats.set(tex, std({ map: tex, roughness: 0.6 })).get(tex);
    const boardAt = (i, side, tex, d = 1.6) => { const o = wallOff(T, side)(i) - side * d, x = T.x[i] + T.nx[i] * o, z = T.z[i] + T.nz[i] * o; const b = new THREE.Group(); const pl = box(1.3, 1.3, 0.08, boardMat(tex)); pl.position.y = 1.55; b.add(pl); const pst = box(0.08, 1.0, 0.08, boardPost); pst.position.y = 0.5; b.add(pst); b.position.set(x, 0, z); b.rotation.y = -T.heading(i) - Math.PI / 2; G.add(b); };
    for (const zz of T.drsZones) {
      G.add(flat(0.3, T.width, white, T.x[zz.det], T.z[zz.det], T.heading(zz.det), 0.05)); G.add(flat(0.3, T.width, decal({ color: 0x2fe37a, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }), T.x[zz.a], T.z[zz.a], T.heading(zz.a), 0.05));
      boardAt(zz.det, 1, boards.det); boardAt(zz.a, -1, boards.drs); boardAt(zz.a, 1, boards.drs);
    }
    if (prof?.brakeAt) for (const b of prof.brakeAt) { const side = T.k[wrap(b + 40, T.n)] > 0 ? -1 : 1; for (const d of [150, 100, 50]) boardAt(wrap(b - Math.round(d / T.step), T.n), side, boards[d]); }
    // marshal light panels: 3 per sector, on the outside
    for (let sct = 0; sct < 3; sct++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x0b2a14, toneMapped: false }); flagMats.push(mat);
      for (let q = 0; q < 3; q++) { const i = Math.floor(((sct + (q + 0.5) / 3) / 3) * T.n), s = q % 2 ? 1 : -1, o = wallOff(T, s)(i) - s * 0.9; const p = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), mat); p.position.set(T.x[i] + T.nx[i] * o, 1.9, T.z[i] + T.nz[i] * o); p.lookAt(T.x[i] - T.tx[i] * 20, 1.9, T.z[i] - T.tz[i] * 20); G.add(p); const pst = box(0.1, 1.5, 0.1, std({ color: 0x333 })); pst.position.set(p.position.x, 0.75, p.position.z); G.add(pst); }
    }
    // start gantry with the five lights
    { const gx = T.x[0], gz = T.z[0], steel = std({ color: 0x23262d, roughness: 0.35, metalness: 0.8 }), span = T.width + 6;
      for (const s of [-1, 1]) { const p = box(0.7, 9, 0.7, steel); p.position.set(gx + T.nx[0] * s * span / 2, 4.5, gz + T.nz[0] * s * span / 2); G.add(p); }
      const bt = canvasTex(512, 64, (c, w, h) => { c.fillStyle = "#101318"; c.fillRect(0, 0, w, h); c.fillStyle = "#fff"; c.font = "italic 900 44px system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("DESK", w / 2 - 44, 34); c.fillStyle = "#ff2d2d"; c.fillText("GP", w / 2 + 62, 34); });
      const beam = box(span + 0.7, 2.2, 0.8, [steel, steel, steel, steel, std({ map: bt, roughness: 0.5 }), std({ map: bt, roughness: 0.5 })]); beam.position.set(gx, 9, gz); beam.rotation.y = -h0 + Math.PI / 2; G.add(beam);
      for (let i = 0; i < 5; i++) { const lm = new THREE.MeshBasicMaterial({ color: 0x2a0505, toneMapped: false }); const l = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), lm), o = (i - 2) * 1.5; l.position.set(gx + T.nx[0] * o - Math.cos(h0) * 0.6, 7.3, gz + T.nz[0] * o - Math.sin(h0) * 0.6); G.add(l); lights.push(lm); }
    }
    // pit building + big screen + grandstands, at positions checked clear of the whole circuit (layout.js)
    const L = layout(T);
    const pitSide = T.k[wrap(40, T.n)] > 0 ? -1 : 1, outer = (i, s) => wallOff(T, s)(i);
    { const pit = new THREE.Group(), gt = canvasTex(1024, 128, (c, w, h) => { c.fillStyle = "#c9ced4"; c.fillRect(0, 0, w, h); c.fillStyle = "#16181d"; c.fillRect(0, 0, w, 34); for (let i = 0; i < 8; i++) { c.fillStyle = "#2a2e36"; c.fillRect(i * 128 + 14, 52, 100, 76); c.fillStyle = "#ff2d2d"; c.fillRect(i * 128 + 14, 46, 100, 6); c.fillStyle = "#fff"; c.font = "bold 20px system-ui"; c.fillText(String(i + 1).padStart(2, "0"), i * 128 + 20, 24); } });
      const side = std({ color: 0x8d939b, roughness: 0.8, envMapIntensity: 0.3 });
      const b = box(110, 9, 14, [side, side, std({ color: 0x9aa0a8 }), side, std({ map: gt, roughness: 0.6, envMapIntensity: 0.3 }), std({ map: gt, roughness: 0.6, envMapIntensity: 0.3 })]); b.position.y = 4.5; pit.add(b);
      const glass = box(110, 3.4, 12, std({ color: 0x18242f, roughness: 0.25, metalness: 0.5, envMapIntensity: 0.45 })); glass.position.y = 10.7; pit.add(glass);
      const roof = box(114, 0.5, 17, std({ color: 0xf4f5f7 })); roof.position.y = 12.7; pit.add(roof);
      if (L.pit) { pit.position.set(L.pit.x, 0, L.pit.z); pit.rotation.y = -L.pit.rot + (L.pit.flip ? Math.PI : 0); G.add(pit); }
      const scr = new THREE.Group(), c = document.createElement("canvas"); c.width = 1024; c.height = 576; monitorCtx = c.getContext("2d");
      monitorTex = new THREE.CanvasTexture(c); monitorTex.colorSpace = THREE.SRGBColorSpace;
      const st = std({ color: 0x1b1d22, roughness: 0.5, metalness: 0.6 });
      const fr = box(30, 17.5, 1, st); fr.position.y = 15; scr.add(fr);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(28.6, 16.1), new THREE.MeshBasicMaterial({ map: monitorTex, toneMapped: false })); pl.position.set(0, 15, 0.52); scr.add(pl);
      for (const s of [-1, 1]) { const leg = box(0.8, 7, 0.8, st); leg.position.set(s * 11, 3.5, 0); scr.add(leg); }
      if (L.screen) { const si = L.screen.i; scr.position.set(L.screen.x, 0, L.screen.z); scr.lookAt(T.x[wrap(si - 60, T.n)], 6, T.z[wrap(si - 60, T.n)]); G.add(scr); }
    }
    const standMat = std({ color: 0x8b929c, roughness: 0.8 }), crowdMat = std({ map: crowdTex, roughness: 0.9 }), roofMat = std({ color: 0xf1f3f5, roughness: 0.5, side: THREE.DoubleSide });
    const keepOut = []; // footprints other scenery must avoid
    function grandstand() {
      const g = new THREE.Group();
      for (let t = 0; t < 5; t++) { const s = box(44, 2.2, 3.4, [standMat, standMat, crowdMat, standMat, crowdMat, standMat]); s.position.set(0, 1.1 + t * 2.2, t * 3.4); g.add(s); }
      const back = box(44, 15, 0.6, standMat); back.position.set(0, 7.5, 15.6); g.add(back);
      const roof = box(46, 0.4, 18, roofMat); roof.position.set(0, 16, 7); roof.rotation.x = 0.1; g.add(roof);
      return g;
    }
    for (const st of L.stands) { const gs = grandstand(); gs.position.set(st.x, 0, st.z); gs.rotation.y = st.rot; G.add(gs); keepOut.push([st.x, st.z, 34]); }
    if (L.pit) keepOut.push([L.pit.x, L.pit.z, 60]);
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new V3(), col = new THREE.Color(); // shared scratch
    if (street) {
      // city blocks: towers with lit windows, a few rooftop signs, the harbour on one side
      const winTex = (seed) => canvasTex(128, 256, (g, w, h) => {
        g.fillStyle = ["#0b1020", "#111827", "#0f172a"][seed]; g.fillRect(0, 0, w, h);
        for (let y = 6; y < h; y += 12) for (let x = 6; x < w; x += 12) { const lit = Math.random() < 0.42; g.fillStyle = lit ? `rgba(255,${rnd(200, 240)},${rnd(140, 200)},${rnd(0.6, 1)})` : "rgba(40,60,90,0.5)"; g.fillRect(x, y, 7, 7); }
      }, { repeat: [1, 1] });
      const dayTex = (seed) => canvasTex(128, 256, (g, w, h) => { // Riviera facades: cream, ochre, terracotta, with shuttered windows
        g.fillStyle = ["#e9dcc3", "#e3c08f", "#d9a07a", "#f1ece2"][(seed + Math.floor(Math.random() * 4)) % 4]; g.fillRect(0, 0, w, h);
        for (let y = 8; y < h; y += 14) for (let x = 8; x < w; x += 16) { g.fillStyle = "rgba(40,50,60,.75)"; g.fillRect(x, y, 7, 9); g.fillStyle = "rgba(60,110,80,.55)"; g.fillRect(x - 2, y, 2, 9); g.fillRect(x + 7, y, 2, 9); }
      }, { repeat: [1, 1] });
      const night = id === "night";
      const kinds = [0, 1, 2].map((k) => { const t = night ? winTex(k) : dayTex(k); t.repeat.set(2, [3, 6, 10][k]); return new THREE.MeshStandardMaterial({ color: night ? 0x8090a8 : 0xffffff, map: t, emissive: night ? 0xffffff : 0x000000, emissiveMap: night ? t : null, emissiveIntensity: night ? 0.9 : 0, roughness: night ? 0.4 : 0.75, metalness: night ? 0.5 : 0.05 }); });
      const cells = [[], [], []];
      for (const [x, z, w, d, h, k] of L.buildings) cells[k].push([x, z, w, d, h]);
      cells.forEach((list, k) => {
        if (!list.length) return; const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), kinds[k], list.length);
        list.forEach(([x, z, w, d, h], i) => { mt.compose(new V3(x, h / 2, z), q.identity(), sc.set(w, h, d)); im.setMatrixAt(i, mt); });
        im.castShadow = false; im.receiveShadow = true; G.add(im);
      });
      // Monaco: yachts moored in the harbour
      if (L.yachts?.length) {
        const hull = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std({ color: 0xf6f7f8, roughness: 0.3, metalness: 0.1 }), L.yachts.length), deck = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std({ color: 0x1d2a38, roughness: 0.2, metalness: 0.6 }), L.yachts.length);
        L.yachts.forEach(([x, z, len, rot], k) => { const e = new THREE.Euler(0, rot, 0); mt.compose(new V3(x, 1.2, z), q.setFromEuler(e), sc.set(len, 2.6, len * 0.24)); hull.setMatrixAt(k, mt); mt.compose(new V3(x, 3.2, z), q, sc.set(len * 0.5, 1.6, len * 0.18)); deck.setMatrixAt(k, mt); });
        G.add(hull, deck);
      }
      const signs = night ? cells[2].slice(0, 14) : [];
      signs.forEach(([x, z, w, d, h], i) => { const t = canvasTex(256, 64, (g, cw, ch) => { g.fillStyle = "#000"; g.fillRect(0, 0, cw, ch); g.fillStyle = ["#ff2d55", "#00e5ff", "#ffd60a", "#7cff4f"][i % 4]; g.font = "italic 900 40px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(BRANDS[i % BRANDS.length], cw / 2, ch / 2); }); const s = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, w * 0.22), new THREE.MeshBasicMaterial({ map: t, toneMapped: false, side: THREE.DoubleSide })); s.position.set(x, h + w * 0.14, z); s.rotation.y = Math.atan2(-x, -z); G.add(s); });
      const water = new THREE.Mesh(new THREE.PlaneGeometry(8000, 4000), std({ color: night ? 0x0a1628 : 0x1d5f86, roughness: 0.08, metalness: 0.8, envMapIntensity: 1.2 })); water.rotation.x = -Math.PI / 2; water.position.set(0, -0.15, T.box.hz + 80 + 2000); G.add(water);
      // street lights along the circuit
      const lp = []; for (let i = 0; i < T.n; i += 18) for (const s of [-1, 1]) lp.push([i, s]);
      const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 9, 6), std({ color: 0x3a3d44, metalness: 0.7, roughness: 0.4 }), lp.length), lamp = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.25, 0.5), new THREE.MeshBasicMaterial({ color: 0xfff2d8, toneMapped: false }), lp.length);
      lp.forEach(([i, s], k) => { const o = wallOff(T, s)(i) + s * 1.6, x = T.x[i] + T.nx[i] * o, z = T.z[i] + T.nz[i] * o; mt.makeTranslation(x, 4.5, z); pole.setMatrixAt(k, mt); mt.makeTranslation(x - T.nx[i] * s * 0.7, 9, z - T.nz[i] * s * 0.7); lamp.setMatrixAt(k, mt); });
      G.add(pole, lamp);
    } else {
      // a distant city skyline (Interlagos): glass and concrete towers
      if (L.buildings.length) {
        const glass = canvasTex(128, 256, (g, w, h) => { g.fillStyle = "#8fa3b8"; g.fillRect(0, 0, w, h); for (let y = 4; y < h; y += 9) { g.fillStyle = `rgba(30,45,60,${rnd(0.25, 0.5)})`; g.fillRect(0, y, w, 5); } for (let x = 0; x < w; x += 16) { g.fillStyle = "rgba(220,226,232,.5)"; g.fillRect(x, 0, 2, h); } }, { repeat: [2, 8] });
        const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std({ map: glass, roughness: 0.35, metalness: 0.4, envMapIntensity: 0.8 }), L.buildings.length);
        L.buildings.forEach(([x, z, w, d, h], i) => { mt.compose(new V3(x, h / 2 + (W.heightAt ? 0 : 0), z), q.identity(), sc.set(w, h, d)); im.setMatrixAt(i, mt); });
        G.add(im);
      }
      // rolling hills beyond the circuit
      const B = T.box, TW = B.hx * 2 + 2600, TD = B.hz * 2 + 2600, HH = HILLS[T.id] ?? 55;
      const tg = new THREE.PlaneGeometry(TW, TD, Math.round(TW / 26), Math.round(TD / 26)); tg.rotateX(-Math.PI / 2);
      const p = tg.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), z = p.getZ(k), d = distToTrack(T, x, z), edge = Math.max(Math.abs(x) / (TW / 2), Math.abs(z) / (TD / 2));
        let hgt = clamp((d - 70) / 220, 0, 1) ** 2 * (hillNoise(x, z) * HH + 8);
        for (const [kx, kz, kr] of keepOut) if (Math.hypot(x - kx, z - kz) < kr + 30) hgt = 0;
        p.setY(k, hgt * clamp((1 - edge) * 6, 0, 1) - 0.03);
      }
      tg.computeVertexNormals();
      const tt = grassTex(m, false); tt.repeat.set(TW / 15, TD / 15);
      const terr = new THREE.Mesh(tg, std({ map: tt, roughness: 1, envMapIntensity: 0.12 })); terr.receiveShadow = true; G.add(terr);
      W.heightAt = (x, z) => { const d = distToTrack(T, x, z); return clamp((d - 70) / 220, 0, 1) ** 2 * (hillNoise(x, z) * HH + 8); };
      const pts = L.trees.filter(([x, z]) => !keepOut.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr + 8)).map(([x, z, s, r]) => [x, z, W.heightAt(x, z), s, r]);
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.6, 4, 6), std({ color: 0x5b4030, roughness: 1 }), pts.length);
      const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(4.2, 1), std({ color: id === "sunset" ? 0x5d7a2f : 0x3d7c36, roughness: 1, flatShading: true, envMapIntensity: 0.2 }), pts.length);
      const pine = new THREE.InstancedMesh(new THREE.ConeGeometry(3.2, 10, 7), std({ color: 0x2d5a2c, roughness: 1, flatShading: true, envMapIntensity: 0.2 }), pts.length);
      let nc = 0, np = 0;
      pts.forEach(([x, z, y, s, r], k) => { mt.compose(new V3(x, y + 2 * s, z), q.identity(), sc.set(s, s, s)); trunk.setMatrixAt(k, mt);
        if (r < 0.33) { mt.compose(new V3(x, y + 7 * s, z), q.identity(), sc.set(s, s * (1 + r), s)); pine.setMatrixAt(np++, mt); }
        else { mt.compose(new V3(x, y + 6.4 * s, z), q.setFromEuler(new THREE.Euler(0, rnd(0, 6), 0)), sc.set(s, s * rnd(1.1, 1.6), s)); crown.setMatrixAt(nc, mt); crown.setColorAt(nc++, col.setScalar(rnd(0.75, 1.1))); } });
      crown.count = nc; pine.count = np;
      trunk.castShadow = crown.castShadow = pine.castShadow = W.quality > 1; W.treeMeshes = [trunk, crown, pine]; crown.receiveShadow = true; G.add(trunk, crown, pine);
    }
    // sponsor bridges over the straights (pillars checked clear of every stretch of track)
    { const steel = std({ color: 0x2b2e35, roughness: 0.4, metalness: 0.7 }); let last = -999, made = 0;
      const tryAt = (i) => {
        const wp = T.wp[i] + 1.2, wm = T.wm[i] + 1.2, A = [T.x[i] + T.nx[i] * wp, T.z[i] + T.nz[i] * wp], Bp = [T.x[i] - T.nx[i] * wm, T.z[i] - T.nz[i] * wm];
        if (T.dist(A[0], A[1]) < wp - 0.6 || T.dist(Bp[0], Bp[1]) < wm - 0.6) return false;
        const name = BRANDS[(made * 5 + 3) % BRANDS.length], span = wp + wm, h0 = 7.5;
        const tex = canvasTex(1024, 128, (g, w, h) => { g.fillStyle = "#0d0f13"; g.fillRect(0, 0, w, h); g.fillStyle = "#ffffff"; g.font = "italic 900 92px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(name, w / 2, h / 2 + 4, w - 40); g.fillStyle = "#e10600"; g.fillRect(0, h - 8, w, 8); }, { aniso: 8 });
        const br = new THREE.Group(), face = std({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: W.night ? 0.6 : 0.08 });
        const beam = box(span, 2.2, 0.9, [steel, steel, steel, steel, face, face]); beam.position.set(0, h0 + 1.1, 0); br.add(beam);
        for (const sx of [-1, 1]) { const p = box(0.8, h0, 0.8, steel); p.position.set(sx * span / 2, h0 / 2, 0); br.add(p); }
        br.position.set((A[0] + Bp[0]) / 2, 0, (A[1] + Bp[1]) / 2); br.rotation.y = -T.heading(i) + Math.PI / 2; G.add(br); made++; return true;
      };
      for (let i = 120; i < T.n - 80 && made < 3; i += 4) { if (i - last < T.n / 4.5) continue; let st = true; for (let j = -25; j <= 25; j += 5) if (Math.abs(T.k[wrap(i + j, T.n)]) > 0.0016) { st = false; break; } if (st && tryAt(i)) last = i; }
    }
    // TV camera towers at the big corners
    { const scaf = std({ color: 0x9aa0a8, roughness: 0.6, metalness: 0.5 }), camM = std({ color: 0x111316, roughness: 0.4 }); let made = 0, last = -999;
      for (let i = 0; i < T.n && made < 6; i += 6) {
        if (Math.abs(T.k[i]) < 0.012 || i - last < 120) continue; const out = T.k[i] > 0 ? -1 : 1, d = (out > 0 ? T.wp[i] : T.wm[i]) + 6, x = T.x[i] + T.nx[i] * out * d, z = T.z[i] + T.nz[i] * out * d;
        if (T.dist(x, z) < d - 1) continue;
        const tw = new THREE.Group(); const legs = box(2.2, 6, 2.2, scaf); legs.position.y = 3; tw.add(legs); const deck = box(2.8, 0.2, 2.8, scaf); deck.position.y = 6.1; tw.add(deck); const cam = box(0.9, 0.5, 0.4, camM); cam.position.y = 6.6; tw.add(cam);
        tw.position.set(x, 0, z); tw.lookAt(T.x[i], 0, T.z[i]); G.add(tw); made++; last = i;
      }
    }
    // merge every static, single-material circuit mesh by material: hundreds of pieces become a few dozen draw calls
    { G.updateMatrixWorld(true); const keep = new Set([...lights, ...flagMats]), byMat = new Map(), drop = [];
      const split = [];
      G.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || !o.geometry.index) return;
        if (Array.isArray(o.material)) { // multi-material boxes (grandstand rows, pit, bridges): one piece per material group
          if (o.material.some((m) => m.map === monitorTex)) return;
          for (const gr of o.geometry.groups) { const mat = o.material[gr.materialIndex], gg = o.geometry.clone(); gg.setIndex(Array.from(o.geometry.index.array.slice(gr.start, gr.start + gr.count))); gg.clearGroups(); const proxy = { geometry: gg, matrixWorld: o.matrixWorld, castShadow: o.castShadow, parent: null, temp: true }; (byMat.get(mat) || byMat.set(mat, []).get(mat)).push(proxy); }
          split.push(o); return;
        }
        if (keep.has(o.material) || o.material.map === monitorTex) return; const k = o.material; (byMat.get(k) || byMat.set(k, []).get(k)).push(o);
      });
      for (const [mat, list] of byMat) {
        if (list.length < 2 && !list[0].temp) continue;
        const sig = (g) => Object.keys(g.attributes).sort().join();
        const groups = new Map(); for (const m of list) { const k = sig(m.geometry); (groups.get(k) || groups.set(k, []).get(k)).push(m); }
        for (const ms of groups.values()) { if (ms.length < 2 && !ms[0].temp) continue; const geos = ms.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld)); const merged = mergeGeometries(geos, false); geos.forEach((g) => g.dispose()); if (!merged) continue; const mm = new THREE.Mesh(merged, mat); mm.castShadow = false; mm.receiveShadow = true; G.add(mm); drop.push(...ms); }
      }
      for (const m of drop) { if (m.temp) { m.geometry.dispose(); continue; } m.parent.remove(m); m.geometry.dispose(); }
      for (const o of split) { o.parent.remove(o); o.geometry.dispose(); }
    }
    W.setLights(0, false); W.setMonitor(null); W.setFlags([0, 0, 0]);
    skidReset(); clearDebris();
    warm();
  };

  W.resetRace = function () { skidReset(); clearDebris(); }; // nothing from the last race is left lying around
  W.setLights = function (n, green) { lights.forEach((m, i) => m.color.set(green ? 0x22ff55 : i < n ? 0xff1a1a : 0x2a0505)); };
  // flags per sector: 0 clear (dim green), 1 yellow, 2 green (all clear after an incident)
  W.setFlags = function (f) { flagMats.forEach((m, i) => m.color.setHex(f[i] === 1 ? 0xffd000 : f[i] === 2 ? 0x22ff55 : 0x0b2a14)); };

  W.setMonitor = function (rows, title = "LIVE TIMING") {
    const g = monitorCtx; if (!g) return;
    g.fillStyle = "#0b0e14"; g.fillRect(0, 0, 1024, 576);
    g.fillStyle = "#e10600"; g.fillRect(0, 0, 1024, 64); g.fillStyle = "#fff"; g.font = "bold 38px system-ui, sans-serif"; g.textBaseline = "middle"; g.textAlign = "left"; g.fillText(title, 28, 34);
    if (!rows) { g.font = "italic 900 120px system-ui, sans-serif"; g.textAlign = "center"; g.fillText("DESK", 420, 320); g.fillStyle = "#e10600"; g.fillText("GP", 720, 320); }
    else rows.slice(0, 8).forEach((r, i) => {
      const y = 100 + i * 58; g.fillStyle = i % 2 ? "#121722" : "#171d2b"; g.fillRect(16, y - 26, 992, 52);
      g.fillStyle = r.color; g.fillRect(84, y - 20, 10, 40);
      g.fillStyle = "#fff"; g.font = "bold 34px system-ui, sans-serif"; g.fillText(String(i + 1), 36, y); g.fillText(r.name.slice(0, 20), 112, y);
      g.fillStyle = "#b9c2d6"; g.textAlign = "right"; g.fillText(r.gap, 990, y); g.textAlign = "left";
    });
    monitorTex.needsUpdate = true;
  };

  // ---------- racing line (dynamic: green = full throttle, yellow = lift, red = brake) ----------
  const RL = 140, rlPos = new Float32Array(RL * 2 * 3), rlCol = new Float32Array(RL * 2 * 4), rlGeo = new THREE.BufferGeometry();
  { const idx = []; for (let k = 0; k < RL - 1; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2); rlGeo.setIndex(idx); }
  rlGeo.setAttribute("position", new THREE.BufferAttribute(rlPos, 3)); rlGeo.setAttribute("color", new THREE.BufferAttribute(rlCol, 4));
  const rline = new THREE.Mesh(rlGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
  rline.frustumCulled = false; rline.visible = false; scene.add(rline);
  W.setRacingLine = function (c, mode, prof, cls) {
    const T = W.T; if (!c || !mode || !T || !prof) { rline.visible = false; return; }
    rline.visible = true;
    const sp = c.speed, stride = 1 + Math.floor(sp / 45), brake = cls.brake * 0.62;
    let i = wrap(c.idx + 3, T.n), dist = 6;
    for (let k = 0; k < RL; k++) {
      const vi = prof[i], need = (sp * sp - vi * vi) / (2 * Math.max(dist, 1));
      let r = 0.15, g = 0.95, b = 0.35, a = 0.55;
      if (need > brake * 0.8) { r = 1; g = 0.12; b = 0.1; a = 0.75; } else if (need > brake * 0.25) { r = 1; g = 0.82; b = 0.1; a = 0.65; }
      else if (mode === 1 && vi > cls.vtop * 0.97) a = 0;
      a *= clamp(k / 6, 0, 1) * clamp((RL - k) / 20, 0, 1);
      const o = T.lo[i], cx = T.x[i] + T.nx[i] * o, cz = T.z[i] + T.nz[i] * o;
      rlPos.set([cx - T.nx[i] * 0.45, 0.04, cz - T.nz[i] * 0.45, cx + T.nx[i] * 0.45, 0.04, cz + T.nz[i] * 0.45], k * 6);
      rlCol.set([r, g, b, a, r, g, b, a], k * 8);
      i = wrap(i + stride, T.n); dist += stride * T.step;
    }
    rlGeo.attributes.position.needsUpdate = rlGeo.attributes.color.needsUpdate = true;
  };

  // ---------- cars ----------
  // smooth-shaded body from a side profile, rounded in plan view
  function shell(pts, depth, taper, bevel = 0.1) {
    const shp = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    let g = new THREE.ExtrudeGeometry(shp, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 6 });
    g.translate(0, 0, -depth / 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k); p.setZ(k, p.getZ(k) * taper(x, y)); }
    g.deleteAttribute("normal"); g.deleteAttribute("uv"); g = mergeVertices(g, 1e-3); g.computeVertexNormals();
    return g;
  }
  const arch = (cx, r, a0, a1, n = 8) => Array.from({ length: n + 1 }, (_, k) => { const a = a0 + (a1 - a0) * (k / n); return [cx + Math.cos(a) * r, 0.37 + Math.sin(a) * r]; });
  // Electric GT: low fastback four-door
  const GT_BODY = [[2.4, 0.34], [2.47, 0.52], [2.38, 0.66], [1.95, 0.78], [1.2, 0.86], [0.9, 0.9], [-1.6, 0.98], [-2.22, 0.96], [-2.44, 0.8], [-2.46, 0.46], [-2.34, 0.3],
    [-1.93, 0.3], ...arch(-1.45, 0.47, Math.PI, 0, 8).slice(1, -1), [-0.97, 0.3], [0.99, 0.3], ...arch(1.47, 0.47, Math.PI, 0, 8).slice(1, -1), [1.95, 0.3]];
  const gtTaper = (x, y) => (1 - 0.13 * clamp((Math.abs(x) - 1.55) / 0.9, 0, 1) ** 2) * (y > 0.8 ? 1 - (y - 0.8) * 0.45 : 1);
  const GT_CAB = [[1.0, 0.86], [0.35, 1.3], [-0.4, 1.41], [-1.25, 1.3], [-2.05, 0.97], [-1.6, 0.9], [0.8, 0.86]];
  const gtCabTaper = (x, y) => (y > 0.9 ? 1 - (y - 0.9) * 0.6 : 1) * (1 - 0.1 * clamp((-x - 1.4) / 0.7, 0, 1));
  // Formula: tub with airbox, sidepods
  const F1_TUB = [[2.85, 0.16], [2.85, 0.24], [1.9, 0.42], [0.8, 0.6], [0.4, 0.64], [-0.15, 0.62], [-0.35, 0.98], [-1.05, 0.95], [-1.9, 0.62], [-2.2, 0.36], [-2.15, 0.14]];
  const f1Taper = (x, y) => (x > 0.7 ? 1 - 0.7 * clamp((x - 0.7) / 2.15, 0, 1) : x < -1.2 ? 1 - 0.45 * clamp((-1.2 - x) / 1, 0, 1) : 1) * (y > 0.7 ? 1 - (y - 0.7) * 0.9 : 1);
  const F1_POD = [[0.6, 0.16], [0.6, 0.54], [0.25, 0.6], [-1.3, 0.44], [-1.85, 0.2], [-1.85, 0.16]];
  const podTaper = (x, y) => (x < -0.6 ? 1 - 0.45 * clamp((-0.6 - x) / 1.25, 0, 1) : 1);
  const geoCache = {};
  const cached = (k, f) => geoCache[k] || (geoCache[k] = f());
  const tyreMat = std({ color: 0x0e0e11, roughness: 0.9, envMapIntensity: 0.25 }), capMat = std({ color: 0x2c2f36, roughness: 0.25, metalness: 0.9 }), glassMat = std({ color: 0x05070a, roughness: 0.03, metalness: 0.9, envMapIntensity: 1.8 }), carbon = std({ color: 0x101114, roughness: 0.45, metalness: 0.3, envMapIntensity: 0.6 });
  const stripeMat = std({ color: 0xffd000, roughness: 0.6 });
  const numTex = (n, color) => canvasTex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = "#fff"; g.beginPath(); g.arc(64, 64, 58, 0, 6.3); g.fill(); g.fillStyle = "#111"; g.font = "italic 900 64px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), 64, 68); });

  const decalCache = new Map();
  function decalTex(text, fg = "#ffffff", w = 512, h = 96, italic = true) {
    const k = text + fg + w + h; if (decalCache.has(k)) return decalCache.get(k);
    const t = canvasTex(w, h, (g) => { g.clearRect(0, 0, w, h); g.fillStyle = fg; g.font = `${italic ? "italic " : ""}900 ${Math.round(h * 0.72)}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, h / 2 + 3, w - 12); });
    decalCache.set(k, t); return t;
  }
  const decalMat = (t) => new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.35, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const ink = (hex) => { const c = new THREE.Color(hex); return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.62 ? "#111318" : "#ffffff"; };
  function emoteTex(text) { return canvasTex(128, 128, (g) => { g.fillStyle = "rgba(255,255,255,.92)"; g.beginPath(); g.arc(64, 60, 48, 0, 6.3); g.fill(); g.font = "64px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 64, 64); }); }

  // a thin rod between two points (suspension arms, mirror stalks)
  const rodGeo = (a, b, r) => { const d = new V3().subVectors(b, a), g = new THREE.CylinderGeometry(r, r, d.length(), 6); g.rotateZ(Math.PI / 2); const q = new THREE.Quaternion().setFromUnitVectors(new V3(1, 0, 0), d.clone().normalize()); g.applyQuaternion(q); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return g; };
  const redMat = std({ color: 0xc8102e, roughness: 0.4, metalness: 0.3 }), discMat = std({ color: 0x3a3c40, roughness: 0.5, metalness: 0.8 }), chromeLess = std({ color: 0x07080a, roughness: 0.3, metalness: 0.4 });
  const colored = (geo, hex) => { geo = geo.index ? geo : geo; for (const k of Object.keys(geo.attributes)) if (k !== "position" && k !== "normal") geo.deleteAttribute(k); const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); geo.setAttribute("color", new THREE.BufferAttribute(a, 3)); return geo; };
  function wheelGeo(f1, r, wdt, side, accent) {
    const parts = [], cyl = (rr, l, seg) => { const k = new THREE.CylinderGeometry(rr, rr, l, seg); k.rotateX(Math.PI / 2); return k; };
    parts.push(colored(cyl(r, wdt, 26), 0x111114));
    parts.push(colored(cyl(r * 0.68, wdt + 0.02, 18), f1 ? 0x1a1b1f : 0x34373e));
    if (f1) { const cv = new THREE.CircleGeometry(r * 0.66, 22); cv.rotateY(side > 0 ? 0 : Math.PI); cv.translate(0, 0, side * (wdt / 2 + 0.013)); parts.push(colored(cv, accent)); const ring = new THREE.TorusGeometry(r * 0.82, 0.018, 4, 26); ring.translate(0, 0, side * (wdt / 2 + 0.006)); parts.push(colored(ring, 0xffd000)); }
    else for (let k = 0; k < 5; k++) { const sp = new THREE.BoxGeometry(0.42, 0.055, 0.04); sp.rotateZ((k * 2 * Math.PI) / 5); sp.translate(0, 0, side * (wdt / 2 + 0.012)); parts.push(colored(sp, 0x9aa1ab)); }
    return mergeGeometries(parts, false);
  }
  function brakeGeo(f1, r, wdt, side) {
    const d = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.03, 18); d.rotateX(Math.PI / 2); d.translate(0, 0, side * (wdt / 2 - 0.08));
    const c = new THREE.BoxGeometry(0.12, 0.16, 0.06); c.translate(-0.12, 0.16, side * (wdt / 2 - 0.07));
    return mergeGeometries([colored(d, 0x44474d), colored(c, f1 ? 0x18191c : 0xc8102e)], false);
  }
  // Build a car (not added to any scene). team: { name, body, accent, ink, second[] }.
  function buildCar(color, clsId, opts = {}) {
    const g = new THREE.Group(), tilt = new THREE.Group(); g.add(tilt);
    const ghost = !!opts.ghost, f1 = clsId === "f1", team = opts.team || { name: opts.sponsor || "DESKGP", accent: opts.accent || "#111318", ink: ink(color), second: [] };
    const paint = ghost ? std({ color, transparent: true, opacity: 0.25, depthWrite: false, roughness: 0.4 }) : new THREE.MeshPhysicalMaterial({ color, roughness: 0.24, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3 });
    const accentMat = ghost ? paint : new THREE.MeshPhysicalMaterial({ color: team.accent, roughness: 0.3, metalness: 0.4, clearcoat: 0.8, envMapIntensity: 1.1 });
    const dark = ghost ? paint : carbon;
    const statics = [];
    // add(): every mesh here is static (merged later) unless it is a part that can break off, deforms, or moves
    const add = (m, x, y, z, parent = tilt, isStatic = true) => { m.position.set(x, y, z); m.castShadow = !ghost; m.receiveShadow = !ghost; parent.add(m); if (isStatic && parent === tilt && !ghost) statics.push(m); return m; };
    const B = (w, h, d, mat, x, y, z, rz = 0, ry = 0) => { const m = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), x, y, z); m.rotation.set(0, ry, rz); return m; };
    const R = (a, b, r, mat) => add(new THREE.Mesh(rodGeo(a, b, r), mat), 0, 0, 0);
    const atlasQ = [];
    const decal = (tex, w, h, x, y, z, ry, rx = 0, parent = tilt) => {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(w, h), decalMat(tex)); d.position.set(x, y, z); d.rotation.set(rx, ry, 0); d.castShadow = false; parent.add(d);
      if (parent === tilt && !ghost) atlasQ.push(d); return d;
    };
    const parts = {}, deform = [];
    let wheelR = 0.37;
    const wheelSpec = f1 ? [[1.86, 0.84, 1, 0.36, 0.37], [1.86, -0.84, 1, 0.36, 0.37], [-1.72, 0.82, 0, 0.37, 0.46], [-1.72, -0.82, 0, 0.37, 0.46]] : [[1.47, 0.89, 1, 0.37, 0.3], [1.47, -0.89, 1, 0.37, 0.3], [-1.45, 0.89, 0, 0.37, 0.3], [-1.45, -0.89, 0, 0.37, 0.3]];
    let flap, brake, glow;
    const title = team.short || team.name, sec = team.second || [];
    if (!f1) {
      const body = add(new THREE.Mesh(ghost ? cached("gtb", () => shell(GT_BODY, 1.76, gtTaper)) : shell(GT_BODY, 1.76, gtTaper), paint), 0, 0, 0, tilt, false); deform.push(body);
      const cab = add(new THREE.Mesh(ghost ? cached("gtc", () => shell(GT_CAB, 1.36, gtCabTaper, 0.08)) : shell(GT_CAB, 1.36, gtCabTaper, 0.08), ghost ? paint : glassMat), 0, 0, 0, tilt, false); deform.push(cab);
      if (!ghost) {
        // trim and detail
        for (const s of [-1, 1]) {
          B(3.0, 0.035, 0.02, chromeLess, -0.45, 0.9, s * 0.995);          // window line
          B(3.3, 0.14, 0.03, dark, 0, 0.3, s * 0.99);                       // side skirt
          B(0.012, 0.42, 0.01, chromeLess, 0.35, 0.62, s * 1.077); B(0.012, 0.42, 0.01, chromeLess, -0.75, 0.62, s * 1.077); // door seams
          B(0.18, 0.02, 0.012, chromeLess, 0.1, 0.72, s * 1.078); B(0.18, 0.02, 0.012, chromeLess, -1.0, 0.72, s * 1.078); // handles
          const hl = B(0.12, 0.07, 0.5, new THREE.MeshBasicMaterial({ color: 0xf4f8ff, toneMapped: false }), 2.53, 0.64, s * 0.58, 0, s * 0.25); hl.castShadow = false;
          B(0.06, 0.03, 0.22, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 2.5, 0.42, s * 0.7);   // fog slit
        }
        B(0.1, 0.12, 1.1, chromeLess, 2.49, 0.42, 0);                           // lower intake
        for (const z of [-0.45, 0, 0.45]) B(0.3, 0.12, 0.02, dark, -2.5, 0.3, z); // diffuser fins
        B(0.06, 0.03, 1.7, dark, -2.56, 0.55, 0);
        B(0.22, 0.05, 0.05, dark, -1.0, 1.42, 0);                               // roof fin antenna
        parts.splitter = add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 1.86), dark), 2.42, 0.25, 0, tilt, false);
        parts.diffuser = add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 1.56), dark), -2.5, 0.3, 0, tilt, false);
        for (const [k, s] of [["mirrorL", -1], ["mirrorR", 1]]) { const m = new THREE.Group(); const h = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.24), paint), st = new THREE.Mesh(rodGeo(new V3(0, -0.06, -s * 0.12), new V3(0, 0, 0), 0.02), dark); h.castShadow = true; m.add(h, st); m.position.set(0.82, 0.98, s * 1.1); tilt.add(m); parts[k] = m; }
        brake = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 1.66), new THREE.MeshBasicMaterial({ color: 0x7a0000, toneMapped: false })), -2.57, 0.8, 0, tilt, false); brake.castShadow = false;
        // livery: accent stripe, title sponsor on the doors, secondary sponsors on the hood and boot, number
        const spTex = decalTex(title, team.ink || ink(color));
        for (const s of [-1, 1]) {
          const ry = s > 0 ? 0 : Math.PI;
          decal(numTex(opts.number ?? 1), 0.6, 0.6, -1.3, 0.66, s * 1.076, ry);
          decal(spTex, 2.1, 0.36, 0.0, 0.5, s * 1.082, ry);
          const st = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 0.07), accentMat); st.position.set(0, 0.38, s * 1.081); st.rotation.y = ry; tilt.add(st);
          if (sec[0]) decal(decalTex(sec[0], team.ink || ink(color), 512, 96), 0.75, 0.13, 1.75, 0.66, s * 1.02, ry - s * 0.08);
        }
        if (sec[1]) decal(decalTex(sec[1], team.ink || ink(color)), 0.9, 0.17, 1.65, 0.835, 0, -Math.PI / 2, -Math.PI / 2 + 0.13);
        decal(decalTex(title, "#ffffff"), 1.0, 0.18, -2.12, 1.06, 0, -Math.PI / 2, -0.75);
      }
      flap = parts.spoiler = add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 1.5), dark), -2.3, 1.08, 0, tilt, false);
    } else {
      const tub = add(new THREE.Mesh(ghost ? cached("f1t", () => shell(F1_TUB, 0.62, f1Taper, 0.06)) : shell(F1_TUB, 0.62, f1Taper, 0.06), paint), 0, 0, 0, tilt, false); deform.push(tub);
      for (const s of [-1, 1]) { const pod = add(new THREE.Mesh(ghost ? cached("f1p", () => shell(F1_POD, 0.36, podTaper, 0.07)) : shell(F1_POD, 0.36, podTaper, 0.07), paint), 0, 0, s * 0.5, tilt, false); deform.push(pod); }
      B(4.3, 0.05, 1.5, dark, -0.15, 0.1, 0);                                    // floor
      if (!ghost) {
        add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), std({ color: opts.helmet || team.accent || 0xffd000, roughness: 0.2, metalness: 0.3 })), 0.08, 0.72, 0);
        const visor = add(new THREE.Mesh(new THREE.SphereGeometry(0.172, 16, 8, -0.9, 1.8, 1.2, 0.5), glassMat), 0.08, 0.72, 0); visor.rotation.y = 0;
        const halo = add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 6, 18, Math.PI), dark), 0.22, 0.76, 0); halo.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
        B(0.05, 0.2, 0.05, dark, 0.55, 0.68, 0);
        B(1.1, 0.32, 0.02, paint, -1.35, 0.95, 0);                                  // shark fin
        B(0.12, 0.06, 0.08, dark, -0.45, 1.0, 0);                                   // T-cam
        for (const s of [-1, 1]) {
          B(0.5, 0.42, 0.02, dark, 0.95, 0.32, s * 0.6, 0, s * 0.15);               // barge boards
          const mh = B(0.14, 0.07, 0.16, paint, 0.62, 0.66, s * 0.42); R(new V3(0.66, 0.64, s * 0.35), new V3(0.6, 0.5, s * 0.22), 0.012, dark); // mirrors
          // suspension wishbones to each wheel
          const fx = 1.86, rx = -1.72, fz = s * 0.84, rz = s * 0.82;
          R(new V3(1.45, 0.42, s * 0.12), new V3(fx, 0.42, fz * 0.88), 0.022, dark); R(new V3(2.15, 0.36, s * 0.1), new V3(fx, 0.36, fz * 0.88), 0.022, dark);
          R(new V3(1.5, 0.22, s * 0.15), new V3(fx, 0.26, fz * 0.88), 0.022, dark); R(new V3(2.1, 0.2, s * 0.12), new V3(fx, 0.26, fz * 0.88), 0.022, dark);
          R(new V3(-1.25, 0.42, s * 0.3), new V3(rx, 0.44, rz * 0.86), 0.022, dark); R(new V3(-2.05, 0.38, s * 0.25), new V3(rx, 0.44, rz * 0.86), 0.022, dark);
          R(new V3(-1.3, 0.22, s * 0.3), new V3(rx, 0.24, rz * 0.86), 0.022, dark);
        }
        const fw = new THREE.Group(); tilt.add(fw); parts.fwing = fw;
        add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 1.96), dark), 2.72, 0.1, 0, fw);
        const f2 = add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.025, 1.92), accentMat), 2.62, 0.16, 0, fw); f2.rotation.z = 0.3;
        const f3 = add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.022, 1.88), paint), 2.48, 0.22, 0, fw); f3.rotation.z = 0.5;
        add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.05), dark), 2.4, 0.2, 0, fw);              // nose pillar
        parts.epL = add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.24, 0.03), paint), 2.7, 0.2, -0.98, tilt, false);
        parts.epR = add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.24, 0.03), paint), 2.7, 0.2, 0.98, tilt, false);
        const spTex = decalTex(title, team.ink || ink(color));
        for (const s of [-1, 1]) {
          const ry = s > 0 ? 0 : Math.PI;
          decal(spTex, 1.15, 0.24, -0.35, 0.36, s * 0.715, ry);
          if (sec[0]) decal(decalTex(sec[0], team.ink || ink(color)), 0.9, 0.16, -1.25, 0.72, s * 0.215, ry);
        }
        decal(numTex(opts.number ?? 1), 0.34, 0.34, 1.7, 0.47, 0, Math.PI / 2, -Math.PI / 2 + 0.2);
        const rw = new THREE.Group(); tilt.add(rw); parts.rwing = rw;
        for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.03), paint), -2.25, 0.82, s * 0.56, rw);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 1.1), dark), -2.22, 0.96, 0, rw);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), dark), -2.15, 0.7, 0, rw);              // swan-neck pylon
        add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.95), dark), -2.3, 0.45, 0, rw);              // beam wing
        decal(decalTex(title, "#ffffff"), 1.0, 0.16, -2.22, 0.985, 0, -Math.PI / 2, -Math.PI / 2, rw);
        flap = add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, 1.1), paint), -2.38, 1.08, 0, rw);
        brake = add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.12), new THREE.MeshBasicMaterial({ color: 0x7a0000, toneMapped: false })), -2.56, 0.5, 0, tilt, false); brake.castShadow = false; // rain light
      } else flap = add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, 1.1), paint), -2.38, 1.08, 0, tilt, false);
    }
    if (!f1) for (const ch of tilt.children) ch.position.y -= 0.07; // sit the body down on its wheels: ~13 cm ground clearance
    const wheels = [];
    const wheelMat = ghost ? paint : cached(`wm${f1}${team.accent}`, () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.35, envMapIntensity: 0.6 }));
    for (const [x, z, front, r, wdt] of wheelSpec) {
      wheelR = r;
      const side = Math.sign(z), piv = new THREE.Group(); piv.position.set(x, r, z); tilt.add(piv);
      const w = new THREE.Mesh(ghost ? cached(`w${r}${wdt}`, () => { const k = new THREE.CylinderGeometry(r, r, wdt, 24); k.rotateX(Math.PI / 2); return k; }) : cached(`wheel${f1}${r}${wdt}${side}${team.accent}`, () => wheelGeo(f1, r, wdt, side, team.accent)), ghost ? paint : wheelMat);
      w.castShadow = !ghost; piv.add(w);
      if (!ghost) { const br = new THREE.Mesh(cached(`brk${f1}${r}${wdt}${side}`, () => brakeGeo(f1, r, wdt, side)), wheelMat); br.castShadow = false; piv.add(br); }
      wheels.push({ piv, w, front, z });
    }
    if (!ghost) { // contact shadow so the car always looks planted, whatever the sun is doing
      const blob = new THREE.Mesh(cached("blob", () => new THREE.PlaneGeometry(5.6, 2.9)), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
      blob.rotation.x = -Math.PI / 2; blob.position.y = 0.035; g.add(blob);
      glow = new THREE.Mesh(cached("glow", () => new THREE.PlaneGeometry(6.6, 3.8)), new THREE.MeshBasicMaterial({ map: softDot, color: 0x49b6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.06; g.add(glow);
    }
    // pack this car's decals into one texture atlas and one mesh
    if (atlasQ.length > 1) {
      const CW = 512, CH = 128, cols = 2, rows = Math.ceil(atlasQ.length / cols), cv = document.createElement("canvas"); cv.width = CW * cols; cv.height = CH * rows;
      const g2 = cv.getContext("2d"), geos = [];
      atlasQ.forEach((d, k) => {
        const src = d.material.map.image, cx = (k % cols) * CW, cy = Math.floor(k / cols) * CH, sc = Math.min(CW / src.width, CH / src.height), dw = src.width * sc, dh = src.height * sc;
        g2.drawImage(src, cx + (CW - dw) / 2, cy + (CH - dh) / 2, dw, dh);
        const geo = d.geometry.clone(), uv = geo.attributes.uv, u0 = (cx + (CW - dw) / 2) / cv.width, u1 = (cx + (CW + dw) / 2) / cv.width, v0 = 1 - (cy + (CH + dh) / 2) / cv.height, v1 = 1 - (cy + (CH - dh) / 2) / cv.height;
        for (let q = 0; q < uv.count; q++) uv.setXY(q, u0 + uv.getX(q) * (u1 - u0), v0 + uv.getY(q) * (v1 - v0));
        d.updateMatrix(); geo.applyMatrix4(d.matrix); geos.push(geo); tilt.remove(d); d.material.dispose(); d.geometry.dispose();
      });
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const am = new THREE.Mesh(mergeGeometries(geos, false), decalMat(tex)); am.castShadow = false; tilt.add(am); geos.forEach((q) => q.dispose());
    }
    for (const m of statics) m.castShadow = m.geometry.parameters ? (m.geometry.parameters.width || 0) * (m.geometry.parameters.depth || 0) > 0.6 : false;
    // each wing is one piece per material too (it still breaks off as a whole)
    const mergeIn = (grp, skip) => { if (!grp) return; const by = new Map(); for (const m of [...grp.children]) { if (!m.isMesh || m === skip || m.material.map) continue; m.updateMatrix(); const gg = m.geometry.clone().applyMatrix4(m.matrix); for (const k of Object.keys(gg.attributes)) if (k !== "position" && k !== "normal") gg.deleteAttribute(k); (by.get(m.material) || by.set(m.material, []).get(m.material)).push(gg); grp.remove(m); } for (const [mat, l] of by) { const mm = new THREE.Mesh(mergeGeometries(l, false), mat); mm.castShadow = true; grp.add(mm); l.forEach((q) => q.dispose()); } };
    if (!ghost && f1) { mergeIn(parts.fwing); mergeIn(parts.rwing, flap); }
    // merge static pieces by material: a detailed car in a handful of draw calls
    const byMat = new Map();
    for (const m of statics) { if (m.material.map) continue; m.updateMatrix(); const gg = m.geometry.clone().applyMatrix4(m.matrix); if (gg.index === null) continue; for (const k of Object.keys(gg.attributes)) if (k !== "position" && k !== "normal") gg.deleteAttribute(k); const l = byMat.get(m.material) || []; l.push(gg); byMat.set(m.material, l); tilt.remove(m); m.geometry.dispose?.(); }
    for (const [mat, list] of byMat) { const merged = mergeGeometries(list, false); if (!merged) continue; const mm = new THREE.Mesh(merged, mat); mm.castShadow = mat === paint || mat === carbon || mat === accentMat; mm.receiveShadow = true; tilt.add(mm); list.forEach((x) => x.dispose()); }
    return { g, tilt, wheels, wheelR, flap, brake, glow, parts, deform, gone: new Set(), ghost, f1, spin: 0, roll: 0, pitch: 0, lastSkid: null, emo: null, emoT: 0, hitsSeen: 0, paint };
  }
  W.buildCar = buildCar;

  // ---------- drivers: racing suit, gloves, boots, helmet with visor ----------
  function buildDriver(team, pose = "stand") {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const suit = new THREE.MeshPhysicalMaterial({ color: team.body, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(team.accent), envMapIntensity: 0.6 });
    const acc = std({ color: team.accent, roughness: 0.5 }), blk = std({ color: 0x15161a, roughness: 0.7 }), helm = new THREE.MeshPhysicalMaterial({ color: team.accent, roughness: 0.15, metalness: 0.3, clearcoat: 1, envMapIntensity: 1.2 });
    const mesh = (geo, mat, x, y, z, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
    const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 12);
    for (const s of [-1, 1]) { mesh(cap(0.078, 0.7), suit, s * 0.1, 0.48, 0); mesh(new THREE.BoxGeometry(0.11, 0.08, 0.24), blk, s * 0.1, 0.04, 0.04); mesh(new THREE.BoxGeometry(0.012, 0.7, 0.03), acc, s * 0.178, 0.5, 0); }
    const torso = mesh(cap(0.17, 0.4), suit, 0, 1.12, 0); torso.scale.set(1, 1, 0.68);
    mesh(new THREE.BoxGeometry(0.36, 0.06, 0.24), acc, 0, 0.92, 0);                       // belt
    mesh(new THREE.BoxGeometry(0.05, 0.5, 0.235), acc, 0, 1.14, 0);                        // centre stripe
    const chest = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.06), decalMat(decalTex(team.short || team.name, team.ink, 512, 96))); chest.position.set(0, 1.25, 0.122); body.add(chest);
    mesh(cap(0.06, 0.06), suit, 0, 1.45, 0);                                               // neck
    const head = new THREE.Group(); head.position.set(0, 1.6, 0); body.add(head);
    mesh(new THREE.SphereGeometry(0.15, 22, 16), helm, 0, 0, 0, head);
    const vis = mesh(new THREE.SphereGeometry(0.152, 20, 10, -1.1, 2.2, 1.15, 0.55), glassMat, 0, 0, 0, head); vis.rotation.y = Math.PI / 2 * 0 + 0;
    mesh(new THREE.BoxGeometry(0.31, 0.025, 0.02), acc, 0, 0.06, 0.13, head);
    const arm = (s) => { // shoulder -> upper arm -> elbow -> forearm -> glove
      const sh = new THREE.Group(); sh.position.set(s * 0.22, 1.36, 0); body.add(sh);
      mesh(cap(0.058, 0.24), suit, 0, -0.16, 0, sh);
      const el = new THREE.Group(); el.position.set(0, -0.32, 0); sh.add(el);
      mesh(cap(0.052, 0.22), suit, 0, -0.14, 0, el); mesh(new THREE.SphereGeometry(0.06, 10, 8), blk, 0, -0.3, 0, el);
      return { sh, el };
    };
    const L = arm(-1), Rr = arm(1);
    const set = (a, sx, sz, ex) => { a.sh.rotation.set(sx, 0, sz); a.el.rotation.set(ex, 0, 0); };
    if (pose === "cross") { set(L, -0.35, -0.25, -1.9); set(Rr, -0.35, 0.25, -1.9); L.el.rotation.z = 0.9; Rr.el.rotation.z = -0.9; }
    else if (pose === "hips") { set(L, 0.1, -0.55, -1.2); set(Rr, 0.1, 0.55, -1.2); }
    else if (pose === "wave") { set(L, 0, -0.12, -0.1); set(Rr, 0, 2.6, -0.4); }
    else if (pose === "trophy") { set(L, 0, -2.7, -0.2); set(Rr, 0, 2.7, -0.2); }
    else { set(L, 0.05, -0.12, -0.15); set(Rr, 0.05, 0.12, -0.15); }
    g.userData.body = body;
    return g;
  }

  // ---------- lineup studio: drivers posed in front of their cars (before the race, and the podium after) ----------
  const lineScene = new THREE.Scene(), lineCam = new THREE.PerspectiveCamera(32, 16 / 9, 0.5, 400);
  { const bg = canvasTex(1024, 512, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#0d1220"); gr.addColorStop(0.55, "#1a2236"); gr.addColorStop(1, "#06080d"); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0.02, 0.07)})`; g.fillRect(rnd(0, w), rnd(0, h * 0.6), rnd(40, 160), 2); } });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(60, 60, 40, 48, 1, true), new THREE.MeshBasicMaterial({ map: bg, side: THREE.BackSide, fog: false })); wall.position.y = 14; lineScene.add(wall);
    const floorT = canvasTex(512, 512, (g, w, h) => { g.fillStyle = "#1c1e23"; g.fillRect(0, 0, w, h); for (let i = 0; i < 9000; i++) { const v = rnd(26, 52); g.fillStyle = `rgb(${v},${v},${v + 3})`; g.fillRect(rnd(0, w), rnd(0, h), 1.5, 1.5); } g.fillStyle = "rgba(255,255,255,.55)"; for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 3, h); }, { repeat: [6, 6] });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 48), std({ map: floorT, roughness: 0.35, metalness: 0.2, envMapIntensity: 0.6 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; lineScene.add(floor);
    lineScene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1410, 0.8));
    const key = new THREE.DirectionalLight(0xfff2e0, 3.2); key.position.set(4, 12, 9); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -12, right: 12, top: 8, bottom: -8, near: 1, far: 40 }); key.shadow.bias = -0.0004; lineScene.add(key);
    const rimA = new THREE.PointLight(0x4aa3ff, 60, 30, 1.6); rimA.position.set(-9, 4, -6); const rimB = new THREE.PointLight(0xff4a4a, 60, 30, 1.6); rimB.position.set(9, 4, -6); lineScene.add(rimA, rimB);
  }
  let lineGroup = null, lineT = 0, lineSlots = [];
  W.showLineup = function (entries, clsId) {
    W.hideLineup();
    lineScene.environment = scene.environment;
    const G = lineGroup = new THREE.Group(); lineScene.add(G);
    const n = entries.length, gap = n <= 2 ? 3.4 : n === 3 ? 2.9 : 2.55;
    lineSlots = entries.map((e, i) => {
      const x = (i - (n - 1) / 2) * gap;
      const car = buildCar(e.team.body, clsId, { team: e.team, number: e.number }); car.g.position.set(x, 0, -2.9); car.g.rotation.y = -Math.PI / 2 + (i - (n - 1) / 2) * 0.07; G.add(car.g); // nose-out behind the driver, like a team photo
      for (const w of car.wheels) if (w.front) w.piv.rotation.y = 0.25;
      const d = buildDriver(e.team, e.pose || ["hips", "cross", "stand", "hips"][i % 4]); d.position.set(x, 0, 0.9); d.rotation.y = -x * 0.06; G.add(d);
      if (e.podium) { const step = new THREE.Mesh(new THREE.BoxGeometry(1.4, e.podium, 1.2), std({ color: 0x2a2e36, roughness: 0.4, metalness: 0.5 })); step.position.set(x, e.podium / 2, 0.9); step.castShadow = step.receiveShadow = true; G.add(step); d.position.y = e.podium; }
      return { x, y: (e.podium || 0) + 1.95, z: 0.9, driver: d };
    });
    lineT = 0; W.lineup = true;
  };
  W.hideLineup = function () {
    if (lineGroup) { lineScene.remove(lineGroup); lineGroup.traverse((o) => { if (o.isMesh && o.geometry && !Object.values(geoCache).includes(o.geometry)) o.geometry.dispose(); }); lineGroup = null; }
    W.lineup = false;
  };
  // screen positions (0..1) of each driver's head, for the name tags
  const lv = new V3();
  W.lineupTags = function () { return lineSlots.map((s) => { lv.set(s.x, s.y, s.z).project(lineCam); return [(lv.x + 1) / 2, (1 - lv.y) / 2]; }); };
  function renderLineup(dt) {
    lineT += dt;
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight, asp = w / h;
    lineCam.aspect = asp; const dist = 10.5 * Math.max(1, 1.78 / asp);
    lineCam.position.set(Math.sin(lineT * 0.08) * 1.2, 1.9, dist - Math.min(1.2, lineT * 0.12)); lineCam.lookAt(0, 1.15, -0.6); lineCam.updateProjectionMatrix();
    for (const s of lineSlots) { const b = s.driver.userData.body; b.scale.y = 1 + Math.sin(lineT * 2.1 + s.x) * 0.006; }
    renderer.render(lineScene, lineCam);
  }
  W.addCar = function (id, color, clsId, opts = {}) {
    W.removeCar(id);
    const view = buildCar(color, clsId, opts); view.id = id;
    scene.add(view.g); W.cars.set(id, view);
    return view;
  };
  W.removeCar = function (id) { const v = W.cars.get(id); if (!v) return; scene.remove(v.g); v.g.traverse((o) => { if (o.isMesh && o.geometry && !Object.values(geoCache).includes(o.geometry)) o.geometry.dispose(); }); W.cars.delete(id); };
  W.clearCars = function () { for (const id of [...W.cars.keys()]) W.removeCar(id); };
  W.emote = function (id, text) {
    const v = W.cars.get(id); if (!v || v.ghost) return;
    if (!v.emo) { v.emo = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false })); v.emo.scale.set(1.6, 1.6, 1); v.emo.position.y = 2.6; v.g.add(v.emo); }
    v.emo.material.map?.dispose(); v.emo.material.map = emoteTex(text); v.emo.material.needsUpdate = true; v.emo.visible = true; v.emoT = 2.2;
  };

  // dents: push nearby vertices inward around a local hit point
  const hv = new V3(), hp = new V3(), hn = new V3();
  function dent(v, hit) {
    hp.set(clamp(hit.lx, -2.45, 2.45), 0.58, clamp(hit.lz, -0.98, 0.98));
    hn.set(-hit.lx / 2.3, -0.15, -hit.lz / 1.0).normalize();
    const R = 0.85 + hit.a * 0.7, depth = 0.08 + hit.a * 0.34;
    for (const mesh of v.deform) {
      const p = mesh.geometry.attributes.position, oz = mesh.position.z;
      for (let k = 0; k < p.count; k++) {
        hv.set(p.getX(k), p.getY(k), p.getZ(k) + oz);
        const d = hv.distanceTo(hp); if (d >= R) continue;
        const f = (1 - d / R) ** 2 * depth;
        p.setXYZ(k, hv.x + hn.x * f + rnd(-1, 1) * 0.025 * hit.a, hv.y + hn.y * f + rnd(-1, 1) * 0.02 * hit.a, hv.z - oz + hn.z * f);
      }
      p.needsUpdate = true; mesh.geometry.computeVertexNormals();
    }
    if (hit.a > 0.25) v.paint.roughness = Math.min(0.55, v.paint.roughness + hit.a * 0.05); // scuffed paint
  }

  // ---------- debris ----------
  const debris = [];
  function detach(v, key, c) {
    const m = v.parts[key]; if (!m || v.gone.has(key)) return;
    v.gone.add(key); m.updateWorldMatrix(true, false);
    const pos = new V3(), quat = new THREE.Quaternion(), s = new V3(); m.matrixWorld.decompose(pos, quat, s);
    m.parent.remove(m); m.position.copy(pos); m.quaternion.copy(quat); scene.add(m);
    debris.push({ m, vx: c.vx * 0.55 + rnd(-4, 4), vy: rnd(3, 7), vz: c.vz * 0.55 + rnd(-4, 4), wx: rnd(-9, 9), wy: rnd(-9, 9), wz: rnd(-9, 9), life: 40, rest: false });
    W.sparks(pos.x, pos.z, 14); W.puff(pos.x, 0.6, pos.z, 0x9a9a9a, 1.4);
    W.onDetach?.(v.id, key);
  }
  function stepDebris(dt) {
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i]; d.life -= dt;
      if (d.life <= 0) { scene.remove(d.m); debris.splice(i, 1); continue; }
      if (d.rest) continue;
      d.vy -= 18 * dt; d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.position.z += d.vz * dt;
      d.m.rotation.x += d.wx * dt; d.m.rotation.y += d.wy * dt; d.m.rotation.z += d.wz * dt;
      if (d.m.position.y < 0.08) { d.m.position.y = 0.08; d.vy *= -0.3; d.vx *= 0.6; d.vz *= 0.6; d.wx *= 0.5; d.wy *= 0.5; d.wz *= 0.5; if (Math.abs(d.vy) < 0.6 && Math.hypot(d.vx, d.vz) < 0.6) { d.rest = true; d.m.rotation.x = d.m.rotation.z = 0; } }
    }
  }
  function clearDebris() { for (const d of debris) scene.remove(d.m); debris.length = 0; }

  W.syncCar = function (id, c, dt) {
    const v = W.cars.get(id); if (!v) return;
    v.g.position.set(c.x, 0.02 + (c.y || 0), c.z); v.g.rotation.y = -c.h;
    v.g.visible = !c.hidden;
    const sp = c.speed ?? Math.hypot(c.vx, c.vz), fx = Math.cos(c.h), fz = Math.sin(c.h), vf = c.vx * fx + c.vz * fz;
    v.spin -= (vf / v.wheelR) * dt;
    for (const w of v.wheels) { w.w.rotation.z = v.spin; if (w.front) w.piv.rotation.y = -(c.steer || 0) * 0.45; }
    const latG = (c.w || 0) * sp;
    v.roll += (clamp(latG * (v.f1 ? 0.0012 : 0.0026), -0.075, 0.075) - v.roll) * Math.min(1, 9 * dt);
    v.pitch += (((c.brk || 0) * (v.f1 ? 0.018 : 0.04) - (c.thr || 0) * 0.016 * (sp < 45 ? 1 : 0.3)) - v.pitch) * Math.min(1, 8 * dt);
    v.tilt.rotation.x = v.roll; v.tilt.rotation.z = v.pitch;
    if (v.flap) { if (v.f1) { v.flap.rotation.z = c.drs ? 0.05 : -0.45; v.flap.position.y = c.drs ? 1.12 : 1.08; } else { v.flap.position.y = c.drs ? 0.99 : 1.06; v.flap.rotation.z = c.drs ? 0 : -0.35; } }
    if (v.ghost) return;
    v.brake?.material.color.setHex(c.brk > 0.1 ? 0xff1818 : 0x7a0000);
    const boost = c.boosting; v.glow.material.opacity += ((boost ? 0.85 : 0) - v.glow.material.opacity) * Math.min(1, 10 * dt);
    if (v.emoT > 0) { v.emoT -= dt; if (v.emoT <= 0 && v.emo) v.emo.visible = false; }
    // damage: new dents, parts that break off, smoke
    if (c.dents?.length) for (const h of c.dents.splice(0)) dent(v, h); // the game moves physics hits here (and from the network)
    const D = c.dmg;
    if (D) {
      if (!v.f1) {
        if (D.f > 0.4) detach(v, "splitter", c); if (D.r > 0.45) detach(v, "diffuser", c); if (D.r > 0.75) detach(v, "spoiler", c);
        if (D.l > 0.4) detach(v, "mirrorL", c); if (D.rt > 0.4) detach(v, "mirrorR", c);
      } else {
        if (D.f > 0.28 && (D.l > 0.1 || D.f > 0.5)) detach(v, "epL", c); if (D.f > 0.28 && (D.rt > 0.1 || D.f > 0.5)) detach(v, "epR", c);
        if (D.f > 0.62) detach(v, "fwing", c); if (D.r > 0.6) detach(v, "rwing", c);
      }
      if ((D.e > 0.5 || c.retired) && Math.random() < (c.retired ? 0.7 : 0.25)) W.puff(c.x - fx * 2.3, 0.9, c.z - fz * 2.3, c.retired ? 0x2a2a2a : 0x6a6a6a, c.retired ? 2.2 : 1.2);
    }
    // skid marks and tyre smoke
    const sliding = Math.max(c.slip > 0.3 ? c.slip : 0, c.brk > 0.95 && sp > 30 ? 0.35 : 0);
    if (sliding > 0 && sp > 6) {
      const rx = -fz, rz = fx, bx = c.x - fx * 1.5, bz = c.z - fz * 1.5, now = [bx + rx * 0.85, bz + rz * 0.85, bx - rx * 0.85, bz - rz * 0.85];
      if (v.lastSkid && c.surf !== 2) { skidQuad(v.lastSkid[0], v.lastSkid[1], now[0], now[1], sliding); skidQuad(v.lastSkid[2], v.lastSkid[3], now[2], now[3], sliding); }
      v.lastSkid = now;
      if (Math.random() < 0.5) W.puff(bx, 0.4, bz, c.surf === 2 ? 0xc9b58d : 0xe6e6e6, 0.5 + sliding);
    } else v.lastSkid = null;
    if (c.surf === 2 && sp > 12 && Math.random() < 0.5) W.puff(c.x - fx * 1.6, 0.4, c.z - fz * 1.6, W.T?.def.street ? 0x888888 : 0xbfae88, 0.9);
  };

  // ---------- skid marks (ring buffer; only the changed quad is uploaded) ----------
  const SK = 1800, skPos = new Float32Array(SK * 12), skCol = new Float32Array(SK * 16), skGeo = new THREE.BufferGeometry();
  { const idx = new Uint16Array(SK * 6); for (let i = 0; i < SK; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    skGeo.setAttribute("position", new THREE.BufferAttribute(skPos, 3)); skGeo.setAttribute("color", new THREE.BufferAttribute(skCol, 4)); skGeo.setIndex(new THREE.BufferAttribute(idx, 1)); }
  const skids = new THREE.Mesh(skGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7, side: THREE.DoubleSide }));
  skids.frustumCulled = false; scene.add(skids);
  let skN = 0;
  function skidQuad(x0, z0, x1, z1, a) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.01 || l > 6) return;
    const px = (-dz / l) * 0.17, pz = (dx / l) * 0.17, s = skN % SK, al = Math.min(0.55, 0.2 + a * 0.25);
    skPos.set([x0 - px, 0.06, z0 - pz, x0 + px, 0.06, z0 + pz, x1 - px, 0.06, z1 - pz, x1 + px, 0.06, z1 + pz], s * 12);
    for (let k = 0; k < 4; k++) skCol.set([0.02, 0.02, 0.02, al], s * 16 + k * 4);
    skN++;
    skGeo.attributes.position.addUpdateRange(s * 12, 12); skGeo.attributes.color.addUpdateRange(s * 16, 16);
    skGeo.attributes.position.needsUpdate = true; skGeo.attributes.color.needsUpdate = true;
  }
  function skidReset() { skPos.fill(0); skCol.fill(0); skN = 0; skGeo.attributes.position.clearUpdateRanges(); skGeo.attributes.color.clearUpdateRanges(); skGeo.attributes.position.needsUpdate = true; skGeo.attributes.color.needsUpdate = true; for (const v of W.cars.values()) v.lastSkid = null; }

  // ---------- particles ----------
  const PN = 900, pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 4), pSize = new Float32Array(PN), pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN), pMax = new Float32Array(PN), pGrow = new Float32Array(PN), pGrav = new Float32Array(PN), pA = new Float32Array(PN);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute("aCol", new THREE.BufferAttribute(pCol, 4)); pGeo.setAttribute("aSize", new THREE.BufferAttribute(pSize, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: softDot }, scale: { value: 600 } }, transparent: true, depthWrite: false,
    vertexShader: "attribute vec4 aCol; attribute float aSize; varying vec4 vCol; uniform float scale; void main(){ vCol=aCol; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*scale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }",
    fragmentShader: "uniform sampler2D map; varying vec4 vCol; void main(){ vec4 t=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vCol.rgb,vCol.a*t.a); if(gl_FragColor.a<0.01) discard; }",
  });
  const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);
  let pN = 0; const pc = new THREE.Color();
  function emit(x, y, z, vx, vy, vz, hex, size, life, alpha, grow, grav) {
    const i = pN++ % PN; pPos.set([x, y, z], i * 3); pVel.set([vx, vy, vz], i * 3); pc.setHex(hex);
    pCol.set([pc.r, pc.g, pc.b, alpha], i * 4); pA[i] = alpha; pSize[i] = size; pLife[i] = pMax[i] = life; pGrow[i] = grow; pGrav[i] = grav;
  }
  W.puff = (x, y, z, hex, s = 1) => emit(x, y, z, rnd(-1, 1), rnd(0.6, 2), rnd(-1, 1), hex, 1.4 * s, rnd(0.6, 1.2), 0.38, 4, 0);
  W.sparks = (x, z, n = 10) => { for (let i = 0; i < n; i++) emit(x, 0.5, z, rnd(-10, 10), rnd(2, 10), rnd(-10, 10), [0xffd060, 0xffffff, 0xff9030][i % 3], 0.35, rnd(0.2, 0.55), 1, 0, 24); };
  W.confetti = (x, z, n = 90) => { for (let i = 0; i < n; i++) emit(x + rnd(-6, 6), rnd(6, 14), z + rnd(-6, 6), rnd(-7, 7), rnd(4, 16), rnd(-7, 7), [0xe10600, 0xffd84a, 0x2a63d4, 0x35b56a, 0xffffff, 0xff8000][i % 6], 0.8, rnd(1.4, 2.8), 1, 0, 14); };
  function stepParticles(dt) {
    for (let i = 0; i < PN; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt; const o = i * 3;
      pVel[o + 1] -= pGrav[i] * dt;
      pPos[o] += pVel[o] * dt; pPos[o + 1] += pVel[o + 1] * dt; pPos[o + 2] += pVel[o + 2] * dt;
      if (pPos[o + 1] < 0.1 && pGrav[i]) { pPos[o + 1] = 0.1; pVel[o + 1] *= -0.35; pVel[o] *= 0.6; pVel[o + 2] *= 0.6; }
      pSize[i] += pGrow[i] * dt;
      if (pLife[i] <= 0) pCol[i * 4 + 3] = 0; else if (!pGrav[i]) pCol[i * 4 + 3] = pA[i] * (pLife[i] / pMax[i]);
    }
    pGeo.attributes.position.needsUpdate = pGeo.attributes.aCol.needsUpdate = pGeo.attributes.aSize.needsUpdate = true;
  }

  // ---------- camera ----------
  // Locked rigidly to the car's exact (interpolated) position; only heading, distance and FOV are eased,
  // so uneven frame times never show up as the car juddering on screen.
  const cam = { h: 0, d: 7, fov: 62, shake: 0, orbit: 0, init: false, look: 0, rumble: 0 };
  const angd = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  W.shake = (a) => { cam.shake = Math.max(cam.shake, a); };
  W.snapCamera = () => { cam.init = false; };
  W.updateCamera = function (c, mode, dt) {
    let wantFov = 60, speedFx = 0, boostFx = 0;
    if (!c) {
      cam.orbit += dt * 0.05;
      camera.position.set(Math.sin(cam.orbit) * 430, 110 + Math.sin(cam.orbit * 0.7) * 30, Math.cos(cam.orbit) * 360 + 60); tmp2.set(0, 0, 0); wantFov = 48;
      aimSun(0, 0, 640); head.intensity = 0; cam.init = false; cam.fov = wantFov;
    } else {
      const sp = c.speed || 0, y = c.y || 0, f1 = c.cls?.id === "f1";
      const vh = sp > 8 ? Math.atan2(c.vz, c.vx) : c.h;
      const target = c.h + clamp(angd(vh, c.h), -0.6, 0.6) * 0.6;
      if (!cam.init) { cam.h = target; cam.d = 7; cam.look = 0; }
      cam.h += angd(target, cam.h) * (1 - Math.exp(-dt * (mode === 2 ? 30 : 6)));
      cam.look += ((c.steer || 0) * 0.16 - cam.look) * (1 - Math.exp(-dt * 4));
      const wantD = (f1 ? 6.4 : 6.8) + sp * 0.028 + (c.boosting ? 1.0 : 0); cam.d += (wantD - cam.d) * (1 - Math.exp(-dt * 3));
      const fx = Math.cos(cam.h), fz = Math.sin(cam.h), lx = Math.cos(cam.h + cam.look), lz = Math.sin(cam.h + cam.look), hx = Math.cos(c.h), hz = Math.sin(c.h);
      const sf = Math.min(1, sp / 90);
      if (mode === 0) { camera.position.set(c.x - fx * cam.d, (f1 ? 2.3 : 2.9) + sp * 0.005 + y, c.z - fz * cam.d); tmp2.set(c.x + lx * 9, -0.2 + y, c.z + lz * 9); wantFov = 60 + 22 * sf; }
      else if (mode === 1) { camera.position.set(c.x - fx * (cam.d + 6), 5.2 + y, c.z - fz * (cam.d + 6)); tmp2.set(c.x + lx * 12, 0.4 + y, c.z + lz * 12); wantFov = 56 + 18 * sf; }
      else if (mode === 2) { // T-cam above the airbox (Formula) / roof cam (GT)
        camera.position.set(c.x - hx * (f1 ? 0.7 : 0.1), (f1 ? 1.32 : 1.62) + y, c.z - hz * (f1 ? 0.7 : 0.1)); tmp2.set(c.x + hx * 16, 0.9 + y, c.z + hz * 16); wantFov = 70 + 16 * sf;
      } else { camera.position.set(c.x - 16, 60, c.z + 52); tmp2.set(c.x, 0, c.z); wantFov = 44; }
      wantFov += c.boosting ? 6 : 0;
      speedFx = mode === 3 ? 0 : clamp((sp - 40) / 50, 0, 1) * (mode === 2 ? 1 : 0.8); boostFx = c.boosting ? 1 : 0;
      // kerb rumble and high-speed buffeting
      const rum = (c.surf === 1 && sp > 15 ? 0.05 : 0) + (c.surf === 2 && sp > 10 ? 0.09 : 0) + (sp > 75 ? 0.012 : 0);
      if (rum > 0 && mode !== 3) { camera.position.y += rnd(-1, 1) * rum; camera.position.x += rnd(-1, 1) * rum * 0.5; }
      aimSun(c.x, c.z, mode === 3 ? 130 : 95);
      if (W.night && !f1) { head.intensity = 160; head.position.set(c.x + hx * 2, 0.9, c.z + hz * 2); head.target.position.set(c.x + hx * 30, 0, c.z + hz * 30); } else head.intensity = 0;
      cam.fov += (wantFov - cam.fov) * (cam.init ? 1 - Math.exp(-dt * 4) : 1);
      cam.init = true;
    }
    W.speedFx += (speedFx - W.speedFx) * Math.min(1, dt * 4); W.boostFx += (boostFx - W.boostFx) * Math.min(1, dt * 6);
    camera.fov = cam.fov;
    if (cam.shake > 0.001) { camera.position.x += rnd(-1, 1) * cam.shake; camera.position.y += rnd(-1, 1) * cam.shake * 0.6; camera.position.z += rnd(-1, 1) * cam.shake; cam.shake *= Math.pow(0.002, dt); }
    camera.updateProjectionMatrix(); camera.lookAt(tmp2);
    sky.position.set(camera.position.x, 0, camera.position.z);
  };

  // ---------- quality, warm-up, frame ----------
  // 2 high: post-processing (bloom, speed blur, grade). 1 standard (default): direct render, 2048 shadows. 0 low: 1024 shadows, lower resolution.
  function applyQuality() {
    const q = W.quality, size = q >= 1 ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    bloom.enabled = q === 2; for (const t of W.treeMeshes || []) t.castShadow = q > 1;
    W.resize();
  }
  W.setQuality = function (q) { if (q === "auto") { W.auto = true; q = 1; } else W.auto = false; W.quality = q; applyQuality(); warm(); };
  // compile every shader up front, in parallel and off the frame, so nothing stalls the first time it appears
  function warm() { try { (renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve(renderer.compile(scene, camera))).catch(() => {}); } catch {} frames = 0; win = 0; winN = 0; }
  let frames = 0, win = 0, winN = 0;
  W.resize = function () {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight, dpr = devicePixelRatio || 1;
    const pr = W.quality === 2 ? Math.min(dpr, 1.6) : W.quality === 1 ? Math.min(dpr, 1.5) : Math.min(dpr, 1);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false); composer.setPixelRatio(pr); composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    pMat.uniforms.scale.value = h * pr * 0.9;
  };
  W.render = function (dt) {
    stepParticles(dt); stepDebris(dt);
    final.uniforms.uSpeed.value = W.speedFx; final.uniforms.uBoost.value = W.boostFx;
    if (W.lineup) { renderLineup(dt); return; }
    if (W.quality === 2) composer.render(dt); else renderer.render(scene, camera);
    // Auto quality only ever steps down, once, after a sustained slow stretch: no back-and-forth resizes.
    frames++;
    if (W.auto && frames > 180 && dt < 0.25) { win += dt; winN++; if (winN >= 150) { const avg = win / winN; win = 0; winN = 0; if (avg > 0.022 && W.quality > 0) { W.quality--; applyQuality(); W.onQuality?.(W.quality); } } }
  };
  addEventListener("resize", W.resize);
  applyQuality();
  return W;
}
