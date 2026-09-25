import json, sys
from collections import OrderedDict
sys.stdout.reconfigure(encoding="utf-8")
qs = json.load(open("data/question_bank.json", encoding="utf-8"))
g = OrderedDict()
for q in qs:
    k = (q["chapter_id"], q.get("kp_index"), q.get("kp_title"))
    g.setdefault(k, [0, []])
    g[k][0] += 1
    g[k][1].append(q["id"])
for (c, i, t), (n, ids) in g.items():
    print(f"ch{c} kp{i} [{t}] {n} 题  {ids[0]}..{ids[-1]}")
