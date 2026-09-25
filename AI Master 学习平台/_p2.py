import json, sys, difflib, importlib.util
sys.stdout.reconfigure(encoding="utf-8")
spec = importlib.util.spec_from_file_location("sqb", "tools/sync_question_bank.py")
sqb = importlib.util.module_from_spec(spec); spec.loader.exec_module(sqb)
tb = sqb.parse_textbook() if hasattr(sqb, "parse_textbook") else None
print("funcs:", [n for n in dir(sqb) if not n.startswith("_")][:40])
