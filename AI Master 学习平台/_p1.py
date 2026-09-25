import json, re, sys, io
sys.stdout.reconfigure(encoding="utf-8")
bank = json.load(open("data/question_bank.json", encoding="utf-8"))
qs = bank["questions"] if isinstance(bank, dict) else bank
d = {q["id"]: q for q in qs}
for i in ("q01-01-06","q01-01-07"):
    q = d[i]
    print("="*20, i)
    print("starter:", repr(q.get("starter_code"))[:400])
    print("answer:", repr(q.get("answer")), type(q.get("answer")))
print("="*20, "q07-02-08")
q = d["q07-02-08"]
print("answer:", repr(q.get("answer")))
print("options:", json.dumps(q.get("options"), ensure_ascii=False)[:300])
# answer type stats
from collections import Counter
c = Counter(type(q.get("answer")).__name__ for q in qs)
print("answer types:", c)
print("sample dict keys:", json.dumps(list(d["q01-01-06"].keys()), ensure_ascii=False))
