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
function readCell(cell) {
  const c = inner(cell), { m, ink, N } = inkMask(c);
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
function readSheet(rgba, w, h) {
  const gray = toGray(rgba, w, h);
  const small = downscale(gray, w, h, 1000);
  const found = findMarkers(small.g, small.w, small.h);
  if (!found) return { ok: false, reason: "marks" };
  const big = downscale(gray, w, h, 2400);
  const pts = found.pts.map(([x, y]) => [x / small.s * big.s, y / small.s * big.s]);
  const H = homography(SHEET.mark.centers, pts);
  const cells = [];
  for (let c = 0; c < SHEET.cols; c++) for (let r = 0; r < SHEET.rows; r++) {
    const res = readCell(sampleCell(big, H, c, r));
    res.c = c; res.r = r; cells.push(res);
  }
  return { ok: true, cells, corners: pts.map(([x, y]) => [x / big.s, y / big.s]), H, scale: big.s };
}

/* ---------- マスの並び → 音の並び ---------- */
const KKS = { "合": 60, "乙": 62, "老": 64, "四": 65, "上": 67, "中": 69, "尺": 70, "工": 72, "五": 74, "六": 76, "七": 77, "八": 79, "九": 81 };
/* boxes: 読む順の配列。各要素 {kind:"empty"|"note", parts:[{label}]}。
   返り値: [{pitch(0=休み), beats, box}]  空きマスは前の音をのばす */
function toNotes(boxes) {
  let last = -1; boxes.forEach((b, i) => { if (b.kind !== "empty") last = i; });
  const notes = [];
  for (let i = 0; i <= last; i++) {
    const b = boxes[i];
    if (b.kind === "empty") {
      if (notes.length) notes[notes.length - 1].beats += 1; else notes.push({ pitch: 0, beats: 1, box: i, part: 0 });
      continue;
    }
    const k = b.parts.length, d = 1 / k;
    b.parts.forEach((p, j) => notes.push({ pitch: p.label === "〇" ? 0 : (KKS[p.label] || 0), beats: d, box: i, part: j }));
  }
  return notes;
}

root.KKS_ENGINE = { SHEET, LABELS, CELL, MARGIN, INK_MIN, boxOrigin, toGray, downscale, findMarkers, homography, project,
  sampleCell, inner, inkMask, normalize, loadNet, classify, readCell, readSheet, toNotes, KKS };
})(typeof window !== "undefined" ? window : globalThis);
