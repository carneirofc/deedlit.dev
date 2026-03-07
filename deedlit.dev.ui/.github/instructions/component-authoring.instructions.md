---
applyTo: "src/**/*.ts,src/**/*.tsx,styles/**"
description: "Use when authoring or refactoring shared UI components, styling tokens, or package utilities in deedlit.dev.ui."
---

# Shared UI Authoring Guidance

- Keep components reusable and app-agnostic.
- Prefer `forwardRef` for components that wrap interactive or focusable DOM elements.
- Support `className` overrides without breaking the component's default token-driven styling.
- Forward `testId` as `data-testid` so consuming apps can use stable selectors.
- Use controlled/uncontrolled patterns consistently when the component exposes mutable value state.
- Keep design tokens in `styles/styles.css`; do not scatter new theme constants across component files.
- Preserve the package's export hygiene: if a new component is public, add it to the entrypoint and keep types exported alongside it.
