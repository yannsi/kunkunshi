import sys, cv2, numpy as np, struct
for f in sys.argv[1:]:
    im = cv2.cvtColor(cv2.imread(f), cv2.COLOR_BGR2RGBA); h, w = im.shape[:2]
    open(f.replace(".jpg", ".rgba"), "wb").write(struct.pack("<II", w, h) + im.tobytes())
