// 確認用：本・PDFのページ（.rgba）を読み、正解（右の列から上から下へ、_＝空き）と比べる
const fs = require("fs"), path = require("path");
require(path.join(__dirname, "../src/engine.js"));
const E = globalThis.KKS_ENGINE;
E.loadNet(JSON.parse(fs.readFileSync(path.join(__dirname, "../model/model.json"), "utf8")));
const [file, truthStr] = process.argv.slice(2);
const buf = fs.readFileSync(file), w = buf.readUInt32LE(0), h = buf.readUInt32LE(4);
const t0 = Date.now(); const res = E.readAny(new Uint8Array(buf.buffer, buf.byteOffset + 8), w, h);
if (!res.ok) { console.log("読めない", res.reason); process.exit(1); }
const got = res.cells.map(c => c.kind === "empty" ? "_" : c.parts.map(p => p.label).join("/"));
console.log(res.kind, `${res.cols}列×${res.rows}マス`, `${Date.now() - t0}ms`);
const truth = truthStr ? [...truthStr] : null; let ok = 0; const errs = [], low = [];
res.cells.forEach((c, i) => {
  if (c.kind === "note" && c.parts.some(p => p.conf < 0.85)) low.push(`${i}:${got[i]}(${c.parts.map(p => p.conf.toFixed(2))})`);
  if (truth) { if ((truth[i] || "_") === got[i]) ok++; else errs.push(`${Math.floor(i / res.rows) + 1}列${i % res.rows + 1}:${truth[i]}→${got[i]}`); }
});
if (truth) console.log(`一致 ${ok}/${got.length}`, errs.join(" "));
console.log("自信なし", low.join(" "));
