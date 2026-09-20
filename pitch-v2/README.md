# Pitch deck — demoday

Twelve slides in Portuguese for the 4-minute demoday slot, plus the Remotion project that renders
the motion and the marketing stills inside them.

## Run it

```bash
pnpm pitch          # serves this folder at http://localhost:4321
```

Open <http://localhost:4321>, press `F` for fullscreen, `N` for presenter notes.

Serve it — don't open `index.html` with `file://`. Chrome blocks locally-hosted webfonts on that
scheme and the deck falls back to system type.

| Key | What |
|-----|------|
| `→` `←` `space` `PgDn` `PgUp` | Navigate. Clicking also advances; clicking the left fifth goes back. |
| `1`–`9` · `Home` · `End` | Jump |
| `N` | Presenter notes — what to say, target time, what comes next |
| `G` · `Esc` | Thumbnail grid / back to the slide |
| `T` | Start / stop the rehearsal timer (turns orange past 4:00) |
| `F` | Fullscreen |

The slide number is in the URL hash, so `#8` opens straight on the demo hand-off — useful for
coming back from the live demo without arrowing through everything.

## Export the short deck

```bash
pnpm pitch:pdf      # → pitch/underwrite-pitch.pdf, 12 pages, 16:9
```

Video slides export their poster frame. Set `CHROME=/path/to/chrome` if Chrome isn't in
`/Applications`.

## The run of show

| # | Slide | Target |
|---|-------|--------|
| 01 | Capa — o comprador compra um SLA, não um modelo | 0:15 |
| 02 | O cliente é um agente (a pergunta-guia, respondida) | 0:30 |
| 03 | O problema — 0.98 declarado contra 0.41 apurado | 0:50 |
| 04 | A solução — quatro campos, um certificado | 1:10 |
| 05 | A cadeia — custódia por salto, culpa no salto certo | 1:30 |
| 06 | Verificação — determinística primeiro, juiz depois | 1:50 |
| 07 | Confiança é um vetor, não uma nota | 2:00 |
| 08 | **Demo ao vivo** — sai o slide | 2:10 → 3:30 |
| 09 | Recap — está tudo no ledger | 3:30 |
| 10 | Os 5 desafios — entramos no 02, entregamos os cinco | 3:40 |
| 11 | Onde isso pontua (**cortável** se o relógio apertar) | 3:50 |
| 12 | Fecho | 4:00 |

Slide 08 lists the three live paths and what the judges should watch in each. If the clock slips,
drop the hosted-agent path and then slide 11 — never `pnpm loop`, which carries the A→B→C1→C2
scene the whole pitch has been building to.

## Motion and stills

`remotion/` renders everything in `assets/`. Tokens and type mirror `src/app/globals.css`, so the
deck and the product look like the same object. The data in them is the real thing: event names come
from `LedgerEventType`, the six axes from `AxisName`, the check names from the `html_to_pdf` rubric.

| Asset | Composition | Where |
|-------|-------------|-------|
| `chain.mp4` | `Chain` | Slide 05, full-bleed |
| `verdict.mp4` | `Verdict` | Slide 06, full-bleed |
| `axes.png` | `Axes` | Slide 07, full-bleed |
| `certificate.png` | `Certificate` | Slide 04 |
| `ledger.mp4` | `Ledger` | Slide 09 |
| `*-poster.png` | frame grabs | `<video poster>` and the PDF export |

Slides 05–07 are full-bleed: the composition carries its own headline and leaves room at the bottom
for the deck's rail, so nothing is boxed in.

To change one:

```bash
cd pitch/remotion
npm install                       # once
npm run studio                    # live preview at localhost:3000

npx remotion still  src/index.ts Certificate ../assets/certificate.png
npx remotion render src/index.ts Chain ../assets/chain.mp4 --codec=h264 --crf=20
```

Re-render the matching poster after changing a video, or the PDF export and the first painted frame
will disagree with the loop:

```bash
npx remotion still src/index.ts Chain ../assets/chain-poster.png --frame=265
```

## Fonts

Manrope, DM Mono and Playfair Display are vendored in `assets/fonts/` (latin + latin-ext, ~500 KB)
so the deck renders identically with the venue wifi down.
