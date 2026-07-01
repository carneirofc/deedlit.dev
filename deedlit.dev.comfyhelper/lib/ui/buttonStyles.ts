/** Icon-only square control (play/pause, fullscreen, close, delete, …). */
export const ctrlBtnClass =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ui-border/50 bg-ui-bg/70 text-ui-ink-muted backdrop-blur transition hover:border-accent-cyan hover:text-accent-cyan disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Icon+label control (Similar, Details, Notes, HD, …). Uses `inline-flex`
 * rather than `grid` so the icon and label sit on one row — a bare `grid`
 * with two auto-placed children (icon, text) and no explicit columns stacks
 * them into separate rows instead, squishing the label.
 */
export const pillBtnClass =
  "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-ui-border/50 bg-ui-bg/70 px-3 text-ui-2xs font-medium text-ui-ink-muted backdrop-blur transition hover:border-accent-cyan hover:text-accent-cyan disabled:cursor-not-allowed disabled:opacity-40";
