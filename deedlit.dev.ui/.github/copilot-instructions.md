# Deedlit UI — Copilot Instructions

## What This Package Owns
This package is the shared React UI library used by both Next.js apps. It owns reusable presentation primitives, icons, and the shared design-token layer exported as `@deedlit.dev/ui`.

## Component Rules
- Build app-agnostic primitives here, not app-specific domain components.
- Prefer the existing component patterns: typed props, `forwardRef` where a DOM node should remain accessible, `className` override support, and `testId` forwarding to `data-testid`.
- Export reusable components and related types from the package entrypoint so app consumers can import them consistently.
- Keep components presentation-focused; domain state, API calls, and app routing should stay in the consuming apps.

## Styling Rules
- Use the shared token system in `styles/styles.css` instead of hardcoded app-specific colors.
- Preserve theme behavior through CSS variables and existing token names.
- Use the package utilities and `cn()`-style composition patterns to keep class merging predictable.

## Build And Export Rules
- The package is built with TypeScript and a post-build import-fix step. Keep source and emitted imports compatible with that flow.
- Maintain the public export surface declared in `package.json` unless the task explicitly changes the package API.
- Remember that both apps depend on this build output, so breaking exports here has monorepo-wide impact.

## Change Boundaries
- If a component imports app-local business logic, it probably does not belong in this package.
- If both apps need the same primitive or style pattern, it probably does belong in this package.
- Keep shared UI changes backwards-compatible unless coordinated app updates are part of the same task.

## Common Command
- Build the package: `npm run build`
