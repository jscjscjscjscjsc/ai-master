"""Verify that the public AI Master frontend export runs without a backend.

The check uses only the Python standard library. It serves ``frontend`` from a
temporary local port, then verifies the routes and assets that make up the
public learning experience. Run it after rebuilding the export or before
pushing a release.
"""
from __future__ import annotations

import json
import posixpath
from html.parser import HTMLParser
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"

PAGES = [
    "/",
    "/dashboard/",
    "/knowledge-stars/",
    "/canvas/",
    "/playground/",
    "/learning-center/",
    *[f"/chapter/{chapter_id}/" for chapter_id in range(1, 11)],
    "/static/llm_intro.html",
    "/static/transformer_cg.html",
    "/static/prompt_cg_starlab/index.html",
    "/static/agentic_cg/index.html",
    "/static/claude_cg/index.html",
    "/static/rag_cg/index.html",
    "/static/rag_starlab/index.html",
    "/static/ai_odyssey.html",
    "/static/interview.html",
    "/static/transformer_lab.html",
    "/static/bpe_game.html",
    "/static/llm_training_game.html",
]

ASSETS = [
    "/assets/frontend.css",
    "/assets/frontend.js",
    "/data/knowledge-universe.json",
    "/static/vendor/three.r128.min.js",
    "/static/js/knowledge_stars.js",
    "/static/css/knowledge_stars.css",
    "/static/bgm.mp3",
]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        pass


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if name in {"href", "src"} and value:
                self.links.append(value)


def verify_internal_links() -> int:
    checked = 0
    for page in FRONTEND.rglob("*.html"):
        parser = LinkParser()
        parser.feed(page.read_text(encoding="utf-8"))
        source = "/" + page.relative_to(FRONTEND).as_posix()
        for raw in parser.links:
            target = urlsplit(raw)
            if target.scheme or target.netloc or raw.startswith(("#", "data:", "javascript:", "/api/")):
                continue
            has_directory_suffix = target.path.endswith("/")
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(source), target.path))
            if resolved == "/":
                candidate = FRONTEND / "index.html"
            else:
                candidate = FRONTEND / resolved.lstrip("/")
                if has_directory_suffix or candidate.is_dir():
                    candidate = candidate / "index.html"
            if not candidate.is_file():
                raise RuntimeError(f"broken internal link: {source} -> {raw} ({candidate})")
            checked += 1
    return checked


def request_ok(base_url: str, route: str) -> None:
    request = Request(f"{base_url}{route}", method="HEAD")
    with urlopen(request, timeout=5) as response:  # nosec B310 - localhost only
        if response.status != 200:
            raise RuntimeError(f"{route} returned HTTP {response.status}")


def main() -> None:
    if not (FRONTEND / "dashboard" / "index.html").is_file():
        raise SystemExit("frontend export is missing; run scripts/build_frontend_demo.py first")

    handler = partial(QuietHandler, directory=str(FRONTEND))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"

    try:
        for route in PAGES + ASSETS:
            request_ok(base_url, route)
        link_count = verify_internal_links()

        universe = json.loads((FRONTEND / "data" / "knowledge-universe.json").read_text(encoding="utf-8"))
        summary = universe.get("summary", {})
        if summary.get("galaxies") != 10 or summary.get("stars") != 57:
            raise RuntimeError(f"unexpected knowledge universe summary: {summary}")
    finally:
        server.shutdown()
        server.server_close()

    print(f"Frontend verification passed: {len(PAGES)} pages, {len(ASSETS)} assets, {link_count} internal links, 10 galaxies, 57 knowledge nodes.")


if __name__ == "__main__":
    main()
