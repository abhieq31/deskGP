// Bundles everything into one self-contained file: deskgp.html (no external requests at all).
import { build, context } from "esbuild";
import fs from "node:fs";

const watch = process.argv.includes("--watch");
const opts = { entryPoints: ["src/main.js"], bundle: true, format: "iife", minify: !watch, target: "es2020", write: false, legalComments: "none" };

function emit(js) {
  const css = fs.readFileSync("src/style.css", "utf8");
  const html = fs.readFileSync("src/index.html", "utf8")
    .replace("/*CSS*/", () => css)
    .replace("<!--JS-->", () => `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`);
  fs.writeFileSync("deskgp.html", html);
  console.log(`deskgp.html ${(html.length / 1024).toFixed(0)} KB`);
}

if (watch) {
  const ctx = await context({ ...opts, plugins: [{ name: "emit", setup(b) { b.onEnd((r) => { if (r.outputFiles) emit(r.outputFiles[0].text); }); } }] });
  await ctx.watch();
} else {
  const r = await build(opts);
  emit(r.outputFiles[0].text);
}
