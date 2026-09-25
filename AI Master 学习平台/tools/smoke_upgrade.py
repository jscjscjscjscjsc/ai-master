"""Bounded local checks for the learning-memory and temporary-note upgrade."""
import os
import sys
import tempfile
from html.parser import HTMLParser


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.targets = set()

    def handle_starttag(self, tag, attrs):
        if tag != 'a':
            return
        href = dict(attrs).get('href') or ''
        if href.startswith('/') and not href.startswith('//'):
            self.targets.add(href.split('#', 1)[0])


with tempfile.TemporaryDirectory(prefix='aimaster-upgrade-') as temporary:
    os.environ['STARLAB_DATA_DIR'] = temporary
    os.environ['STARLAB_SECRET_KEY'] = 'test-only-secret'
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    import app as project

    project.ai_configured = lambda: True
    project.ark.events = lambda *args, **kwargs: iter([
        {'type': 'delta', 'text': '这段内容的关键是输入与输出。'}])
    client = project.app.test_client()
    with client.session_transaction() as session:
        session['username'] = 'upgrade-smoke'

    pages = ['/', '/login', '/chapter/1', '/training', '/progress', '/agent',
             '/roadmap', '/coach', '/constellation', '/stars', '/intro']
    targets = set()
    for path in pages:
        response = client.get(path, headers={'Accept': 'text/html'})
        assert response.status_code == 200, (path, response.status_code)
        parser = Links()
        parser.feed(response.get_data(as_text=True))
        targets.update(parser.targets)
    failed = []
    for target in sorted(targets):
        if target.startswith('/logout'):
            continue
        response = client.get(target, headers={'Accept': 'text/html'})
        if response.status_code >= 400:
            failed.append((target, response.status_code))
    assert not failed, failed

    chapter = project.lab.courses()[0]
    kp = chapter['knowledge_points'][0]
    complete = client.post('/api/complete-kp', json={'chapter_id': chapter['id'],
                                                     'kp_index': kp['index']})
    assert complete.json['success'], complete.json
    question = next(item for item in project.lab.load_bank()
                    if item.get('type') == 'choice' and item.get('kp_index') is not None)
    result = client.post('/api/training/submit', json={
        'question_id': question['id'], 'answer': question.get('answer') or 0})
    assert result.json['success'], result.json
    graph = client.get('/api/learning-graph').json
    assert graph['success'] and len(graph['nodes']) >= 40
    assert any(node['evidence'] for node in graph['nodes'])
    stream = client.post('/api/selection/explain', json={
        'selection': 'print(1 + 1)', 'chapter_id': chapter['id'],
        'kp_index': kp['index']})
    assert stream.status_code == 200
    assert '这段内容的关键' in stream.get_data(as_text=True)
    bad = client.post('/api/selection/explain', json={
        'selection': 'x', 'chapter_id': chapter['id'], 'kp_index': kp['index']})
    assert bad.status_code == 400
    graph2 = client.get('/api/learning-graph').json
    target = next(node for node in graph2['nodes'] if node['id'] == f"{chapter['id']}_{kp['index']}")
    assert target['evidence'] >= 2, target
    print(f"PASS: {len(pages)} pages, {len(targets)} internal links, selection SSE, mastery graph, quiz write")
