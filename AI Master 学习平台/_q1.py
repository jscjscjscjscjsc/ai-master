import re, sys
sys.stdout.reconfigure(encoding="utf-8")
t = open("static/js/qcards.js", encoding="utf-8").read()
i = t.find("revealModel")
print(t[max(0,i-200):i+2600])
