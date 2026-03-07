"use client";

import { Children, forwardRef, isValidElement, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn, SPACING_PATTERNS } from "./utils";

export type OutlineButtonVariant = "neutral" | "danger" | "ghost" | "accent";
export type OutlineButtonSize = "xs" | "sm" | "md" | "lg" | "icon";

export type OutlineButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: OutlineButtonVariant;
  controlSize?: OutlineButtonSize;
  tooltip?: string;
  label?: string;
};

const BASE_CLASS_NAME =
  "inline-flex cursor-pointer select-none items-center justify-center gap-1 whitespace-nowrap border font-medium leading-none transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-150 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ui-ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--ui-bg)] focus-visible:border-[color:var(--ui-border-focus)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0 disabled:active:scale-100";

const SIZE_CLASS_NAMES: Record<OutlineButtonSize, string> = {
  xs: cn("rounded-md", SPACING_PATTERNS.controlXs, "text-ui-xs"),
  sm: "rounded-lg px-3 py-1.5 text-ui-xs",
  md: cn("rounded-xl", SPACING_PATTERNS.controlMd, "text-ui-xs"),
  lg: "min-h-10 rounded-xl px-4 py-2 text-ui-sm",
  icon: "rounded-lg p-1.5 text-ui-xs",
};

const VARIANT_CLASS_NAMES: Record<OutlineButtonVariant, string> = {
  neutral:
    "border-ui-strong bg-panel text-[color:var(--ui-ink-accent)] shadow-[0_10px_24px_-18px_color-mix(in_oklab,var(--ui-border-active)_45%,transparent)] hover:border-ui-active hover:bg-[color:var(--ui-bg-soft)] hover:shadow-[0_16px_28px_-20px_color-mix(in_oklab,var(--ui-border-active)_62%,transparent)] active:bg-[color:var(--ui-bg-active)]",
  danger:
    "border-rose-300 bg-[color:var(--ui-bg-card)] text-rose-700 shadow-[0_10px_24px_-18px_rgba(225,29,72,0.35)] hover:border-rose-400 hover:bg-error hover:shadow-[0_16px_28px_-20px_rgba(225,29,72,0.5)] active:bg-rose-100",
  ghost:
    "cyber-button-ghost border-ui-strong bg-[color:var(--surface-0)]/55 text-[color:var(--ui-ink)] shadow-[0_10px_24px_-18px_color-mix(in_oklab,var(--ui-border-active)_38%,transparent)] hover:border-ui-active hover:bg-[color:var(--ui-bg-soft)] hover:shadow-[0_16px_28px_-20px_color-mix(in_oklab,var(--ui-border-active)_54%,transparent)] active:bg-[color:var(--ui-bg-soft)]",
  accent:
    "cyber-button border-transparent text-[color:var(--text-0)] shadow-[0_10px_24px_-18px_color-mix(in_oklab,var(--panel-border-strong)_45%,transparent)] hover:border-transparent hover:shadow-[0_16px_28px_-20px_color-mix(in_oklab,var(--panel-border-strong)_62%,transparent)] active:bg-[color:color-mix(in_oklab,var(--surface-0)_55%,var(--accent-cyan)_45%)]",
};

function extractTextLabel(content: ReactNode): string | undefined {
  const textContent = Children.toArray(content)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child).trim();
      }

      if (isValidElement<{ children?: ReactNode }>(child)) {
        return extractTextLabel(child.props.children) ?? "";
      }

      return "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return textContent.length > 0 ? textContent : undefined;
}

const OutlineButton = forwardRef<HTMLButtonElement, OutlineButtonProps>(function OutlineButton(
  {
    variant = "neutral",
    controlSize = "sm",
    className,
    type = "button",
    tooltip,
    label,
    title,
    children,
    "aria-label": ariaLabel,
    suppressHydrationWarning,
    ...props
  },
  ref,
) {
  const inferredLabel = extractTextLabel(children);
  const resolvedTooltip = tooltip ?? title ?? label ?? ariaLabel ?? inferredLabel;
  const resolvedAriaLabel = label ?? ariaLabel ?? (!inferredLabel ? resolvedTooltip : undefined);

  return (
    <button
      ref={ref}
      type={type}
      title={resolvedTooltip}
      aria-label={resolvedAriaLabel}
      suppressHydrationWarning={suppressHydrationWarning ?? true}
      className={cn(BASE_CLASS_NAME, SIZE_CLASS_NAMES[controlSize], VARIANT_CLASS_NAMES[variant], className)}
      {...props}
    >
      {children}
    </button>
  );
});

OutlineButton.displayName = "OutlineButton";

export default OutlineButton;
