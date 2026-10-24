// 確認用：写真（.rgba：先頭8バイトが幅・高さ）を読み取り、正解と比べる
const fs = require("fs"), path = require("path");
require(path.join(__dirname, "../src/engine.js"));
const E = globalThis.KKS_ENGINE;
E.loadNet(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
let total = 0, ok = 0, failSheets = 0;
for (const f of process.argv.slice(3)) {
  const buf = fs.readFileSync(f), w = buf.readUInt32LE(0), h = buf.readUInt32LE(4);
  const truth = JSON.parse(fs.readFileSync(f.replace(/\.rgba$/, ".jpg.truth.json"), "utf8"));
  const t0 = Date.now(); const res = E.readSheet(new Uint8Array(buf.buffer, buf.byteOffset + 8), w, h); const ms = Date.now() - t0;
  if (!res.ok) { console.log(path.basename(f), "目印が見つからない"); failSheets++; continue; }
  const got = res.cells.map(c => c.kind === "empty" ? "_" : c.parts.map(p => p.label).join("/"));
  const errs = [];
  for (let i = 0; i < got.length; i++) { const t = truth[i] || "_"; total++; if (got[i] === t) ok++; else errs.push(`${i}:${t}→${got[i]}`); }
  console.log(path.basename(f), `${ms}ms`, errs.length ? "違い " + errs.join(" ") : "全部一致");
}
console.log(`マス ${ok}/${total} 一致、用紙が見つからない ${failSheets}`);
