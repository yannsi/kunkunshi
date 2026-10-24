"""src/ と model.json から、公開用の index.html・youshi.html・sw.js を組み立てる"""
import os, json, hashlib, re
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(R, p), encoding="utf-8").read()
engine, sheet = rd("src/engine.js"), rd("src/sheet.js")
model = "window.KKS_MODEL=" + rd("model/model.json") + ";"
app = rd("src/app.html").replace("/*ENGINE*/", engine).replace("/*MODEL*/", model)
you = rd("src/youshi.html").replace("/*ENGINE*/", engine).replace("/*SHEETJS*/", sheet)
open(os.path.join(R, "index.html"), "w", encoding="utf-8").write(app)
open(os.path.join(R, "youshi.html"), "w", encoding="utf-8").write(you)
files = ["./", "index.html", "youshi.html", "youshi.pdf", "sample.jpg", "manifest.webmanifest",
         "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"]
h = hashlib.sha1()
for f in files[1:]:
    p = os.path.join(R, f)
    if os.path.exists(p): h.update(open(p, "rb").read())
ver = h.hexdigest()[:10]
sw = rd("src/sw.js").replace("__VERSION__", ver).replace("__FILES__", json.dumps(files))
open(os.path.join(R, "sw.js"), "w", encoding="utf-8").write(sw)
print("組み立てました 版", ver, "index.html", os.path.getsize(os.path.join(R, "index.html")) // 1024, "KB")
