# design-sync notes — @carneirofc/ui (storybook shape)

## Build invariants
- **[GENERAL] node_modules is hoisted to the repo root.** `deedlit.dev.ui` is NOT a
  workspace, but it sits under the repo root whose `node_modules` holds react,
  react-dom, clsx, tailwind-merge. `deedlit.dev.ui/node_modules` is sparse. Always
  pass `--node-modules node_modules` (repo root), not the package's own.
- **Entry:** `deedlit.dev.ui/dist/index.js` (built by `npm run build` = tsc + fix-esm-imports).
  In the DS's own source repo there is no `node_modules/@carneirofc/ui`, hence `--entry`.
- **Reference storybook:** built from `deedlit.dev.ui` with `-c .storybook` into
  `.design-sync/sb-reference` (repo-root path). Rebuild whenever DS source changes.

## Theme / provider
- **[GENERAL] The `.storybook/preview` decorator does not bundle** (`Could not resolve
  "tailwindcss"` — preview.css does `@import "tailwindcss"`). This is harmless: the
  decorator only sets `data-theme` on `<html>`, and the **light** theme tokens live on
  `:root` while only `html[data-theme="dark"]` overrides. Storybook's default render is
  light too, so previews (no decorator) match the reference apples-to-apples. **No
  `cfg.provider` needed.** Dark mode is out of scope for previews (documented in
  conventions header instead).
- CSS comes from `[CSS_FROM_STORYBOOK]` scrape of the compiled Tailwind v4 output in
  sb-reference (`_ds_bundle.css`, ~77 KB). The package's own `styles/styles.css` is only
  the token `:root` block, not the generated utilities.

## titleMap
- `CyberPanels` → `CyberPanel` (story title is plural; exports are CyberPanel/CyberSubpanel).
- Excluded (`null`): `Icons` (showcase grid, no single export — icons still ship in the
  bundle, just no card), and the 5 `Foundations/*` token showcases (Borders&Shadows,
  Colors, CyberStyles, Surfaces&Backgrounds, Typography) — not component exports.

## GRID_OVERFLOW overrides (presentation-only; grades carry)
- `column`: CodeBlock, CollapsiblePanel, CyberPanel, KeyValueField, PanelSectionHeader,
  PromptBlock, ScanProgress, SurfacePanel, Table (stories wider than a grid cell).
- `single`: DockPanel (Default), Toast (Default) — fixed/portal positioning.

## Skipped stories
- `WarningList.Empty` (`components-warninglist--empty`) → `cfg.overrides.WarningList.skip`.
  The story passes `warnings: []` and `WarningList` returns `null` for empty input, so it
  renders nothing statically (`sb-error: no storybook root content`). By design, not a bug.

## Grading gotchas (read before judging)
- **[GENERAL] The preview page frames much wider than storybook.** Storybook uses
  `layout: "centered"` and crops to the component; the preview renders the component at
  the top-left of a full-viewport white canvas. So in the sheet the preview almost always
  looks SMALLER and left-aligned. This is framing — judge the component itself, not its
  position/scale on the canvas. Confirmed match: a component that looks "tiny" in the
  sheet is identical at full-res (raw/ PNGs).
- **[GENERAL] Full-width components spread their internals on the wide canvas.** e.g.
  MediaStage anchors its nav arrows to the (full-width) container edges, so on the wide
  preview canvas they sit far apart and the arrow over the white surface reads grey
  (semi-transparent button). Storybook's centered layout shrinks the container so they sit
  over the content. Same component — do NOT grade this a mismatch.

## Re-sync risks (watch-list for the next sync)
- **`ScanProgress.Indeterminate` animates on a timer** — the live percentage differs
  between captures (e.g. 8% vs 21%). Graded `match` on structure/styling; do NOT re-flag a
  mismatch on the percentage alone. Sources are stable so it carries forward.
- **Display font is host-provided, not shipped.** `--font-sans` → `var(--font-display)` is
  undefined in the DS; sans falls back to system UI on both panels, so previews match — but
  the compare oracle can't see font fallback, and claude.ai/design renders system sans
  unless a host defines `--font-display`. `--font-mono` ships and is fine.
- **`OutlineButton.Sizes` (7th story) is capped** — compare's default 6-story cap captured
  Neutral/Accent/Danger/Ghost/Disabled/Variants; Sizes rides as verified-by-upload tail.
  Pass `--max-stories 7` to grade it explicitly if its size variants matter.
- **Decorator never bundles** (theme is attribute-only) — dark-mode previews are not
  exercised. If a future sync wants dark previews, that needs new setup (the decorator
  can't bundle while preview.css imports tailwindcss).
- **`WarningList.Empty` skipped** (renders nothing by design) — see Skipped stories.
- **node_modules hoisting** and the `titleMap` exclusions (Icons showcase + 5 Foundations)
  are load-bearing — see Build invariants / titleMap.
