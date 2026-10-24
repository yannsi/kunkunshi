/* 工工四を撮ると鳴る三線 — 読み取りの仕組み（画面なしでも動く部分）
   用紙の形・写真から四隅を探す・マスを切り出す・字を見分ける・音の並びにする */
(function (root) {
"use strict";

/* ---------- 用紙の形（単位 mm、A4縦） ---------- */
const SHEET = {
  w: 210, h: 297,
  mark: { size: 10, hole: 4, centers: [[15, 15], [195, 15], [195, 282], [15, 282]] }, // 左上だけ中が白い
  cols: 7, rows: 12, box: 19, lyric: 5, x0: 21, y0: 40,
};
SHEET.colW = SHEET.box + SHEET.lyric;
/* 列 c（0＝いちばん右＝最初に読む列）、行 r のマスの左上（mm） */
function boxOrigin(c, r) {
  return [SHEET.x0 + (SHEET.cols - 1 - c) * SHEET.colW, SHEET.y0 + r * SHEET.box];
}

const LABELS = ["合","乙","老","四","上","中","尺","工","五","六","七","八","九","〇","空","二"]; // 二＝縦に2つ（半拍ずつ）
const CELL = 96, MARGIN = 5, INK_MIN = 40;

/* ---------- 写真 → 明るさ（0..1） ---------- */
function toGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4)
    g[i] = (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) / 255;
  return g;
}
function downscale(g, w, h, maxSide) {
  const s = Math.min(1, maxSide / Math.max(w, h));
  if (s === 1) return { g, w, h, s: 1 };
  const W = Math.round(w * s), H = Math.round(h * s), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y / s), y1 = Math.max(y0 + 1, Math.floor((y + 1) / s));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x / s), x1 = Math.max(x0 + 1, Math.floor((x + 1) / s));
      let a = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < h; yy++) for (let xx = x0; xx < x1 && xx < w; xx++) { a += g[yy * w + xx]; n++; }
      out[y * W + x] = a / n;
    }
  }
  return { g: out, w: W, h: H, s: W / w };
}

/* ---------- 黒い目印を探す ---------- */
function findMarkers(g, w, h) {
  // 周りより暗い所（窓は目印より大きくとる）
  const win = Math.max(15, Math.round(Math.max(w, h) / 8)) | 1, r = win >> 1;
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0;
    for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      const sum = I[yb * (w + 1) + xb] - I[ya * (w + 1) + xb] - I[yb * (w + 1) + xa] + I[ya * (w + 1) + xa];
      const mean = sum / ((yb - ya) * (xb - xa));
      dark[y * w + x] = g[y * w + x] < mean * 0.62 && g[y * w + x] < 0.55 ? 1 : 0;
    }
  }
  const comps = label(dark, w, h, 30);
  const cand = [];
  for (const c of comps) {
    const bw = c.x1 - c.x0, bh = c.y1 - c.y0;
    if (bw < 6 || bh < 6) continue;
    const ar = Math.max(bw / bh, bh / bw); if (ar > 2.5) continue;
    if (c.area / (bw * bh) < 0.45) continue;
    if (c.x0 === 0 || c.y0 === 0 || c.x1 === w || c.y1 === h) continue;
    cand.push(c);
  }
  cand.sort((a, b) => b.area - a.area);
  const top = cand.slice(0, 16);
  const combos = [];
  for (let a = 0; a < top.length; a++) for (let b = a + 1; b < top.length; b++)
  for (let c = b + 1; c < top.length; c++) for (let d = c + 1; d < top.length; d++) {
    const q = [top[a], top[b], top[c], top[d]];
    const areas = q.map(o => o.area), mx = Math.max(...areas), mn = Math.min(...areas);
    if (mx > mn * 3.5) continue;
    const ord = orderCw(q.map(o => [o.cx, o.cy]));
    if (!convex(ord.pts)) continue;
    const A = polyArea(ord.pts), ratio = A / mx;   // 用紙は目印の約400倍の広さ
    if (ratio < 60 || ratio > 2000) continue;
    combos.push({ A, q: ord.idx.map(i => q[i]) });
  }
  combos.sort((x, y) => y.A - x.A);
  // 中が白い目印（左上）が1つだけある組を、大きい順に探す
  const whiteOf = o => {
    let white = 0, n = 0; const rr = Math.max(1, Math.round(Math.min(o.x1 - o.x0, o.y1 - o.y0) * 0.1));
    for (let y = Math.round(o.cy) - rr; y <= Math.round(o.cy) + rr; y++)
      for (let x = Math.round(o.cx) - rr; x <= Math.round(o.cx) + rr; x++) { n++; if (!dark[y * w + x]) white++; }
    return white / n;
  };
  let best = null, holeIdx = 0, holeScore = 0;
  for (const cb of combos.slice(0, 40)) {
    const order = cb.q.map((o, i) => [whiteOf(o), i]).sort((x, y) => y[0] - x[0]);
    if (order[0][0] >= 0.5 && order[1][0] <= 0.35) { best = cb.q; holeIdx = order[0][1]; holeScore = order[0][0]; break; }
  }
  if (!best) return null;
  const pts = [];
  for (let k = 0; k < 4; k++) { const o = best[(holeIdx + k) % 4]; pts.push([o.cx, o.cy]); }
  return { pts, hole: holeScore };
}
function label(m, w, h, minArea) {
  const lab = new Int32Array(w * h), out = [], stack = [];
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || lab[i]) continue;
    n++; lab[i] = n; stack.push(i);
    let area = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p / w) | 0;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x + 1 > x1) x1 = x + 1; if (y + 1 > y1) y1 = y + 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx; if (m[q] && !lab[q]) { lab[q] = n; stack.push(q); }
      }
    }
    if (area >= minArea) out.push({ id: n, area, cx: sx / area + 0.5, cy: sy / area + 0.5, x0, y0, x1, y1 });
  }
  return out;
}
function orderCw(pts) {
  const cx = pts.reduce((a, p) => a + p[0], 0) / 4, cy = pts.reduce((a, p) => a + p[1], 0) / 4;
  const idx = [0, 1, 2, 3].sort((a, b) => Math.atan2(pts[a][1] - cy, pts[a][0] - cx) - Math.atan2(pts[b][1] - cy, pts[b][0] - cx));
  return { idx, pts: idx.map(i => pts[i]) };
}
function convex(p) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (z === 0) return false; const s = z > 0 ? 1 : -1;
    if (sign && s !== sign) return false; sign = s;
  }
  return true;
}
function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return Math.abs(a) / 2; }

/* ---------- 斜めの写真を正面に直す（射影変換） ---------- */
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let k = i + 1; k < n; k++) { const f = A[k][i] / A[i][i]; for (let j = i; j < n; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
  return [x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], 1];
}
function project(H, x, y) {
  const d = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
}
function sampleCell(img, H, c, r) {
  const [ox, oy] = boxOrigin(c, r), k = SHEET.box / CELL, out = new Float32Array(CELL * CELL);
  const { g, w, h } = img;
  for (let j = 0; j < CELL; j++) for (let i = 0; i < CELL; i++) {
    let [u, v] = project(H, ox + (i + 0.5) * k, oy + (j + 0.5) * k);
    u -= 0.5; v -= 0.5;
    const x = Math.max(0, Math.min(w - 1.001, u)), y = Math.max(0, Math.min(h - 1.001, v));
    const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, p = yi * w + xi;
    out[j * CELL + i] = g[p] * (1 - fx) * (1 - fy) + g[p + 1] * fx * (1 - fy) + g[p + w] * (1 - fx) * fy + g[p + w + 1] * fx * fy;
  }
  return out;
}

/* ---------- 1マス → インクの形（学習のときと同じ手順） ---------- */
function inner(cell) {
  const N = CELL - 2 * MARGIN, out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[y * N + x] = cell[(y + MARGIN) * CELL + x + MARGIN];
  return out;
}
function filt1d(a, w, h, size, horiz, op) {
  const r = size >> 1, out = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = op === "max" ? -Infinity : 0;
    for (let k = -r; k <= r; k++) {
      const xx = horiz ? Math.min(w - 1, Math.max(0, x + k)) : x, yy = horiz ? y : Math.min(h - 1, Math.max(0, y + k));
      const v = a[yy * w + xx];
      if (op === "max") { if (v > acc) acc = v; } else acc += v;
    }
    out[y * w + x] = op === "max" ? acc : acc / size;
  }
  return out;
}
function inkMask(c) {
  const N = CELL - 2 * MARGIN;
  let bg = filt1d(filt1d(c, N, N, 15, false, "max"), N, N, 15, true, "max");
  bg = filt1d(filt1d(bg, N, N, 15, false, "mean"), N, N, 15, true, "mean");
  const n = new Float32Array(c.length);
  for (let i = 0; i < c.length; i++) n[i] = c[i] / Math.max(bg[i], 1e-3);
  const v = Float32Array.from(n).sort(), p01 = v[Math.floor(v.length * 0.01)];
  const thr = 1 - Math.max(0.18, 0.5 * (1 - p01));
  const m = new Uint8Array(c.length); for (let i = 0; i < c.length; i++) m[i] = n[i] < thr ? 1 : 0;
  const comps = label(m, N, N, 1), lab = labelMap(m, N, N), keep = new Uint8Array(comps.length + 2);
  for (const k of comps) {
    const hh = k.y1 - k.y0, ww = k.x1 - k.x0;
    if (k.area < 12) continue;
    const edge = k.y0 <= 2 || k.x0 <= 2 || k.y1 >= N - 2 || k.x1 >= N - 2;
    const thin = Math.min(hh, ww) <= 4 && Math.max(hh, ww) >= 0.4 * N;
    if (edge && thin) continue;
    keep[k.id] = 1;
  }
  const out = new Uint8Array(c.length); let ink = 0;
  for (let i = 0; i < c.length; i++) if (keep[lab[i]]) { out[i] = 1; ink++; }
  return { m: out, ink, N };
}
function labelMap(m, w, h) { // label() と同じ番号の付け方で、各点の番号を返す
  const lab = new Int32Array(w * h), stack = []; let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || lab[i]) continue; n++; lab[i] = n; stack.push(i);
    while (stack.length) { const p = stack.pop(), x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx; if (m[q] && !lab[q]) { lab[q] = n; stack.push(q); } } }
  }
  return lab;
}
function normalize(m, W, H, rowA, rowB) {
  rowA = rowA || 0; rowB = rowB == null ? H : rowB;
  let x0 = W, x1 = 0, y0 = H, y1 = 0, any = false;
  for (let y = rowA; y < rowB; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) {
    any = true; if (x < x0) x0 = x; if (x + 1 > x1) x1 = x + 1; if (y < y0) y0 = y; if (y + 1 > y1) y1 = y + 1; }
  if (!any) return null;
  const N = 32, fit = 24, bw = x1 - x0, bh = y1 - y0, s = fit / Math.max(bw, bh);
  const ox = (N - bw * s) / 2, oy = (N - bh * s) / 2, out = new Float32Array(N * N);
  const sx = new Int32Array(N * 4), sy = new Int32Array(N * 4);
  for (let k = 0; k < N * 4; k++) { const sub = (k + 0.5) / 4; sx[k] = Math.floor(x0 + (sub - ox) / s); sy[k] = Math.floor(y0 + (sub - oy) / s); }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let b = 0; b < 4; b++) { const yy = sy[j * 4 + b]; if (yy < y0 || yy >= y1) continue;
      for (let a = 0; a < 4; a++) { const xx = sx[i * 4 + a]; if (xx >= x0 && xx < x1 && m[yy * W + xx]) acc++; } }
    out[j * N + i] = acc / 16;
  }
  return out;
}

/* ---------- 字を見分ける小さな仕組み（畳み込みニューラルネット） ---------- */
let NET = null;
function loadNet(json) {
  const dec = (t) => { const bin = typeof atob === "function" ? atob(t.w) : Buffer.from(t.w, "base64").toString("binary");
    const a = new Float32Array(bin.length); for (let i = 0; i < bin.length; i++) { let v = bin.charCodeAt(i); if (v > 127) v -= 256; a[i] = v * t.scale; } return a; };
  NET = {};
  for (const k of Object.keys(json)) NET[k] = { w: dec(json[k]), b: Float32Array.from(json[k].b), shape: json[k].shape };
}
function conv(x, H, W, I, L) {
  const O = L.shape[3], w = L.w, out = new Float32Array(H * W * O);
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const o0 = (y * W + xx) * O;
    for (let o = 0; o < O; o++) out[o0 + o] = L.b[o];
    for (let ky = 0; ky < 3; ky++) { const yy = y + ky - 1; if (yy < 0 || yy >= H) continue;
      for (let kx = 0; kx < 3; kx++) { const x2 = xx + kx - 1; if (x2 < 0 || x2 >= W) continue;
        const i0 = (yy * W + x2) * I, w0 = (ky * 3 + kx) * I * O;
        for (let i = 0; i < I; i++) { const v = x[i0 + i]; if (!v) continue; const wi = w0 + i * O;
          for (let o = 0; o < O; o++) out[o0 + o] += v * w[wi + o]; } } }
    for (let o = 0; o < O; o++) if (out[o0 + o] < 0) out[o0 + o] = 0;
  }
  return out;
}
function pool(x, H, W, C) {
  const h = H >> 1, w = W >> 1, out = new Float32Array(h * w * C);
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) for (let c = 0; c < C; c++) {
    const a = (i, j) => x[((2 * y + i) * W + 2 * xx + j) * C + c];
    out[(y * w + xx) * C + c] = Math.max(a(0, 0), a(0, 1), a(1, 0), a(1, 1));
  }
  return out;
}
function dense(x, L, relu) {
  const [I, O] = L.shape, out = Float32Array.from(L.b);
  for (let i = 0; i < I; i++) { const v = x[i]; if (!v) continue; const wi = i * O; for (let o = 0; o < O; o++) out[o] += v * L.w[wi + o]; }
  if (relu) for (let o = 0; o < O; o++) if (out[o] < 0) out[o] = 0;
  return out;
}
function classify(img32) {
  let x = conv(img32, 32, 32, 1, NET.c1); x = pool(x, 32, 32, 16);
  x = conv(x, 16, 16, 16, NET.c2); x = pool(x, 16, 16, 32);
  x = conv(x, 8, 8, 32, NET.c3); x = pool(x, 8, 8, 64);
  x = dense(x, NET.d1, true); const lg = dense(x, NET.d2, false);
  let mx = -Infinity; for (const v of lg) if (v > mx) mx = v;
  let s = 0; const p = lg.map(v => { const e = Math.exp(v - mx); s += e; return e; });
  const probs = Array.from(p, v => v / s);
  let best = 0; probs.forEach((v, i) => { if (v > probs[best]) best = i; });
  return { label: LABELS[best], conf: probs[best], probs };
}

/* ---------- 1マスを読む（縦に2つ書いてあれば半拍ずつ） ---------- */
function bestSingle(r) { // 「空」「二」以外でいちばん確からしい字
  let k = -1; r.probs.forEach((v, i) => { if (LABELS[i] !== "空" && LABELS[i] !== "二" && (k < 0 || v > r.probs[k])) k = i; });
  return { label: LABELS[k], conf: r.probs[k], probs: r.probs };
}
/* 字の右上に付く小さな印（「 、など）を取り除く：小さくて右側だけにある部分 */
function cleanMarks(m, N, strict) {
  const comps = label(m, N, N, 1), lab = labelMap(m, N, N);
  let total = 0; comps.forEach(k => total += k.area);
  // 候補：小さく、右側にあるもの。ただし字の本体（ほかの部分）の右端より右に離れているものだけ
  // （ぼけた写真では字の線がちぎれて小さな部分になるので、本体と横に重なるものは消さない）
  const cand = comps.filter(k => k.area < total * 0.35 && k.x0 > N * 0.6);
  const body = comps.filter(k => !cand.includes(k));
  if (!body.length) return total;
  const right = Math.max(...body.map(k => k.x1));
  const top = Math.min(...body.map(k => k.y0)), bot = Math.max(...body.map(k => k.y1)), bh = bot - top;
  // 本体の右端からすき間をあけて離れていて、背の低いもの（字の線のちぎれた部分は背が高い）
  // （小さな字では印が字に近く背も高めなので、strict でなければ右側の小さな部分はすべて消す）
  const drop = new Set(cand.filter(k => !strict || (k.x0 >= right + 1 && (k.y1 - k.y0) < bh * 0.5)).map(k => k.id));
  if (!drop.size) return total;
  let ink = 0; for (let i = 0; i < m.length; i++) { if (drop.has(lab[i])) m[i] = 0; ink += m[i]; }
  return ink;
}
function readCell(cell, opts) {
  const c = inner(cell), mk = inkMask(c), { m, N } = mk;
  const plain = readMask(m, N, mk.ink);
  if (!(opts && opts.marks) || mk.ink < INK_MIN) return plain;
  // 右の小さな印を消した形でも読み、確かな方をとる（ぼけて字の線がちぎれたときに、字の一部を印とまちがえて消さないように）
  const m2 = Uint8Array.from(m), ink2 = cleanMarks(m2, N, opts.marks !== "prefer");
  if (ink2 === mk.ink) return plain;
  const cleaned = readMask(m2, N, ink2);
  const score = r => r.kind === "note" ? 1 + Math.min(...r.parts.map(p => p.conf)) : 0;
  // 小さな字には印が付いていることが多いので、消した形で読めればそちらを使う
  if (opts.marks === "prefer") return cleaned;
  return score(cleaned) > score(plain) ? cleaned : plain;
}
function readMask(m, N, ink) {
  if (ink < INK_MIN) return { kind: "empty", parts: [], ink };
  const whole = classify(normalize(m, N, N));
  if (whole.label === "空") return { kind: "empty", parts: [], ink, conf: whole.conf };
  if (whole.label !== "二") return { kind: "note", parts: [whole], ink };
  // 上下2つに分ける：インクのない行がいちばん長く続く所、なければインクがいちばん少ない行
  const rowInk = new Int32Array(N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) rowInk[y] += m[y * N + x];
  let ya = 0; while (ya < N && !rowInk[ya]) ya++;
  let yb = N; while (yb > 0 && !rowInk[yb - 1]) yb--;
  const lo = Math.round(ya + (yb - ya) * 0.25), hi = Math.round(ya + (yb - ya) * 0.75);
  let cut = -1, best = -1, run = 0;
  for (let y = lo; y < hi; y++) { if (!rowInk[y]) { run++; if (run > best) { best = run; cut = y - Math.floor(run / 2); } } else run = 0; }
  if (cut < 0) { let mn = Infinity; for (let y = lo; y < hi; y++) if (rowInk[y] < mn) { mn = rowInk[y]; cut = y; } }
  const na = normalize(m, N, N, 0, cut), nb = normalize(m, N, N, cut + 1, N);
  const a = na && classify(na), b = nb && classify(nb);
  const okPart = r => r && r.label !== "空" && r.label !== "二";
  if (!okPart(a) || !okPart(b)) return { kind: "note", parts: [bestSingle(whole)], ink };
  a.conf = Math.min(a.conf, whole.conf); b.conf = Math.min(b.conf, whole.conf);
  return { kind: "note", parts: [a, b], ink };
}

/* ---------- 写真全体を読む ---------- */
/* 見つけた4点が本当に用紙の目印か確かめる：中は黒く、まわりは白く、左上だけ中心が白い */
function verifySheet(img, H) {
  const { g, w, h } = img;
  const at = (x, y) => { const [u, v] = project(H, x, y); const xi = Math.round(u), yi = Math.round(v);
    return xi < 0 || yi < 0 || xi >= w || yi >= h ? null : g[yi * w + xi]; };
  let okAll = true;
  SHEET.mark.centers.forEach(([cx, cy], i) => {
    const ring = [], inside = [];
    for (let k = 0; k < 16; k++) { const a = k / 16 * 2 * Math.PI; ring.push(at(cx + 8 * Math.cos(a), cy + 8 * Math.sin(a))); }
    for (const dx of [-3.5, 0, 3.5]) for (const dy of [-3.5, 0, 3.5]) { if (i === 0 && dx === 0 && dy === 0) continue; inside.push(at(cx + dx, cy + dy)); }
    if (ring.concat(inside).some(v => v == null)) { okAll = false; return; }
    const paper = ring.slice().sort((a, b) => a - b)[8];
    const darkIn = inside.filter(v => v < paper * 0.6).length / inside.length;
    const lightRing = ring.filter(v => v > paper * 0.75).length / ring.length;
    let hole = true; if (i === 0) hole = at(cx, cy) > paper * 0.7;
    if (darkIn < 0.85 || lightRing < 0.75 || !hole) okAll = false;
  });
  return okAll;
}
function readSheet(rgba, w, h) {
  const gray = toGray(rgba, w, h);
  const small = downscale(gray, w, h, 1000);
  const found = findMarkers(small.g, small.w, small.h);
  if (!found) return { ok: false, reason: "marks" };
  const big = downscale(gray, w, h, 2400);
  const pts = found.pts.map(([x, y]) => [x / small.s * big.s, y / small.s * big.s]);
  const H = homography(SHEET.mark.centers, pts);
  if (!verifySheet(big, H)) return { ok: false, reason: "marks" };
  const cells = [];
  for (let c = 0; c < SHEET.cols; c++) for (let r = 0; r < SHEET.rows; r++) {
    const res = readCell(sampleCell(big, H, c, r));
    res.c = c; res.r = r; cells.push(res);
  }
  return { ok: true, cells, corners: pts.map(([x, y]) => [x / big.s, y / big.s]), H, scale: big.s };
}

/* ---------- 本・PDFの工工四を読む（目印なし。マス目の線を探す） ---------- */
function findBookGrid(g, w, h) {
  // 暗い点：周りの明るさより暗い所（写真の明るさむらに負けないよう、広めの窓で比べる）
  const win = Math.max(15, Math.round(Math.max(w, h) / 60)) | 1, r = win >> 1;
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0;
    for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) { const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      const mean = (I[yb * (w + 1) + xb] - I[ya * (w + 1) + xb] - I[yb * (w + 1) + xa] + I[ya * (w + 1) + xa]) / ((yb - ya) * (xb - xa));
      dark[y * w + x] = g[y * w + x] < Math.min(mean * 0.93, mean - 0.05) ? 1 : 0; } }  // 写真では細い線が薄くなるので、わずかな暗さも拾う
  // 縦線：上下に長く続く暗い列（2点までの切れ目は許す）
  const minRun = h * 0.2, vcols = [];
  for (let x = 0; x < w; x++) {
    let best = 0, bs = 0, cur = 0, cs = 0, gap = 0;
    for (let y = 0; y < h; y++) {
      const d = dark[y * w + x] || (x > 0 && dark[y * w + x - 1]) || (x < w - 1 && dark[y * w + x + 1]);
      if (d) { if (cur === 0) cs = y; cur += 1 + gap; gap = 0; if (cur > best) { best = cur; bs = cs; } }
      else if (cur > 0 && gap < 2) gap++; else { cur = 0; gap = 0; }
    }
    if (best >= minRun) vcols.push({ x, y0: bs, y1: bs + best });
  }
  const vlines = [];
  for (const v of vcols) {
    const L = vlines[vlines.length - 1];
    if (L && v.x - L.xe <= 2) { L.xe = v.x; L.y0 = Math.min(L.y0, v.y0); L.y1 = Math.max(L.y1, v.y1); L.n++; L.sx += v.x; }
    else vlines.push({ xs: v.x, xe: v.x, y0: v.y0, y1: v.y1, n: 1, sx: v.x });
  }
  vlines.forEach(L => L.x = L.sx / L.n);
  // となり合う縦線の間に、横線が何本も規則正しく入っていれば、それが音のマスの列
  const cols = [];
  for (let i = 0; i + 1 < vlines.length; i++) {
    const A = vlines[i], B = vlines[i + 1], bw = B.x - A.x;
    if (bw < w * 0.012 || bw > w * 0.15) continue;
    const y0 = Math.max(A.y0, B.y0), y1 = Math.min(A.y1, B.y1); if (y1 - y0 < minRun) continue;
    const xa = Math.round(A.xe + 2), xb = Math.round(B.xs - 2); if (xb - xa < 4) continue;
    const rows = [];
    for (let y = Math.max(0, y0 - 3); y <= Math.min(h - 1, y1 + 3); y++) {
      let n = 0; for (let x = xa; x <= xb; x++) n += dark[y * w + x] || (y > 0 && dark[(y - 1) * w + x]) ? 1 : 0;
      if (n >= (xb - xa + 1) * 0.85) rows.push(y);
    }
    const hl = [];
    for (const y of rows) { const L = hl[hl.length - 1]; if (L && y - L.e <= 2) { L.e = y; } else hl.push({ s: y, e: y }); }
    const ys = hl.map(o => (o.s + o.e) / 2);
    if (ys.length < 5) continue;
    const gaps = []; for (let k = 1; k < ys.length; k++) gaps.push(ys[k] - ys[k - 1]);
    const med = gaps.slice().sort((a, b) => a - b)[gaps.length >> 1];
    if (med < bw * 0.5 || med > bw * 3) continue;
    const boxes = [];
    for (let k = 1; k < ys.length; k++) {
      const gh = ys[k] - ys[k - 1];
      if (gh < med * 0.6) continue;              // 二重線などの細いすき間
      const n = Math.max(1, Math.round(gh / med)); // 線が消えて2マスつながって見えるとき
      for (let j = 0; j < n; j++) boxes.push({ x0: A.x, x1: B.x, y0: ys[k - 1] + gh * j / n, y1: ys[k - 1] + gh * (j + 1) / n });
    }
    if (boxes.length >= 4) cols.push({ x: (A.x + B.x) / 2, boxes });
  }
  cols.sort((a, b) => b.x - a.x);  // 右から読む
  // 線がかすれて見つからなかったマスは、いちばん近い「全部そろった列」の高さに合わせて補う
  const full = Math.max(0, ...cols.map(c => c.boxes.length)), refs = cols.filter(c => c.boxes.length === full);
  for (const col of cols) {
    if (col.boxes.length === full) continue;
    const ref = refs.reduce((a, b) => Math.abs(b.x - col.x) < Math.abs(a.x - col.x) ? b : a);
    const x0 = col.boxes[0].x0, x1 = col.boxes[0].x1;
    col.boxes = ref.boxes.map(rb => {
      const ry = (rb.y0 + rb.y1) / 2, rh = rb.y1 - rb.y0;
      const own = col.boxes.find(b => Math.abs((b.y0 + b.y1) / 2 - ry) < rh * 0.4);
      return own || { x0, x1, y0: rb.y0, y1: rb.y1, guessed: true };
    });
  }
  return cols;
}
function sampleBox(img, b) {
  // マスの中心に、短い辺の長さの正方形をとって CELL x CELL にする
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, side = Math.min(b.x1 - b.x0, b.y1 - b.y0);
  const out = new Float32Array(CELL * CELL), { g, w, h } = img, k = side / CELL;
  for (let j = 0; j < CELL; j++) for (let i = 0; i < CELL; i++) {
    const u = cx - side / 2 + (i + 0.5) * k - 0.5, v = cy - side / 2 + (j + 0.5) * k - 0.5;
    const x = Math.max(0, Math.min(w - 1.001, u)), y = Math.max(0, Math.min(h - 1.001, v));
    const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, p = yi * w + xi;
    out[j * CELL + i] = g[p] * (1 - fx) * (1 - fy) + g[p + 1] * fx * (1 - fy) + g[p + w] * (1 - fx) * fy + g[p + w + 1] * fx * fy;
  }
  return out;
}
/* 斜めの写真を直す：縦線がまっすぐ縦にそろう「回転」と「上下のすぼまり（台形）」を探して、その逆をかける */
function rectifyBook(img) {
  const sm = downscale(img.g, img.w, img.h, 800), { g, w, h } = sm;
  const pts = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const v = g[y * w + x], l = g[y * w + x - 1], r = g[y * w + x + 1];
    if (v < l - 0.04 && v < r - 0.04) pts.push(x, y);   // 左右より暗い＝縦の線の上の点
  }
  if (pts.length < 200) return null;
  const xc = w / 2, yc = h / 2, bins = new Float32Array(w * 3);
  const score = (th, k) => {
    bins.fill(0); const c = Math.cos(th), s = Math.sin(th);
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i] - xc, dy = pts[i + 1] - yc, xr = c * dx + s * dy, yr = -s * dx + c * dy;
      const u = xr / (1 + k * yr / h) + w * 1.5; const b = u | 0; if (b >= 0 && b < bins.length) bins[b]++;
    }
    let e = 0; for (let i = 0; i < bins.length; i++) e += bins[i] * bins[i]; return e;
  };
  let best = { th: 0, k: 0, e: score(0, 0) }; const e0 = best.e;
  for (let th = -8; th <= 8; th += 0.5) for (let k = -0.2; k <= 0.2001; k += 0.025) {
    const e = score(th * Math.PI / 180, k); if (e > best.e) best = { th: th * Math.PI / 180, k, e }; }
  for (const [dt, dk] of [[0.2, 0.01], [0.08, 0.004], [0.03, 0.0015]]) {
    const b0 = best;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const th = b0.th + a * dt * Math.PI / 180, k = b0.k + b * dk, e = score(th, k); if (e > best.e) best = { th, k, e }; }
  }
  if (Math.abs(best.th) < 0.002 && Math.abs(best.k) < 0.003) return null;
  if (best.e < e0 * 1.05) return null;
  // 直した画像を作る（元の大きさで）
  const W = img.w, H = img.h, Xc = W / 2, Yc = H / 2, out = new Float32Array(W * H);
  const c = Math.cos(best.th), sn = Math.sin(best.th), src = img.g;
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    const yr = v - Yc, xr = (u - Xc) * (1 + best.k * yr / H);
    const x = c * xr - sn * yr + Xc, y = sn * xr + c * yr + Yc;
    if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) { out[v * W + u] = 1; continue; }
    const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, p = yi * W + xi;
    out[v * W + u] = src[p] * (1 - fx) * (1 - fy) + src[p + 1] * fx * (1 - fy) + src[p + W] * (1 - fx) * fy + src[p + W + 1] * fx * fy;
  }
  return { g: out, w: W, h: H, s: img.s, th: best.th, k: best.k };
}
/* マスの下の線にまたがって書かれた小さな字を読む（なければ null）。
   横線は (1) 全部消す (2) 字の左右だけ消す（線と重なる字の横棒を残す）の両方で読んで、確かな方をとる */
function readSmall(img, b) {
  const W = b.x1 - b.x0, H = b.y1 - b.y0;
  const base = sampleBox(img, { x0: b.x0, x1: b.x1, y0: b.y1 - W / 2, y1: b.y1 + W / 2 }), k = CELL / W, keep = Math.min(0.2 * H * k, CELL / 2);
  const vals = Float32Array.from(base).sort(), paper = vals[Math.floor(vals.length * 0.9)];
  for (let r = 0; r < CELL; r++) if (Math.abs(r + 0.5 - CELL / 2) > keep) for (let x = 0; x < CELL; x++) base[r * CELL + x] = paper;
  const isLine = r => { let n = 0; for (let x = 0; x < CELL; x++) if (base[r * CELL + x] < paper - 0.2) n++; return n >= CELL * 0.6; };
  let a = -1, z = -1;
  for (let r = CELL / 2 - 10; r <= CELL / 2 + 10; r++) if (isLine(r)) { if (a < 0) a = r; z = r; }
  const tries = [base];
  if (a >= 0) {
    const ra = Math.max(0, a - 2), rz = Math.min(CELL - 1, z + 2);
    // 字の左右の広がり：線の上下にインクがある列
    let gx0 = CELL, gx1 = -1;
    for (let x = MARGIN + 3; x < CELL * 0.62; x++) {   // 右側の印（「 など）は含めない
      let n = 0; for (let r = 0; r < CELL; r++) if ((r < ra || r > rz) && base[r * CELL + x] < paper - 0.25) n++;
      if (n >= 2) { if (x < gx0) gx0 = x; gx1 = x; }
    }
    const fill = (only) => { const c = Float32Array.from(base);
      for (let x = 0; x < CELL; x++) { if (only && x >= gx0 - 1 && x <= gx1 + 1) continue;
        const top = c[ra * CELL + x], bot = c[rz * CELL + x];
        for (let r = ra + 1; r < rz; r++) c[r * CELL + x] = top + (bot - top) * (r - ra) / (rz - ra); }
      return c; };
    tries[0] = fill(false);
    if (gx1 >= gx0) tries.push(fill(true));
  }
  let best = null;
  for (const cell of tries) {
    const res = readCell(cell, { marks: "prefer" });
    if (res.kind !== "note" || res.parts.length !== 1) continue;
    if (!best || res.parts[0].conf > best.conf) best = res.parts[0];
  }
  return best && best.conf >= 0.5 ? best : null;
}
function readBook(rgba, w, h, maxSide) {
  const gray = toGray(rgba, w, h);
  let img = downscale(gray, w, h, maxSide || 2400);
  let cols = findBookGrid(img.g, img.w, img.h);
  // 斜めに写っていれば直して探し直し、マスが多く見つかった方を使う
  const fixed = rectifyBook(img);
  if (fixed) {
    const c2 = findBookGrid(fixed.g, fixed.w, fixed.h), n = cs => cs.reduce((a, c) => a + c.boxes.length, 0);
    if (n(c2) > n(cols)) { img = fixed; cols = c2; }
  }
  if (!cols.length) return { ok: false, reason: "grid" };
  const rows = Math.max(...cols.map(c => c.boxes.length)), cells = [];
  cols.forEach((col, c) => {
    for (let r = 0; r < rows; r++) {
      const b = col.boxes[r];
      const res = b ? readCell(sampleBox(img, b), { marks: true }) : { kind: "empty", parts: [], ink: 0 };
      if (b && res.kind !== "empty" && res.parts.length === 1) {
        const small = readSmall(img, b);
        if (small) { res.parts.push(small); res.small = true; }
      }
      res.c = c; res.r = r; cells.push(res);
    }
  });
  return { ok: true, cells, cols: cols.length, rows, scale: img.s,
    grid: cols.map(c => c.boxes.map(b => [b.x0 / img.s, b.y0 / img.s, b.x1 / img.s, b.y1 / img.s])) };
}
/* 写真1枚を読む：まず専用の用紙（四隅の目印）、なければ本のマス目として読む */
function readAny(rgba, w, h, maxSide) {
  const a = readSheet(rgba, w, h);
  if (a.ok) { a.kind = "sheet"; a.cols = SHEET.cols; a.rows = SHEET.rows; return a; }
  const b = readBook(rgba, w, h, maxSide);
  if (b.ok) b.kind = "book";
  return b;
}

/* ---------- マスの並び → 音の並び ---------- */
const KKS = { "合": 60, "乙": 62, "老": 64, "四": 65, "上": 67, "中": 69, "尺": 70, "工": 72, "五": 74, "六": 76, "七": 77, "八": 79, "九": 81 };
/* boxes: 読む順の配列。各要素 {kind:"empty"|"note", parts:[{label}]}。
   返り値: [{pitch(0=休み), beats, box}]  空きマスは前の音をのばす */
/* 調弦：本調子から、どの弦を何半音動かすか。男弦＝合乙老、中弦＝四上中尺、女弦＝工五六七八九 */
const TUNINGS = {
  honchoshi: { name: "本調子", shift: {} },
  niage:     { name: "二揚げ", shift: { "四": 2, "上": 2, "中": 2, "尺": 2 } },
  ichiage:   { name: "一揚げ", shift: { "合": 2, "乙": 2, "老": 2 } },
  ichiniage: { name: "一二揚げ", shift: { "合": 2, "乙": 2, "老": 2, "四": 2, "上": 2, "中": 2, "尺": 2 } },
  sansage:   { name: "三下げ", shift: { "工": -2, "五": -2, "六": -2, "七": -2, "八": -2, "九": -2 } },
};
/* 楽譜に書いてある文字（PDFの文字や曲名）から、調弦・拍の数・かかる時間を読む */
function kanjiNum(t) {
  if (/^[0-9０-９]+$/.test(t)) return Number(t.replace(/[０-９]/g, d => "０１２３４５６７８９".indexOf(d)));
  const D = { "〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  let total = 0, cur = 0;
  for (const ch of t) {
    if (ch in D) cur = cur * 10 + D[ch];
    else if (ch === "十") { total += (cur || 1) * 10; cur = 0; }
    else if (ch === "百") { total += (cur || 1) * 100; cur = 0; }
    else if (ch === "千") { total += (cur || 1) * 1000; cur = 0; }
  }
  return total + cur;
}
function parseScoreText(text) {
  const t = (text || "").replace(/\s+/g, ""), out = {};
  if (/一二揚|一二上/.test(t)) out.tuning = "ichiniage";
  else if (/二揚|二上/.test(t)) out.tuning = "niage";
  else if (/一揚|一上/.test(t)) out.tuning = "ichiage";
  else if (/三下/.test(t)) out.tuning = "sansage";
  else if (/本調子/.test(t)) out.tuning = "honchoshi";
  const N = "[〇零一二三四五六七八九十百千0-9０-９]+";
  const b = t.match(new RegExp("(" + N + ")拍子")); if (b) out.beats = kanjiNum(b[1]);
  const m = t.match(new RegExp("(?:所用|所要)時間[^（）()]*?(?:(" + N + ")分)?(" + N + ")秒"));
  if (m) out.seconds = (m[1] ? kanjiNum(m[1]) * 60 : 0) + kanjiNum(m[2]);
  return out;
}
function toNotes(boxes, tuning) {
  const sh = (TUNINGS[tuning] || TUNINGS.honchoshi).shift;
  let last = -1; boxes.forEach((b, i) => { if (b.kind !== "empty") last = i; });
  const notes = [];
  for (let i = 0; i <= last; i++) {
    const b = boxes[i];
    if (b.kind === "empty") {
      if (notes.length) notes[notes.length - 1].beats += 1; else notes.push({ pitch: 0, beats: 1, box: i, part: 0 });
      continue;
    }
    const k = b.parts.length, d = 1 / k;
    // 小さく書かれた字（小弾・打音・掛音）は、弱めに鳴らす
    b.parts.forEach((p, j) => notes.push({ pitch: p.label === "〇" || !KKS[p.label] ? 0 : KKS[p.label] + (sh[p.label] || 0), beats: d, box: i, part: j, soft: !!(b.small && j === 1) }));
  }
  return notes;
}

root.KKS_ENGINE = { TUNINGS, parseScoreText, kanjiNum, findBookGrid, sampleBox, readBook, readAny, SHEET, LABELS, CELL, MARGIN, INK_MIN, boxOrigin, toGray, downscale, findMarkers, homography, project,
  sampleCell, inner, inkMask, normalize, loadNet, classify, readCell, readSheet, toNotes, KKS };
})(typeof window !== "undefined" ? window : globalThis);
