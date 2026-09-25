import json, sys, difflib, importlib.util
sys.stdout.reconfigure(encoding="utf-8")
spec = importlib.util.spec_from_file_location("sqb", "tools/sync_question_bank.py")
sqb = importlib.util.module_from_spec(spec); spec.loader.exec_module(sqb)
res = sqb.collect()
print("tuple len", len(res))
a, b = res
print("a type", type(a), len(a) if hasattr(a,"__len__") else a)
print("b type", type(b), len(b) if hasattr(b,"__len__") else b)
