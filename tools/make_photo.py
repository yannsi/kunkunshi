"""確認用：手書き風の字を入れた用紙を描き、斜め・明るさむら・ぼけのある「写真」にする
使い方: python3 tools/make_photo.py 出力.jpg 種(seed) [曲]"""
import sys, json, subprocess, os, math, numpy as np, cv2
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
GF = "/home/claude/data/gfonts/ofl/"
HANDS = [GF + "kleeone/KleeOne-SemiBold.ttf", GF + "yomogi/Yomogi-Regular.ttf", GF + "zenkurenaido/ZenKurenaido-Regular.ttf",
         GF + "hachimarupop/HachiMaruPop-Regular.ttf", GF + "yuseimagic/YuseiMagic-Regular.ttf"]
SONGS = {
  "kirakira": "工 工 八 八 九 九 八 _ 七 七 六 六 五 五 工 _ 八 八 七 七 六 六 五 _ 八 八 七 七 六 六 五 _ 工 工 八 八 九 九 八 _ 七 七 六 六 五 五 工 _",
  "mix2": "工/工 八 _ 〇 九/八 七/六 五 _ 合/乙 老/四 上 _ 中/尺 工 〇 _ 六/五 工 尺/中 上",
  "mix": "合 乙 老 四 上 中 尺 工 五 六 七 八 九 〇 工/五 _ 上/中 〇 合 _",
}
def render_sheet(boxes, rng, out_png, title=None):
    node = f"""
require('{ROOT}/src/engine.js'); require('{ROOT}/src/sheet.js');
const E=globalThis.KKS_ENGINE, S=E.SHEET; const boxes={json.dumps(boxes)}; const fill=[];
const P={json.dumps([[float(v) for v in rng.normal(0,1,6)] for _ in range(200)])};
boxes.forEach((b,i)=>{{ if(b==='_') return; const c=Math.floor(i/S.rows), r=i%S.rows; const [x,y]=E.boxOrigin(c,r); const p=P[i];
  const parts=b.split('/');
  parts.forEach((ch,j)=>{{ const k=parts.length; const size=(k===1?S.box*(0.66+0.08*p[0]):S.box*(0.40+0.04*p[0]));
    const cx=x+S.box/2+p[1]*1.0, cy=y+(k===1?S.box/2:S.box*(j?0.73:0.27))+p[2]*0.8+size*0.36;
    fill.push(`<text x="${{cx}}" y="${{cy}}" font-size="${{size}}" text-anchor="middle" font-family="H${{Math.abs(Math.round(p[3]*7))%5}}" fill="#1b2340" transform="rotate(${{p[4]*3}} ${{cx}} ${{cy-size*0.36}})">${{ch}}</text>`); }}); }});
process.stdout.write(globalThis.KKS_SHEET.sheetSVG({{fill, title:{json.dumps(title)}}}));"""
    svg = subprocess.run(["node", "-e", node], capture_output=True, text=True, check=True).stdout
    faces = "".join(f"@font-face{{font-family:H{i};src:url('file://{f}')}}" for i, f in enumerate(HANDS))
    html = f"<!doctype html><html><head><meta charset='utf-8'><style>{faces} body{{margin:0}}</style></head><body>{svg}</body></html>"
    tmp = out_png + ".html"; open(tmp, "w").write(html)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={"width": 794, "height": 1123}, device_scale_factor=2.4)
        pg.goto("file://" + tmp); pg.wait_for_timeout(500)
        pg.locator("svg").screenshot(path=out_png); b.close()
    os.remove(tmp)
def photo(png, out, rng, tilt=0.12, rot=0.0, W=3000, Hh=4000, dark=1.0, blur=1.0):
    s = cv2.imread(png).astype(np.float32) / 255; h, w = s.shape[:2]
    bg = np.ones((Hh, W, 3), np.float32) * np.array([0.35, 0.42, 0.5]) * rng.uniform(0.7, 1.1)
    bg += cv2.GaussianBlur(rng.normal(0, 0.06, (Hh, W, 1)).astype(np.float32), (0, 0), 25)[..., None] if False else 0
    ca0, sa0 = abs(math.cos(rot)), abs(math.sin(rot)); bw0, bh0 = w * ca0 + h * sa0, w * sa0 + h * ca0
    sc = rng.uniform(0.74, 0.86) * min(W / bw0, Hh / bh0)
    cx, cy = W / 2 + rng.normal(0, 60), Hh / 2 + rng.normal(0, 60)
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    base = np.float32([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) * sc
    ca, sa = math.cos(rot), math.sin(rot); base = base @ np.float32([[ca, sa], [-sa, ca]])
    jitter = rng.normal(0, tilt, (4, 2)) * np.float32([w * sc, h * sc]) * 0.25
    dst = (base + jitter + np.float32([cx, cy])).astype(np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(s, M, (W, Hh), flags=cv2.INTER_LINEAR, borderValue=(-1, -1, -1))
    mask = warped[..., :1] >= 0
    img = np.where(mask, warped, bg)
    yy, xx = np.mgrid[0:Hh, 0:W] / max(W, Hh)
    a = rng.uniform(0, 2 * math.pi)
    light = (0.92 + 0.15 * (np.cos(a) * xx + np.sin(a) * yy - 0.5)) * dark
    vign = 1 - 0.25 * ((xx - 0.375) ** 2 + (yy - 0.5) ** 2) * 2
    img = img * (light * vign)[..., None] * np.float32([1.0, 0.98, 0.93])
    img = cv2.GaussianBlur(img, (0, 0), blur * 1.6)
    img = img + rng.normal(0, 0.015, img.shape).astype(np.float32)
    cv2.imwrite(out, np.clip(img * 255, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 85])
if __name__ == "__main__":
    out, seed = sys.argv[1], int(sys.argv[2]); song = sys.argv[3] if len(sys.argv) > 3 else "kirakira"
    rng = np.random.default_rng(seed); boxes = SONGS[song].split()
    png = out + ".sheet.png"; render_sheet(boxes, rng, png, "きらきら星" if song == "kirakira" else None)
    photo(png, out, rng, tilt=float(os.environ.get("TILT", 0.12)), rot=float(os.environ.get("ROT", 0)),
          dark=float(os.environ.get("DARK", 1.0)), blur=float(os.environ.get("BLUR", 1.0)))
    json.dump(boxes, open(out + ".truth.json", "w"), ensure_ascii=False)
    print(out)
