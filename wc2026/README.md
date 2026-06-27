# World Cup 2026 — Knockout Bracket 🏆

An interactive, shareable FIFA World Cup 2026 knockout bracket. Tap a team to
advance it through every round; your picks are encoded in the URL so you can
share a fully-filled bracket with anyone. Scoring uses the conventional
exponentially-rising scheme.

**No backend, no tracking, no build step.** It's three static files — drop it on
any host.

![bracket](assets/preview.svg)

## Features

- **Click to advance** — pick a winner in any match and it flows into the next
  round automatically along FIFA's fixed bracket paths.
- **Exponential scoring** — R32 = 1, R16 = 2, QF = 4, SF = 8, Final = 16.
  A perfect bracket totals **80 points**. The live counter shows what your
  current picks are worth.
- **Shareable URL** — every pick is saved to the address bar. "Copy share link"
  hands someone your exact bracket.
- **Third-place playoff** — losers of the semis, kept outside the points scheme
  (as is standard).
- **TBD slots** — matchups not yet confirmed show their group descriptor
  (e.g. `3rd C/D/F/G/H`) until results lock in.
- Responsive, keyboard-focusable, and respects `prefers-reduced-motion`.

## Quick start

Just open `index.html` in a browser. Because it loads the CSS/JS as separate
files, serve it over HTTP rather than `file://` for best results:

```bash
# any static server works — for example:
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Hosting

### GitHub Pages (one click)
1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   The included workflow (`.github/workflows/deploy.yml`) publishes the site on
   every push to `main`.
3. Your bracket goes live at `https://<user>.github.io/<repo>/`.

Prefer the no-Actions route? **Settings → Pages → Source: Deploy from a branch →
`main` / `(root)`** also works since everything is static.

### Anywhere else
Upload the folder to Netlify, Vercel, Cloudflare Pages, S3, or any static host.
There is nothing to build.

## Project structure

```
wc2026-bracket/
├── index.html              # markup + page shell
├── assets/
│   ├── styles.css          # all styling (design tokens at top)
│   └── preview.svg         # social/README preview image
├── src/
│   ├── data.js             # teams, bracket tree, scoring — EDIT THIS
│   └── bracket.js          # rendering, picks, scoring, URL sharing
├── .github/workflows/
│   └── deploy.yml          # GitHub Pages deployment
├── LICENSE
└── README.md
```

## Updating teams as results come in

All tournament data lives in **`src/data.js`** — you never touch the logic.

Each Round-of-32 slot is either confirmed or projected:

```js
T("Brazil", "1C")   // T = confirmed team
P("France", "1I")   // P = projected / not-yet-locked slot (shown muted)
```

To confirm a team, change `P(...)` to `T(...)`. To swap a team, edit the name and
seed and make sure its flag emoji exists in the `FLAGS` map at the top of the
file. The bracket tree (`TREE`) follows FIFA's published paths and shouldn't need
changes.

## How scoring works

The classic doubling scheme rewards calling the later rounds correctly:

| Round | Per correct pick | Matches | Round total |
|-------|------------------|---------|-------------|
| Round of 32 | 1 | 16 | 16 |
| Round of 16 | 2 | 8 | 16 |
| Quarter-finals | 4 | 4 | 16 |
| Semi-finals | 8 | 2 | 16 |
| Final | 16 | 1 | 16 |
| **Total** | | **31** | **80** |

The counter shows the points your picks are *worth* if they all come true — it is
a projection tool, not a result tracker.

## License

MIT — see [LICENSE](LICENSE). Flag emoji are rendered by the OS font.
Team data is factual tournament information.
