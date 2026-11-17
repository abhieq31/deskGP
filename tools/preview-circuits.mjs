// Plot raw dataset geometry (index 0 marked, direction arrows) to check start point and racing direction.
import fs from "node:fs";
const ids = process.argv.slice(3), out = process.argv[2];
const d = JSON.parse(fs.readFileSync("tools/f1-circuits.geojson", "utf8"));
let html = "<body style='margin:0;background:#222;display:flex;flex-wrap:wrap'>";
for (const id of ids) {
  const f = d.features.find((x) => x.properties.id === id), c = f.geometry.coordinates;
  const lat0 = c.reduce((a, p) => a + p[1], 0) / c.length, lon0 = c.reduce((a, p) => a + p[0], 0) / c.length;
  const P = c.map(([lo, la]) => [(lo - lon0) * Math.cos(lat0 * Math.PI / 180) * 111320, -(la - lat0) * 110540]);
  let area = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const xs = P.map((p) => p[0]), zs = P.map((p) => p[1]), mx = Math.min(...xs) - 60, mz = Math.min(...zs) - 60, w = Math.max(...xs) - mx + 60, h = Math.max(...zs) - mz + 60;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mx} ${mz} ${w} ${h}" width="620" style="background:#3a5;margin:4px">`;
  s += `<polyline points="${P.map((p) => p.join(",")).join(" ")} ${P[0].join(",")}" fill="none" stroke="#222" stroke-width="${w / 120}"/>`;
  for (let i = 0; i < P.length; i += 8) { const a = P[i], b = P[(i + 2) % P.length]; s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#ff0" stroke-width="${w / 200}"/><circle cx="${b[0]}" cy="${b[1]}" r="${w / 160}" fill="#ff0"/><text x="${a[0] + 15}" y="${a[1]}" font-size="${w / 40}" fill="#fff">${i}</text>`; }
  s += `<circle cx="${P[0][0]}" cy="${P[0][1]}" r="${w / 60}" fill="#f00"/><text x="${mx + 20}" y="${mz + w / 20}" font-size="${w / 22}" fill="#fff">${id} n=${P.length} ${area > 0 ? "CW on screen" : "ACW on screen"} (north up)</text></svg>`;
  html += s;
}
fs.writeFileSync(out + ".html", html + "</body>");
const { chromium } = await import(process.env.PW);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1270, height: +(process.env.VH || 1300) } }); await p.goto("file://" + fs.realpathSync(out + ".html")); await p.screenshot({ path: out + ".png" }); await b.close();
