import json, sys, difflib, importlib.util
sys.stdout.reconfigure(encoding="utf-8")
spec = importlib.util.spec_from_file_location("sqb", "tools/sync_question_bank.py")
sqb = importlib.util.module_from_spec(spec); spec.loader.exec_module(sqb)
bank = json.load(open("data/question_bank.json", encoding="utf-8"))
qs = bank["questions"] if isinstance(bank, dict) else bank
old = {q["id"]: q for q in qs}
newd, order = sqb.collect()
for key in ("q01-01-06","q01-01-07"):
    for f in ("starter_code","solution"):
        a = old[key].get(f) or ""
        b = newd[key].get(f) or ""
        if a == b:
            print(key, f, "EQUAL"); continue
        print("="*12, key, f)
        for line in difflib.unified_diff(a.splitlines(), b.splitlines(), lineterm="", n=1):
            print(line)
