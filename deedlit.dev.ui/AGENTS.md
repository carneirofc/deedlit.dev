# deedlit.dev.ui — @carneirofc/ui

## Purpose
- Shared, app-agnostic React component library and design-token system consumed by both Next.js apps as `@carneirofc/ui`.

## Ownership
- Owns presentation-only primitives, icons, design tokens, and CSS variables.
- Must NOT own domain state, API calls, routing, or any app-specific business logic — those stay in the consuming app.

## Local Contracts
- `package.json` name `@carneirofc/ui`, `"type": "module"`; public surface is `src/index.ts` → built `dist/`, plus the `./styles.css` export. Both apps depend on the built output, so treat the export surface as a contract.
- `src/*.tsx` components each paired with `src/*.stories.tsx`; `src/foundations/*.stories.tsx`; `src/lib/`; `styles/styles.css`; `.storybook/`; `scripts/fix-esm-imports.mjs`.
- Authoring conventions (`.github/copilot-instructions.md`, `.github/instructions/component-authoring.instructions.md`, `README.md`): typed props, `forwardRef`, `className` override, `testId`→`data-testid`, token-driven styling. Prefer reusing existing primitives (`SurfacePanel`, `TextInput`, `SelectInput`, `TextAreaInput`, `StatusBadge`).
- Storybook is published to GitHub Pages at `https://carneirofc.github.io/deedlit.dev/ui/storybook/` via [`../.github/workflows/storybook-pages.yml`](../.github/workflows/storybook-pages.yml).

## Work Guidance
- Promote reusable pieces here; keep app-specific behavior out. When a change touches shared UI and an app, build the UI first, then adjust the consumer.

## Verification
- `npm run build -w @carneirofc/ui` (type-check via `tsc` + ESM import fix). No unit-test or lint script in this package.
- `npm run build-storybook -w @carneirofc/ui` for the static Storybook.

## Child DOX Index
- None.
