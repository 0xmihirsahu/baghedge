# landing

Everything for the marketing site at https://baghedge.xyz. The site itself is in [`web/`](web/); start there.

## What's here

| Path | What it is |
| --- | --- |
| [`web/`](web/) | The Next.js site: pages, share images, `robots.txt`, `sitemap.xml`, `llms.txt`. See [`web/README.md`](web/README.md). |
| [`docs/`](docs/) | The landing brief and style guide written before the build. Early drafts: they use the old working name and a waitlist that the live site replaced with the app link. |
| [`assets/`](assets/) | Source art (PNG) for the halftone pieces. Web-ready versions are in `web/public/art/`. |
| [`tools/`](tools/) | `og.html` and `x-header.html` (share card and X header layouts), and Playwright scripts (`shoot`, `frames`, `flow`, `scenes`) that screenshot a running site at `localhost:3300`. The scripts import Playwright from a local path, so edit that import before running them. |
| [`refs/`](refs/) | The reference-site screenshot script and the extracted type and colour data used for the style guide. |

Screenshots go to `out/`, which is gitignored.

## How it connects

The site links to the app in [`../terminal/`](../terminal/) and does not call the backend in [`../server/`](../server/). Copy follows [`../docs/BAGHEDGE_CONTEXT.md`](../docs/BAGHEDGE_CONTEXT.md) and [`../AGENTS.md`](../AGENTS.md) rule 15.

## Run

```sh
cd landing/web && bun install && bun run dev -- -p 3300
node landing/tools/shoot.mjs http://localhost:3300/ landing/out/shots   # after fixing the Playwright import
```
