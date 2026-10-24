import numpy as np, json, base64, sys
P = np.load("params.npy", allow_pickle=True).item()
out = {}
for k in ["c1", "c2", "c3", "d1", "d2"]:
    w = np.asarray(P[k]["w"], np.float32); scale = float(np.abs(w).max() / 127)
    q = np.clip(np.round(w / scale), -127, 127).astype(np.int8)
    out[k] = {"shape": list(w.shape), "scale": scale, "w": base64.b64encode(q.tobytes()).decode(),
              "b": [round(float(v), 6) for v in np.asarray(P[k]["b"])]}
json.dump(out, open(sys.argv[1], "w"), separators=(",", ":"))
print(sys.argv[1], sum(np.asarray(P[k]["w"]).size for k in out), "weights")
