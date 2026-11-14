# baghedge motion kit

four react components for the app, built from the same halftone dots as the landing. no dependencies past react. copy this folder into the vite app and import from it. the `"use client"` lines are for next and do nothing in vite.

you can see all four running at /brand, under motion.

## BagLoader

the mark in coral dots with a band of glyphs sweeping across it. use it anywhere something is loading.

```tsx
<BagLoader size={24} />
```

`size` is the height in px. below about 40 px the grid gets coarser, so the dots stay crisp, and the glyph band turns into dots.

## LogoReveal

the splash. the mark decodes in from glyphs, then the name slides out from behind it.

```tsx
<LogoReveal size={96} onDone={() => setReady(true)} />
```

pass a new `play` value to run it again. `name={false}` gives just the mark.

## StatusText

a label that decodes into its new value whenever `text` changes. made for the hedge states in docs/BAGHEDGE_CONTEXT.md: awaiting signature, deposit detected, in transit, credited, armed, entry pending, recovery stop active, closing.

```tsx
<StatusText text={hedge.status} className="text-sm" />
```

screen readers get the real value straight away, the scramble is only visual.

## RuleLines

the rule over the chart. the recovery line (white) and the entry line (coral) print in when `armed` turns true. the labels sit on chips so they never cover the candles. put it absolutely over the chart. the y values come from lightweight-charts:

```tsx
<RuleLines
  armed={rule.armed}
  entry={{ y: series.priceToCoordinate(rule.entry), label: `Short opens below $${rule.entry}` }}
  recovery={{ y: series.priceToCoordinate(rule.recovery), label: `Try to close at $${rule.recovery}` }}
/>
```

## the rules they follow

- with reduced motion on, everything shows its final state with no movement.
- loaders pause when they're off screen.
- the only colours are coral `#f0645a`, white and black `#0b0908`. the font is whatever the app uses.
