# UI Library

This package contains app-agnostic UI building blocks and the shared visual system.

Usage:
- Import components from `@deedlit.dev/ui`.
- Import the design system stylesheet from `@deedlit.dev/ui/styles.css` once in your app shell.

Conventions:
- Prefer `testId` for test selectors (mapped to `data-testid`).
- Use `className` for styling overrides and keep components presentation-focused.
- Prefer shared primitives (`SurfacePanel`, `TextInput`, `SelectInput`, `TextAreaInput`, `StatusBadge`) before writing one-off class bundles.
- Keep primitives token-driven (CSS variables) so theme behavior stays centralized in `styles/styles.css`.

