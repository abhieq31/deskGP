// DeskGP's own artwork, all drawn here (no image files, nobody else's logos).
//  - the mark: a "D" that is also a corner, with the racing line cutting through its apex and a chequered flag
//  - team crests: an original emblem per team (shape, colours, a speed stripe and a three-letter code)
//  - circuit art: the outline drawn in three sector colours, like a broadcast graphic

// The DeskGP mark. bg: draw it on a dark tile (favicon); size in px.
export function logoMark(size = 40, bg = false) {
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
${bg ? '<rect width="64" height="64" rx="15" fill="#0b0d12"/>' : ""}
<path fill="#f5f6f8" fill-rule="evenodd" d="M10 7h23c15 0 25 11 25 25S48 57 33 57H10zM21 18v28h11c9 0 15-6 15-14s-6-14-15-14z"/>
<g fill="#0b0d12"><rect x="10" y="27" width="3.7" height="3.7"/><rect x="17.3" y="27" width="3.7" height="3.7"/><rect x="13.7" y="30.7" width="3.6" height="3.6"/><rect x="10" y="34.3" width="3.7" height="3.7"/><rect x="17.3" y="34.3" width="3.7" height="3.7"/></g>
<path d="M22 11h10c11 0 18.6 9 18.6 21S43 53 32 53H22" fill="none" stroke="#ff2d2d" stroke-width="3.6" stroke-linecap="round"/>
</svg>`;
}
export const faviconHref = () => "data:image/svg+xml," + encodeURIComponent(logoMark(64, true).replace('class="mark" ', 'xmlns="http://www.w3.org/2000/svg" '));

// Original team crest: the shape is chosen per team so no two look alike.
const SHAPES = [
  "M32 3 58 12v20c0 15-11 25-26 29C17 57 6 47 6 32V12z",                    // shield
  "M32 3a29 29 0 1 0 .01 0z",                                                // roundel
  "M32 3 57 17.5v29L32 61 7 46.5v-29z",                                      // hexagon
  "M32 2 62 32 32 62 2 32z",                                                 // diamond
  "M8 6h48v30c0 12-10 21-24 25C18 57 8 48 8 36z",                            // square shield
  "M10 4h44l6 14-6 42H10L4 18z",                                             // badge
  "M32 3c16 0 28 9 28 24 0 18-13 30-28 34C17 57 4 45 4 27 4 12 16 3 32 3z", // pebble
  "M6 10 32 3l26 7v30L32 61 6 40z",                                          // kite
];
export function crest(team, size = 28, idx = 0) {
  const shape = SHAPES[idx % SHAPES.length], code = team.crest || team.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase(), id = "c" + team.id;
  return `<svg class="crest" width="${size}" height="${size}" viewBox="0 0 64 64" aria-label="${team.name}">
<defs><clipPath id="${id}"><path d="${shape}"/></clipPath><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<g clip-path="url(#${id})"><rect width="64" height="64" fill="${team.body}"/><path d="M-6 50 70 18v10L-6 60z" fill="${team.accent}"/><rect width="64" height="64" fill="url(#${id}g)"/></g>
<path d="${shape}" fill="none" stroke="${team.accent}" stroke-width="3"/>
<text x="32" y="${code.length > 2 ? 37 : 38}" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-weight="900" font-style="italic" font-size="${code.length > 2 ? 17 : 21}" letter-spacing=".5" fill="${team.ink}" stroke="${team.body}" stroke-width="3" paint-order="stroke">${code}</text>
</svg>`;
}

// Circuit art on a canvas: thick outline in sector colours (red, blue, yellow) with a start/finish mark.
export function drawCircuitArt(cv, o, opts = {}) {
  const g = cv.getContext("2d"), w = cv.width, h = cv.height, B = o.box, pad = opts.pad ?? 18, sc = Math.min((w - pad * 2) / (B.hx * 2), (h - pad * 2) / (B.hz * 2));
  const X = (x) => w / 2 + x * sc, Z = (z) => h / 2 + z * sc, n = o.n;
  g.clearRect(0, 0, w, h); g.lineJoin = g.lineCap = "round";
  const lw = opts.lw ?? Math.max(3, w / 70);
  g.beginPath(); for (let i = 0; i <= n; i += 2) g.lineTo(X(o.x[i % n]), Z(o.z[i % n])); g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = lw * 2.6; g.stroke();
  const cols = ["#ff2d2d", "#3d7dff", "#ffd23f"];
  for (let s = 0; s < 3; s++) { g.beginPath(); const a = Math.floor(n * s / 3), b = Math.floor(n * (s + 1) / 3); for (let i = a; i <= b; i++) g.lineTo(X(o.x[i % n]), Z(o.z[i % n])); g.strokeStyle = opts.mono ? "#e9edf5" : cols[s]; g.lineWidth = lw; g.stroke(); }
  // start/finish: a chequered tick across the line
  const i0 = 0, i1 = 3 % n, tx = o.x[i1] - o.x[i0], tz = o.z[i1] - o.z[i0], l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l, cx = X(o.x[0]), cz = Z(o.z[0]), r = lw * 2.2;
  g.save(); g.translate(cx, cz); g.rotate(Math.atan2(nz, nx)); for (let k = -2; k < 2; k++) for (let m = 0; m < 2; m++) { g.fillStyle = (k + m) % 2 ? "#111" : "#fff"; g.fillRect(k * r / 2, (m - 1) * r / 2, r / 2, r / 2); } g.restore();
}

// Side views of the three car classes, for the lobby's car cards (in the player's team colours).
export function carIcon(cls, body = "#ff2d2d", accent = "#111", w = 110) {
  const d = "#15171b", wheel = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${d}"/><circle cx="${x}" cy="${y}" r="${r * 0.55}" fill="#3a3d44"/>`;
  const art = {
    gt: `<path d="M8 26c2-6 10-8 20-9l14-7c10-3 26-3 36 1l12 6c8 1 14 3 16 9v4H8z" fill="${body}"/><path d="M44 11c8-2 22-2 30 1l8 5H38z" fill="#0b0e14" opacity=".85"/><path d="M10 26h98" stroke="${accent}" stroke-width="2"/>${wheel(30, 30, 7)}${wheel(90, 30, 7)}`,
    f1: `<path d="M4 9h13v4H4z" fill="${d}"/><path d="M3 7h3v16H3z" fill="${accent}"/><path d="M15 27 20 15c6-3 14-4 22-4l9 3h7l3-3h4l2 4 30 7 12 4v3H15z" fill="${body}"/><path d="M22 23h70l12 3H22z" fill="${accent}" opacity=".9"/><circle cx="64" cy="12.5" r="3.2" fill="${accent}"/><path d="M96 28h20v3H94z" fill="${d}"/>${wheel(26, 28, 8.5)}${wheel(92, 29, 7.5)}`,
    classic: `<path d="M14 24c0-5 6-8 14-9l30-2c4-5 12-5 16 0l26 2c8 1 12 4 12 8v5H16c-2 0-2-2-2-4z" fill="${body}"/><circle cx="66" cy="10.5" r="3.6" fill="#f2f2f2"/><path d="M60 13c3-3 9-3 12 0" stroke="#aecbe0" stroke-width="1.6" fill="none"/><path d="M30 13l10-3M30 16l10-2" stroke="#d9dde3" stroke-width="1.6"/><circle cx="84" cy="21" r="4" fill="#fff"/>${wheel(28, 29, 8)}${wheel(98, 29, 7)}`,
  };
  return `<svg viewBox="0 0 120 38" width="${w}" aria-hidden="true">${art[cls] || art.f1}</svg>`;
}
