# AI Master Frontend Reproduction

This repository contains the frontend-reproducible edition of AI Master. It is designed for people who clone the source and want to inspect or run the interactive learning experience locally without receiving any user records, license databases, credentials, API keys, or backend services.

## What is included

- The stellar dashboard and the complete 10-sector learning route.
- A local 3D knowledge universe with 10 galaxies and 57 knowledge nodes.
- Static chapter pages generated from the public course content.
- The original advanced interactive pages: Transformer, Prompt, Agent, RAG, Claude Code, private RAG lab, and AI Odyssey.
- A browser-only version of the learning coach. Its route and Feynman feedback are stored in `localStorage` for demo purposes.
- Local Three.js and visual assets. No CDN is required for the core stellar pages.

## What is intentionally excluded

- User accounts, passwords, learning history, notes, favorites, wrong-answer records, and authorization databases.
- Flask backend, admin portal, Cloudflare configuration, session secrets, logs, API keys, and AI provider credentials.
- Real AI generation, remote authorization, persistent multi-user progress, and server-side quota enforcement.

## Run locally

Do not open the files with `file://`. The knowledge universe loads a local JSON data file and needs a small static web server.

### Windows

Double-click `frontend\start-demo.bat`, then open:

```text
http://127.0.0.1:8080/dashboard/
```

### Any platform with Python 3

```bash
cd frontend
python -m http.server 8080
```

Then open `http://127.0.0.1:8080/dashboard/`.

## Verify the export

After cloning, or after changing a public page, run this from the repository
root:

```bash
python scripts/verify_frontend_demo.py
```

The verifier starts a temporary local server and checks the dashboard, 3D
knowledge universe, all ten chapter routes, the CG/interactive pages, their
core assets, and the expected 10-galaxy / 57-node knowledge map. A passing
result confirms that the public frontend does not need the private Flask
backend to navigate normally.

## Static route map

| Route | Experience |
| --- | --- |
| `/dashboard/` | AI Master command deck and chapter route |
| `/knowledge-stars/` | 3D knowledge galaxy map |
| `/chapter/1/` to `/chapter/10/` | Static chapter reading pages |
| `/static/ai_odyssey.html` | Immersive 3D learning route |
| `/static/interview.html` | Browser-only learning coach demo |
| `/static/transformer_cg.html` | Transformer cinematic page |
| `/static/prompt_cg_starlab/index.html` | Prompt cinematic page |
| `/static/agentic_cg/index.html` | Agent cinematic page |
| `/static/rag_cg/index.html` | RAG cinematic page |

## Updating the frontend export

1. Copy approved public frontend assets into `frontend/static/` and public course JSON into `frontend/data/`.
2. Run `python scripts/build_frontend_demo.py` from the repository root.
3. Run `python scripts/verify_frontend_demo.py`, then start the static server for visual checking.
4. Verify `git status` before committing. Do not add local runtime data or credentials.

## Development notes

The original full product is a private Flask deployment. This repository is intentionally a frontend-first reproduction, not a deployable copy of the production authorization system. The static source has no hidden account bypass and contains no production user data.
