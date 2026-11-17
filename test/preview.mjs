// Draws each circuit with its props to an SVG (and PNG if Playwright is around) for layout work.
import { TRACKS, buildTrack, DESK, PROP_SHAPES } from "../src/track.js";
import fs from "node:fs";
const out = process.argv[2] || "preview";
let html = "<body style='margin:0;background:#222'>";
for (const def of TRACKS) {
  const T = buildTrack(def); let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-DESK.hx - 10} ${-DESK.hz - 10} ${DESK.hx * 2 + 20} ${DESK.hz * 2 + 20}" width="1100" style="display:block;margin:6px">`;
  s += `<rect x="${-DESK.hx}" y="${-DESK.hz}" width="${DESK.hx * 2}" height="${DESK.hz * 2}" fill="#b98a5a"/>`;
  for (let gx = -500; gx <= 500; gx += 100) s += `<line x1="${gx}" y1="-330" x2="${gx}" y2="330" stroke="#0002"/><text x="${gx + 2}" y="-318" font-size="11">${gx}</text>`;
  for (let gz = -300; gz <= 300; gz += 100) s += `<line x1="-520" y1="${gz}" x2="520" y2="${gz}" stroke="#0002"/><text x="-516" y="${gz - 2}" font-size="11">${gz}</text>`;
  let d = ""; for (let i = 0; i < T.n; i++) d += `${i ? "L" : "M"}${T.x[i].toFixed(1)},${T.z[i].toFixed(1)}`;
  s += `<path d="${d}Z" fill="none" stroke="#333" stroke-width="${T.width}" stroke-linejoin="round"/>`;
  let l = ""; for (let i = 0; i < T.n; i++) l += `${i ? "L" : "M"}${T.lx[i].toFixed(1)},${T.lz[i].toFixed(1)}`;
  s += `<path d="${l}Z" fill="none" stroke="#fc0" stroke-width="1"/>`;
  for (let i = 0; i < T.n; i += 4) if (T.drs[i]) s += `<circle cx="${T.x[i]}" cy="${T.z[i]}" r="1.5" fill="#0f0"/>`;
  for (let i = 0; i < T.n; i += 100) s += `<text x="${T.x[i] + T.nx[i] * 14}" y="${T.z[i] + T.nz[i] * 14}" font-size="10" fill="#fff">${(i / T.n).toFixed(2)}</text>`;
  s += `<circle cx="${T.x[0]}" cy="${T.z[0]}" r="5" fill="#fff"/>`;
  def.pts.forEach((p, i) => s += `<text x="${p[0]}" y="${p[1]}" font-size="9" fill="#0ff">${i}</text>`);
  for (const p of def.props) { const sh = PROP_SHAPES[p.t];
    s += sh.r ? `<circle cx="${p.x}" cy="${p.z}" r="${sh.r}" fill="#fffa" stroke="#000"/>` : `<rect x="${-sh.w / 2}" y="${-sh.d / 2}" width="${sh.w}" height="${sh.d}" fill="#fffa" stroke="#000" transform="translate(${p.x},${p.z}) rotate(${(p.rot || 0) * 57.2958})"/>`;
    s += `<text x="${p.x - 12}" y="${p.z + 3}" font-size="9">${p.t}</text>`; }
  for (const sp of T.spills) s += `<circle cx="${sp.x}" cy="${sp.z}" r="${sp.r}" fill="#6338"/>`;
  for (const pd of T.pads) s += `<circle cx="${pd.x}" cy="${pd.z}" r="4" fill="#ff0"/>`;
  html += s + `<text x="-500" y="-300" font-size="20">${def.name} ${T.len.toFixed(0)}</text></svg>`;
}
fs.writeFileSync(out + ".html", html);
try { const { chromium } = await import(process.env.PW || "playwright"); const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1120, height: 2180 } }); await p.goto("file://" + fs.realpathSync(out + ".html")); await p.screenshot({ path: out + ".png" }); await b.close(); } catch (e) { console.log("no png:", e.message); }
