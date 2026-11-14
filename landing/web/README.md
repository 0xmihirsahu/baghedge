# landing/web

The marketing site at https://baghedge.xyz. It explains Baghedge and links to the app at https://app.baghedge.xyz. It has no backend and no sign-in. The only live data is Hyperliquid prices, read in the browser for the charts.

Next.js 16 (App Router, Turbopack), React 19, Tailwind 4, `motion`, `lenis`, `lightweight-charts`.

## Where things live

| Path | What it is |
| --- | --- |
| [`app/page.tsx`](app/page.tsx) | Home: `Hero` then `Story` (pinned cards), then `Footer`. |
| [`app/vision/`](app/vision/), [`app/about/`](app/about/), [`app/brand/`](app/brand/) | Vision (film and the idea), about the team, brand kit (logos, colours, type, art, motion components). |
| [`app/terms/`](app/terms/), [`app/privacy/`](app/privacy/), [`app/disclaimer/`](app/disclaimer/) | Legal pages, rendered by [`components/legal.tsx`](components/legal.tsx). |
| [`app/not-found.tsx`](app/not-found.tsx) | The 404 page. |
| [`app/layout.tsx`](app/layout.tsx) | Root metadata (title, description, Open Graph, Twitter card), the Figtree font, smooth scroll, the markets provider. |
| [`app/opengraph-image.png`](app/opengraph-image.png), [`app/twitter-image.png`](app/twitter-image.png) | Static 1200x630 share images, picked up by Next's file convention. Alt text is in the matching `.alt.txt`. The card layout is [`../tools/og.html`](../tools/og.html). |
| [`app/icon.png`](app/icon.png), [`app/apple-icon.png`](app/apple-icon.png), [`app/favicon.ico`](app/favicon.ico) | Icons. |
| [`app/robots.ts`](app/robots.ts) | `/robots.txt`: every crawler allowed, AI crawlers named explicitly, points at the sitemap. |
| [`app/sitemap.ts`](app/sitemap.ts) | `/sitemap.xml`: home, vision, about, brand, terms, privacy, disclaimer, llms.txt. |
| [`public/llms.txt`](public/llms.txt) | `/llms.txt`: a plain text summary of the product, links, and how it works, for AI readers. |
| [`lib/site.ts`](lib/site.ts) | `APP_URL`, `SITE_URL`, `X_URL`, each overridable with a `NEXT_PUBLIC_*` env var. |
| [`lib/markets.tsx`](lib/markets.tsx) | Reads Hyperliquid `/info` from the browser for live prices on the page. |
| [`components/`](components/) | Page sections: hero, story, reel, diagram, architecture, chart, launch, vision, about, brand, legal, header, footer, and the halftone dot field. |
| [`components/motion/`](components/motion/) | Four small React motion components made for the app, shown on `/brand`; see its README. |
| [`public/`](public/) | Art (`art/`), brand files and the downloadable kit (`brand/`), partner logos (`brands/`), token icons (`tokens/`), video and stills (`media/`). |

## How it connects

- Product wording follows [`../../docs/BAGHEDGE_CONTEXT.md`](../../docs/BAGHEDGE_CONTEXT.md) and the copy rules in [`../../AGENTS.md`](../../AGENTS.md) (rule 15).
- "Launch app" goes to the terminal in [`../../terminal/`](../../terminal/). The site does not call the Baghedge backend.
- [`AGENTS.md`](AGENTS.md) here is the Next.js notice that `next dev` writes.

## Run

```sh
cd landing/web
bun install
bun run dev              # http://localhost:3000
bun run dev -- -p 3300   # the port the screenshot tools in ../tools expect
bun run build            # production build
bun run lint
```

Check `/robots.txt`, `/sitemap.xml` and `/llms.txt` on the running site.
