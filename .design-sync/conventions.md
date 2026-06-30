# Building with @carneirofc/ui

A React 19 component library with a token-driven "cyber" visual system (glass surfaces,
neon gradients). Compose the real components below; for your own layout glue, use the
**design tokens** and **base classes** named here — they are the styling contract.

## Setup & theming

- **No React provider or context is required.** Components are self-contained — import and
  render directly.
- **Load the stylesheet once** at the app root: `import "@carneirofc/ui/styles.css";`
  (the bound copy here is `styles.css`, which `@import`s the compiled `_ds_bundle.css`).
  Without it, components render unstyled.
- **Theme:** the **light** palette is the default (`:root`). For dark mode, set
  `data-theme="dark"` on a root element (the app uses `<html data-theme="dark">`); that one
  attribute flips every color token. There is no per-component theme prop.
- **Fonts:** body text uses `font-family: var(--font-sans, …)` and code uses
  `var(--font-mono)`. The DS does **not** ship a brand display font — `--font-sans` falls
  back to system UI fonts unless the host app defines `--font-display`. Plan layouts to
  read well in a system sans.

## Styling idiom — tokens + a small class vocabulary (NOT arbitrary Tailwind)

The components are built with Tailwind v4, but **the shipped CSS is static** — only the
utility classes the library itself already uses are present. So when you write your own
markup, do **not** assume an arbitrary Tailwind utility resolves. Reliable surfaces:

**1. Design tokens (CSS variables, always available on `:root`).** Use via arbitrary values
(`className="text-[color:var(--text-1)]"`) or inline style. Real names:
- Backgrounds: `--bg-0` `--bg-1` `--bg-2`; surfaces `--surface-0` `--surface-1` `--surface-2`; `--panel-white`
- Text/ink: `--text-0` (strong) `--text-1` (body) `--text-2` (muted); plus `--ui-ink`, `--ui-ink-title`, `--ui-ink-muted`, `--ui-ink-subtle`
- Accents: `--accent-cyan` `--accent-pink` `--accent-lime` `--accent-warn`
- Borders & depth: `--panel-border`, `--ui-border`; `--shadow-sm` `--shadow-lg`
- Type scale: `--ui-font-2xs … --ui-font-xl`, `--ui-font-display`; `--font-mono`

**2. Base classes (always in the shipped CSS).**
- Surfaces: `.cyber-panel` (hero glass+gradient surface), `.cyber-subpanel` (nested), `.cyber-chip`
- Controls: `.cyber-button`, `.cyber-button-ghost`, `.cyber-input`
- Text: `.cyber-title`, `.cyber-muted`
- Fluid font sizes: `.text-ui-3xs` `.text-ui-2xs` `.text-ui-xs` `.text-ui-sm` `.text-ui-md` `.text-ui-lg` `.text-ui-xl` `.text-ui-display`

Prefer reusing library components (e.g. `SurfacePanel`, `CyberPanel`, `OutlineButton`,
`StatusBanner`, `Table`, `PageHeader`) over re-styling from scratch.

## Where the truth lives

Read `styles.css` and its `@import`ed `_ds_bundle.css` for the full token set and class
definitions, and each component's `<Name>.prompt.md` + `<Name>.d.ts` for its exact API.

## Example

```tsx
import { CyberPanel, OutlineButton, StatusBadge } from "@carneirofc/ui";
import "@carneirofc/ui/styles.css";

export function ScanCard() {
  return (
    <CyberPanel className="w-[28rem]">
      <p className="cyber-title text-ui-lg font-semibold">Image library</p>
      <p className="cyber-muted mt-1 text-ui-sm">1,204 images indexed across 3 sources.</p>
      <div className="mt-4 flex items-center gap-3">
        <StatusBadge tone="success">Synced</StatusBadge>
        <OutlineButton variant="accent">Run scan</OutlineButton>
      </div>
    </CyberPanel>
  );
}
```
