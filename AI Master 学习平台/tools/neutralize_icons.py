"""Use restrained chapter numbers in both source and static course catalogs."""
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT / 'data/courses.json', ROOT.parent / 'frontend/data/courses.json'):
    content = path.read_text(encoding='utf-8')
    chapters = json.loads(content)
    for chapter in chapters:
        old = json.dumps(chapter['icon'], ensure_ascii=False)
        new = json.dumps(f"{chapter['id']:02d}")
        for sep in (': ', ':'):
            content = content.replace('"icon"' + sep + old, '"icon"' + sep + new, 1)
    path.write_text(content, encoding='utf-8')
