import json, re, sys
sys.stdout.reconfigure(encoding="utf-8")
bank = json.load(open("data/question_bank.json", encoding="utf-8"))
qs = bank["questions"]
code = [q for q in qs if q.get("type") == "code"]
print("code 题", len(code), "有 expected_output:", sum(1 for q in code if q.get("expected_output")))
print("全库有 expected_output:", sum(1 for q in qs if q.get("expected_output")))
q = [x for x in qs if x["id"]=="q07-02-10"][0]
print("--- q07-02-10 expected_output ---")
print(q.get("expected_output"))
print("--- keys ---", list(q.keys()))
print("--- 例题 statement ---"); print(q["statement"][:500])
