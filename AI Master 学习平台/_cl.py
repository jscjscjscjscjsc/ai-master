import json, sys
sys.stdout.reconfigure(encoding="utf-8")
qs = json.load(open("data/question_bank.json", encoding="utf-8"))
for q in qs:
    if q.get("type") != "code": continue
    print(f"{q['id']} ch{q['chapter_id']} d{q.get('day','')} [{q['title']}]")
