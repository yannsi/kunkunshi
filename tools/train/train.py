import numpy as np, jax, jax.numpy as jnp, optax, json, base64, sys
from functools import partial
LABELS = list("合乙老四上中尺工五六七八九") + ["〇", "空", "二"]
NC = len(LABELS)
def init(key):
    ks = jax.random.split(key, 5)
    def conv(k, i, o): return {"w": jax.random.normal(k, (3, 3, i, o)) * np.sqrt(2 / (9 * i)), "b": jnp.zeros(o)}
    def dense(k, i, o): return {"w": jax.random.normal(k, (i, o)) * np.sqrt(2 / i), "b": jnp.zeros(o)}
    return {"c1": conv(ks[0], 1, 16), "c2": conv(ks[1], 16, 32), "c3": conv(ks[2], 32, 64),
            "d1": dense(ks[3], 4 * 4 * 64, 64), "d2": dense(ks[4], 64, NC)}
def c(x, p): return jax.lax.conv_general_dilated(x, p["w"], (1, 1), "SAME", dimension_numbers=("NHWC", "HWIO", "NHWC")) + p["b"]
def pool(x): return jax.lax.reduce_window(x, -jnp.inf, jax.lax.max, (1, 2, 2, 1), (1, 2, 2, 1), "VALID")
def forward(P, x, drop_key=None):
    x = pool(jax.nn.relu(c(x, P["c1"])))
    x = pool(jax.nn.relu(c(x, P["c2"])))
    x = pool(jax.nn.relu(c(x, P["c3"])))
    x = x.reshape(x.shape[0], -1)
    x = jax.nn.relu(x @ P["d1"]["w"] + P["d1"]["b"])
    if drop_key is not None:
        keep = jax.random.bernoulli(drop_key, 0.7, x.shape); x = jnp.where(keep, x / 0.7, 0)
    return x @ P["d2"]["w"] + P["d2"]["b"]
def loss(P, x, y, k):
    lg = forward(P, x, k)
    return optax.softmax_cross_entropy_with_integer_labels(lg, y).mean()
def shift(x, rng):
    out = np.zeros_like(x)
    for i in range(len(x)):
        dx, dy = rng.integers(-2, 3, 2)
        out[i] = np.roll(np.roll(x[i], dy, 0), dx, 1)
    return out
if __name__ == "__main__":
    tr, va = np.load("train.npz"), np.load("val.npz")
    Xt, yt = tr["X"].astype(np.float32)[..., None] / 255, tr["y"]
    Xv, yv = va["X"].astype(np.float32)[..., None] / 255, va["y"]
    P = init(jax.random.PRNGKey(0))
    epochs = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    steps = epochs * (len(Xt) // 128)
    opt = optax.adam(optax.cosine_decay_schedule(2e-3, steps)); st = opt.init(P)
    @jax.jit
    def step(P, st, x, y, k):
        l, g = jax.value_and_grad(loss)(P, x, y, k); u, st = opt.update(g, st); return optax.apply_updates(P, u), st, l
    pred = jax.jit(lambda P, x: jnp.argmax(forward(P, x), -1))
    rng = np.random.default_rng(0); key = jax.random.PRNGKey(1)
    for ep in range(epochs):
        idx = rng.permutation(len(Xt)); ls = []
        for b in range(0, len(idx) - 127, 128):
            j = idx[b:b + 128]; key, k = jax.random.split(key)
            P, st, l = step(P, st, jnp.array(shift(Xt[j], rng)), jnp.array(yt[j]), k); ls.append(float(l))
        pv = np.concatenate([np.array(pred(P, jnp.array(Xv[i:i + 512]))) for i in range(0, len(Xv), 512)])
        print(f"epoch {ep+1} loss {np.mean(ls):.4f} val_acc {(pv == yv).mean():.4f}", flush=True)
    cm = np.zeros((NC, NC), int)
    for a, b in zip(yv, pv): cm[a, b] += 1
    for i in range(NC):
        errs = [(LABELS[j], cm[i, j]) for j in range(NC) if j != i and cm[i, j]]
        print(LABELS[i], f"{cm[i,i]/cm[i].sum():.3f}", errs)
    np.save("params.npy", jax.tree_util.tree_map(np.asarray, P), allow_pickle=True)
