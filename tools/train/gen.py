import numpy as np, sys
from multiprocessing import Pool
sys.path.insert(0, "/home/claude/kks-train")
from kks_data import *
LABELS = CHARS + ["空", "二"]
def work(args):
    cls, n, seed = args
    rng = np.random.default_rng(seed); X = []
    while len(X) < n:
        if cls == len(CHARS): img = synth_empty(rng)
        elif cls == len(CHARS) + 1:
            a, b = rng.choice(len(CHARS), 2); img = synth_cell(None, rng, pair=(CHARS[a], CHARS[b]))
        else: img = synth_cell(CHARS[cls], rng)
        m = ink_mask(inner(img))
        if m.sum() < INK_MIN: continue
        X.append((normalize_fast(m) * 255).astype(np.uint8))
    return cls, np.stack(X)
if __name__ == "__main__":
    n, seed0, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    jobs = [(c, n // 4, seed0 * 1000 + c * 10 + k) for c in range(len(LABELS)) for k in range(4)]
    with Pool(2) as p: res = p.map(work, jobs)
    X = np.concatenate([r[1] for r in res]); y = np.concatenate([np.full(len(r[1]), r[0]) for r in res])
    np.savez_compressed(out, X=X, y=y); print(out, X.shape)
