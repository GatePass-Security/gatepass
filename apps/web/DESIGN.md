# Gatepass Dashboard Design System

The dashboard is the same product as the marketing site, so it looks like it: a near-black
canvas, neutral greys, a mint accent held back for state and data, and a high-contrast pill as
the primary action. Everything below is derived from that surface — no palette or type choice
here is decorative.

**Brand:** measured precision. The product's claim is determinism; the interface should read as
instrument, not as pitch.

---

## 1. Architecture — semantic tokens, never `dark:`

Colour lives in `src/app/globals.css` as CSS custom properties. `:root` holds light values,
`.dark` overrides them, and `@theme inline` maps each one to a Tailwind utility.

The dark values are **copied from the marketing surface's own tokens** in
`src/styles/landing.css` (`--bg`, `--bg-card`, `--line`, `--fg`, `--fg-muted`, `--fg-dim`,
`--accent`, `--danger`, `--amber`), so the two surfaces cannot drift apart by editing one of
them. Each is annotated in `globals.css` with the landing token it came from. A few have no
landing counterpart and exist because a dashboard needs states a landing page does not — a
hover surface, a sunken input well, the four-step severity ramp.

```
--gp-surface  ──▶  @theme inline: --color-surface  ──▶  class: bg-surface
```

**Components never write a `dark:` variant.** One class name is correct in both themes because
the *value* moves, not the class. This is not a preference — the previous system required a
`dark:` twin on every utility and `FindingsClient.tsx`, `docs/page.tsx` and `support/page.tsx`
all shipped without them, rendering dark text on dark surfaces. A token that can only be wrong
in one place cannot drift.

Dark is the default. The pre-paint script in `layout.tsx` applies `.dark` unless the user has
explicitly stored `theme=light`.

### Token reference

| Utility | Purpose |
|---|---|
| `bg-canvas` | Page background |
| `bg-surface` | Cards, panels, the rail |
| `bg-raised` | Hover, nested panels, chips |
| `bg-sunken` | Inputs, table headers, code blocks |
| `border-line` / `border-line-strong` | Hairline / emphasised borders |
| `text-fg` | Primary text |
| `text-fg-secondary` | Body text |
| `text-fg-muted` | Labels, captions, metadata — the weakest text tier |
| `text-accent` / `bg-accent-solid` / `bg-accent-soft` / `border-accent-line` | Mint accent |
| `bg-action` / `text-action-text` | Primary action pill |

Data tones — `verified`, `research`, `critical`, `high`, `medium`, `low` — each expose
`text-*`, `bg-*`, `bg-*-soft`, `border-*-line`.

### Measured contrast

Every text token is checked against **every surface it can land on**, not just the card it
usually sits on. That distinction is not academic: a badge inside a table header sits over
`--gp-surface-sunken`, the lightest fill in the light theme, and that is the case that failed.

`apps/web/test/contrast.test.ts` parses this file's tokens out of `globals.css` and asserts the
4.5:1 floor for all 10 foregrounds × 4 surfaces × 2 themes. It reads the stylesheet rather than a
copy of the palette, so it cannot drift from the values actually shipped.

| Token | Dark | worst-case ratio | Light | worst-case ratio |
|---|---|---|---|---|
| `--gp-text` | `#FFFFFF` | 18.7:1 | `#0A0A0B` | 17.2:1 |
| `--gp-text-secondary` | `#C0C0C0` | 10.3:1 | `#46464C` | 8.1:1 |
| `--gp-text-muted` | `#7E7E86` | 4.6:1 | `#6B6B72` | 4.6:1 |
| `--gp-accent` / `--gp-verified` | `#2DD4BF` | 10.1:1 | `#0A7569` | 4.9:1 |
| `--gp-critical` | `#F87171` | 6.8:1 | `#C4292B` | 4.9:1 |
| `--gp-high` | `#FB923C` | 8.3:1 | `#A94E08` | 4.8:1 |
| `--gp-medium` | `#FBBF24` | 11.2:1 | `#8A6100` | 4.8:1 |
| `--gp-low` | `#8E8E96` | 5.8:1 | `#5F5F66` | 5.5:1 |
| `--gp-research` | `#6BA6FF` | 7.6:1 | `#1D5FD0` | 5.1:1 |

Three of these were fixed rather than documented as exceptions:

- **Light accent / verified** was `#0B7F72` — 4.25:1 on the sunken fill. Since `verified` is the
  product's central claim, a "Verified" badge that fails AA is not a rounding error. Now `#0A7569`.
- **Light high** was `#B45309` at 4.36:1. Now `#A94E08`.
- **`--gp-text-faint`** was a fourth text tier at 2.43:1 (light) and 2.91:1 (dark) — below even
  the 3:1 non-text floor — while carrying scan ids, timestamps, nav group labels and "Not
  published yet." The only value that would have fixed it was within a hair of `--gp-text-muted`,
  so **the tier was deleted** rather than made a duplicate. Three greys below body text is one
  more than this palette can support. The test asserts it stays gone.

---

## 2. Colour semantics

**Severity is ordinal**, so it gets a monotonic ramp — red → orange → amber → neutral grey. It
never borrows a hue from elsewhere. The old code mapped `medium` to blue in one file and amber
in another; the ramp is now single-sourced through `severityToken()` in `lib/utils.ts`.

**Tier is categorical**, so it gets distinct hues: `verified` mint, `research` blue. Verified
sharing the brand accent is deliberate — verified findings *are* the Gatepass guarantee.

**Posture** maps onto those existing tones (`POSTURE_TOKEN`) rather than introducing a fifth
palette.

Colour is never the only channel. Every badge carries a text label; diffs carry `+`/`-`; sort
state carries a direction arrow and `aria-sort`.

---

## 3. Typography

**Inter Tight** and **JetBrains Mono**, self-hosted through `next/font/google` and declared
once in the root `layout.tsx`. These are the marketing surface's own faces — see
`src/styles/landing.css` — so the product and the landing page are set in one typeface rather
than two that merely resemble each other.

An earlier revision of this dashboard used Geist, chosen as the closest free match while the
landing page still lived outside this repo and a screenshot was the only reference. Once the
landing page landed on `master` the real face was knowable, and the guess was replaced.

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Page title | 1.6rem | 500 | −0.03em |
| Card title | 0.82rem | 500 | −0.021em |
| Stat value | 1.75rem | 500 | −0.03em |
| Body | 0.855rem | 400 | — |
| Caption / metadata | 0.72–0.78rem | 400–500 | — |
| Overline label | 0.72rem | 500 | +0.05em, uppercase |

Display type is **medium, not bold** — the marketing headline is set at medium weight, and
weight is not how this brand signals importance; contrast and space are.

Numerals are `tabular-nums` on every table and any element marked `data-numeric`. Columns of
counts must align or they cannot be compared at a glance.

---

## 4. Shape and motion

Pills (`rounded-full`) for buttons, badges, filters and the search field — the marketing site
sets its buttons at `border-radius: 300px`, so the pill is the shared language for things you
press. Nav items are **not** pills: at eleven entries a column of filled capsules reads as
decoration, so the rail marks its active row with a 2px accent rule against a raised fill.
Cards use `--radius-card` (0.875rem); code panels 0.75rem; inputs 0.6rem.

Motion is 150–220ms on `transform`/`opacity`/colour only, never on layout properties. Hover
never changes size — a control that grows under the cursor shifts everything around it.
`prefers-reduced-motion: reduce` collapses all of it.

**No ambient decoration and no gradients.** A `.gp-glow` radial used to sit behind the shell
header. On the landing page that effect belongs to a hero and does work; over a working surface
it tinted the top of every table, so severity colours read differently at the top of a page than
at the bottom. It is gone, along with the mint-gradient tile that stood in for the logo — the
mark is now the marketing site's own flat asset (`public/landing/gatepass-logo.png`), and the
favicon and OG card were redrawn flat to match. The product ships zero gradients; the contrast
test asserts none return to the token layer.

The one pulse in the product is the API status dot while its state is still unknown, and the
loading skeleton. Both are real state, not atmosphere.

---

## 5. Primitives

All in `src/components/ui/`, exported from `index.ts`. Pages compose these; pages do not invent
card, badge, or stat markup.

| Component | Notes |
|---|---|
| `Button` | `primary` (contrast pill) · `secondary` · `ghost` · `accent` · `danger` |
| `IconButton` | `label` prop is **required** — icons have no accessible name |
| `Badge` | Tone + optional dot; label always carries the meaning |
| `Card` / `CardTitle` | Optional header/footer bands |
| `Stat` | The one metric tile. `caption` must be derived from data |
| `Table` | Sortable headers with `aria-sort`, `sr-only` caption |
| `Input` / `Textarea` / `Select` | Label, hint, `role="alert"` errors, `aria-describedby` |
| `Toggle` | `role="switch"` + `aria-checked` + a real `<label>` |
| `FilterPill` / `SegmentedControl` | `aria-pressed` / `role="radio"` |
| `CodeBlock` | Terminal panel, copy button, optional diff tinting |
| `EmptyState` / `ErrorState` | Consistent zero and failure surfaces |
| `Skeleton` / `PageSkeleton` | Placeholder geometry matches the real layout |
| `Toast` | `aria-live="polite"` region |

`Stat.tsx` owns `TONE_TEXT` / `TONE_FILL` / `TONE_SOFT` / `TONE_VAR` as **literal** class maps.
Never build a class with `text-${tone}` — Tailwind only generates names it can see as literals,
so an interpolated one compiles to nothing.

---

## 6. Rules

1. **No `dark:` variants.** Use a semantic token.
2. **No hardcoded hex** in components. `TONE_VAR` covers the inline-SVG cases.
3. **No invented numbers.** Every figure on screen traces to an API response. A caption like
   "95.3% compliance rate" with nothing behind it is worse than no caption — this is a product
   whose entire claim is that its output is checkable.
4. **Icons are Lucide SVGs**, never emoji.
5. **Every interactive element** gets `cursor-pointer`, a visible `:focus-visible` ring, and an
   accessible name.
6. **Empty means empty.** Render an `EmptyState`, never placeholder data.
7. **Async state is announced** — `aria-live` or `role="alert"`, not colour alone.

---

## 7. Layout

```
┌──────────┬────────────────────────────────────────┐
│          │  TopNavBar (h-16, sticky, translucent) │
│  Rail    ├────────────────────────────────────────┤
│  16.5rem │  PageHeader — title · description ·    │
│          │               actions                  │
│  (drawer │  Stat row — grid, 2 → 4 columns        │
│   below  │  Content — cards / tables              │
│   md)    │                                        │
└──────────┴────────────────────────────────────────┘
```

Container is `max-w-[88rem]`, padding `px-5 sm:px-7 lg:px-9 py-7`. Routes render into that —
a page must not add its own competing max-width.

Breakpoints verified at 375 / 768 / 1024 / 1440. Wide content scrolls inside its own
`overflow-x-auto`; the page body never scrolls sideways.
