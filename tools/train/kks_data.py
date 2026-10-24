"""工工四の手書き風の字を合成し、アプリと同じ手順で 32x32 に正規化する"""
import numpy as np, re, glob, math
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from svgpathtools import parse_path

CHARS = list("合乙老四上中尺工五六七八九") + ["〇"]
CODE = {c: f"{ord(c):05x}" for c in CHARS}
KVG = "/home/claude/data/kanjivg/kanji/"
FONTS = sorted(glob.glob("/home/claude/data/gfonts/ofl/*/*.ttf")) + [
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf"]
FONTS = [f for f in FONTS if "Thin" not in f]

def load_strokes(ch):
    if ch == "〇": return None
    s = open(KVG + CODE[ch] + ".svg", encoding="utf-8").read()
    out = []
    for d in re.findall(r'<path[^>]* d="(M[^"]+)"', s):
        p = parse_path(d); n = max(8, int(p.length() / 2))
        out.append(np.array([[p.point(t).real, p.point(t).imag] for t in np.linspace(0, 1, n)]))
    return out
STROKES = {c: load_strokes(c) for c in CHARS}

def smooth_noise(n, amp, rng):
    k = rng.normal(0, 1, (n + 8, 2)); k = ndimage.gaussian_filter1d(k, 3, axis=0)[4:-4]
    return k / (k.std() + 1e-6) * amp

def draw_kanjivg(ch, rng, S):
    """筆順データの各画をゆらして描く（0..109座標 → S）"""
    im = Image.new("L", (S, S), 0); d = ImageDraw.Draw(im)
    A = rng.normal(0, 0.08, (2, 2)) + np.eye(2); A[0, 0] *= rng.uniform(0.75, 1.15)
    w = rng.uniform(0.025, 0.07) * S
    for st in STROKES[ch]:
        p = st.copy()
        # 画の始めと終わりを少し伸び縮み
        if rng.random() < 0.5 and len(p) > 4:
            a, b = int(rng.integers(0, 2)), len(p) - int(rng.integers(0, 3))
            p = p[a:b]
        p = p + smooth_noise(len(p), rng.uniform(0.3, 2.2), rng) + rng.normal(0, 1.8, 2)
        p = (p - 54.5) @ A.T + 54.5
        p = p / 109 * S
        ww = max(1, int(round(w * rng.uniform(0.8, 1.2))))
        d.line([tuple(q) for q in p], fill=255, width=ww, joint="curve")
        for q in (p[0], p[-1]):
            r = ww / 2; d.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill=255)
    return np.asarray(im, np.float32) / 255

def draw_font(ch, rng, S):
    f = FONTS[rng.integers(len(FONTS))]
    try: font = ImageFont.truetype(f, int(S * 0.8))
    except Exception: font = ImageFont.truetype(FONTS[0], int(S * 0.8))
    im = Image.new("L", (S, S), 0); d = ImageDraw.Draw(im)
    sw = int(rng.integers(0, max(1, S // 40)))
    d.text((S / 2, S / 2), ch, font=font, fill=255, anchor="mm", stroke_width=sw, stroke_fill=255)
    a = np.asarray(im, np.float32) / 255
    if a.sum() < 5: return draw_kanjivg(ch, rng, S) if ch != "〇" else draw_circle(rng, S)
    return a

def draw_circle(rng, S):
    im = Image.new("L", (S, S), 0); d = ImageDraw.Draw(im)
    rx, ry = S * rng.uniform(0.25, 0.42), S * rng.uniform(0.25, 0.42)
    t0 = rng.uniform(0, 2 * math.pi); span = 2 * math.pi * rng.uniform(0.85, 1.12)
    t = np.linspace(t0, t0 + span, 80)
    wob = 1 + smooth_noise(80, 0.05, rng)[:, 0]
    p = np.stack([S / 2 + rx * wob * np.cos(t), S / 2 + ry * wob * np.sin(t)], 1)
    d.line([tuple(q) for q in p], fill=255, width=max(1, int(S * rng.uniform(0.025, 0.07))), joint="curve")
    return np.asarray(im, np.float32) / 255

def elastic(a, rng, alpha, sigma):
    S = a.shape[0]
    dx = ndimage.gaussian_filter(rng.uniform(-1, 1, (S, S)), sigma) * alpha
    dy = ndimage.gaussian_filter(rng.uniform(-1, 1, (S, S)), sigma) * alpha
    y, x = np.mgrid[0:S, 0:S]
    return ndimage.map_coordinates(a, [y + dy, x + dx], order=1)

CELL = 96      # 写真を正面に直したときの1マス（px）
MARGIN = 5     # マスの線を避けるため内側を使う

def synth_glyph(ch, rng, S=128):
    r = rng.random()
    if ch == "〇": g = draw_circle(rng, S) if r < 0.75 else draw_font("○", rng, S)
    elif r < 0.6: g = draw_kanjivg(ch, rng, S)
    else: g = draw_font(ch, rng, S)
    if rng.random() < 0.7: g = elastic(g, rng, rng.uniform(4, 14), rng.uniform(5, 9))
    ang = rng.normal(0, 6); g = ndimage.rotate(g, ang, reshape=False, order=1)
    return np.clip(g, 0, 1)

def synth_cell(ch, rng, pos=None, pair=None):
    """1マス分の写真（明るさ 0..1、1=白）を作る。ch=None は空マス。pair=(上,下) は半拍2つ"""
    C = CELL - 2 * MARGIN
    paper = rng.uniform(0.6, 0.95)
    y, x = np.mgrid[0:CELL, 0:CELL] / CELL
    bg = paper + rng.uniform(-0.08, 0.08) * x + rng.uniform(-0.08, 0.08) * y
    img = np.full((CELL, CELL), 0.0) + bg
    # マスの線（灰色）
    lc = paper - rng.uniform(0.15, 0.4); lw = int(rng.integers(1, 4))
    off = rng.integers(-3, 4, 2)
    for k in (0 + off[0], CELL - 1 + off[0]):
        if 0 <= k < CELL: img[:, max(0, k - lw // 2):k + lw // 2 + 1] = lc
    for k in (0 + off[1], CELL - 1 + off[1]):
        if 0 <= k < CELL: img[max(0, k - lw // 2):k + lw // 2 + 1, :] = lc
    glyphs = []
    if pair is not None:
        sz = rng.uniform(0.32, 0.5); gap = rng.uniform(0.02, 0.12)
        dx = rng.normal(0, C * 0.05)
        glyphs.append((pair[0], (dx + rng.normal(0, 2), -(sz + gap) / 2 * C, sz * rng.uniform(0.9, 1.1))))
        glyphs.append((pair[1], (dx + rng.normal(0, 2), (sz + gap) / 2 * C, sz * rng.uniform(0.9, 1.1))))
    elif ch is not None:
        glyphs.append((ch, pos))
    ink = paper - rng.uniform(0.35, 0.75) * paper  # 黒ペン〜鉛筆
    for ch, pos in glyphs:
        g = synth_glyph(ch, rng)
        size = int(C * (rng.uniform(0.45, 1.0) if pos is None else pos[2]))
        gi = Image.fromarray((g * 255).astype(np.uint8)).resize((size, size), Image.BILINEAR)
        g = np.asarray(gi, np.float32) / 255
        cx = CELL / 2 + (rng.normal(0, C * 0.08) if pos is None else pos[0])
        cy = CELL / 2 + (rng.normal(0, C * 0.08) if pos is None else pos[1])
        x0, y0 = int(cx - size / 2), int(cy - size / 2)
        layer = np.zeros((CELL, CELL), np.float32)
        xs, ys = max(0, x0), max(0, y0); xe, ye = min(CELL, x0 + size), min(CELL, y0 + size)
        layer[ys:ye, xs:xe] = g[ys - y0:ye - y0, xs - x0:xe - x0]
        img = img * (1 - layer) + ink * layer
    if rng.random() < 0.15:  # 影
        a = rng.uniform(0, math.pi); m = (np.cos(a) * x + np.sin(a) * y) > rng.uniform(0.3, 1)
        m = ndimage.gaussian_filter(m.astype(np.float32), rng.uniform(4, 12))
        img = img * (1 - m * rng.uniform(0.1, 0.3))
    # 写真のぼけと粒
    img = ndimage.gaussian_filter(img, rng.uniform(0.3, 1.3))
    img = img + rng.normal(0, rng.uniform(0.005, 0.03), img.shape)
    return np.clip(img, 0, 1).astype(np.float32)

# ---------- ここから下はアプリ（JS）と同じ手順 ----------
def inner(img):
    return img[MARGIN:CELL - MARGIN, MARGIN:CELL - MARGIN]

def flatten(cell):
    """紙の明るさむら（影・照明）を割り算で消す：明るい所を広げてぼかしたものを紙の色とみなす"""
    bg = ndimage.maximum_filter(cell, size=15, mode="nearest")
    bg = ndimage.uniform_filter(bg, size=15, mode="nearest")
    return cell / np.maximum(bg, 1e-3)

def ink_mask(cell):
    n = flatten(cell)
    v = np.sort(n.ravel()); p01 = v[int(len(v) * 0.01)]
    thr = 1 - max(0.18, 0.5 * (1 - p01))
    m = n < thr
    lab, n = ndimage.label(m, structure=np.ones((3, 3)))
    H, W = m.shape; keep = np.zeros(n + 1, bool)
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        hh, ww = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        area = (lab[sl] == i).sum()
        edge = sl[0].start <= 2 or sl[1].start <= 2 or sl[0].stop >= H - 2 or sl[1].stop >= W - 2
        thin = min(hh, ww) <= 4 and max(hh, ww) >= 0.4 * H
        if area < 12: continue
        if edge and thin: continue   # マスの線の切れ端
        keep[i] = True
    return keep[lab]

def normalize(m, N=32, fit=24):
    """インクの外枠を、縦横比を保って fit px に収め、N x N の中央に置く（4x4点の平均）"""
    ys, xs = np.nonzero(m)
    if len(xs) == 0: return None
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    bw, bh = x1 - x0, y1 - y0
    s = fit / max(bw, bh)
    out = np.zeros((N, N), np.float32)
    ox, oy = (N - bw * s) / 2, (N - bh * s) / 2
    H, W = m.shape
    for j in range(N):
        for i in range(N):
            acc = 0
            for sj in range(4):
                for si in range(4):
                    sx = x0 + (i + (si + 0.5) / 4 - ox) / s
                    sy = y0 + (j + (sj + 0.5) / 4 - oy) / s
                    xi, yi = int(math.floor(sx)), int(math.floor(sy))
                    if x0 <= xi < x1 and y0 <= yi < y1 and m[yi, xi]: acc += 1
            out[j, i] = acc / 16
    return out

def normalize_fast(m, N=32, fit=24):
    """normalize と同じ結果をnumpyで速く"""
    ys, xs = np.nonzero(m)
    if len(xs) == 0: return None
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    bw, bh = x1 - x0, y1 - y0
    s = fit / max(bw, bh); ox, oy = (N - bw * s) / 2, (N - bh * s) / 2
    sub = (np.arange(N * 4) + 0.5) / 4
    sx = np.floor(x0 + (sub - ox) / s).astype(int); sy = np.floor(y0 + (sub - oy) / s).astype(int)
    vx = (sx >= x0) & (sx < x1); vy = (sy >= y0) & (sy < y1)
    g = m[np.clip(sy, 0, m.shape[0] - 1)][:, np.clip(sx, 0, m.shape[1] - 1)] & vy[:, None] & vx[None, :]
    return g.reshape(N, 4, N, 4).mean((1, 3)).astype(np.float32)

INK_MIN = 40   # これより少ないインクは空きマス

def synth_empty(rng):
    """空きマスなのにインクが出てしまう写真（粒・影・線の切れ端・小さな汚れ）"""
    for _ in range(50):
        img = synth_cell(None, rng)
        y, x = np.mgrid[0:CELL, 0:CELL] / CELL
        if rng.random() < 0.6:
            a = rng.uniform(0, math.pi); m = (np.cos(a) * x + np.sin(a) * y) > rng.uniform(0.2, 1)
            m = ndimage.gaussian_filter(m.astype(np.float32), rng.uniform(1.5, 6))
            img = img * (1 - m * rng.uniform(0.15, 0.4))
        if rng.random() < 0.5:
            img = img + rng.normal(0, rng.uniform(0.02, 0.06), img.shape)
        if rng.random() < 0.4:  # はみ出したマスの線
            k = int(rng.integers(MARGIN, MARGIN + 8)); lw = int(rng.integers(1, 4))
            if rng.random() < 0.5: k = CELL - 1 - k
            v = img.min() if rng.random() < 0.3 else img.mean() - 0.2
            if rng.random() < 0.5: img[:, k:k + lw] = v
            else: img[k:k + lw, :] = v
        for _ in range(int(rng.integers(0, 3))):  # 小さな汚れ
            cx, cy = rng.uniform(10, CELL - 10, 2); r = rng.uniform(0.8, 2.5)
            img[(x * CELL - cx) ** 2 + (y * CELL - cy) ** 2 < r * r] *= rng.uniform(0.3, 0.7)
        img = np.clip(img, 0, 1).astype(np.float32)
        m = ink_mask(inner(img))
        if m.sum() >= INK_MIN: return img
    return img
