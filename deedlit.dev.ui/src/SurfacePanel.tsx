"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

export type SurfacePanelTone = "default" | "soft" | "subtle" | "strong";
export type SurfacePanelPadding = "none" | "sm" | "md" | "lg";

export const surfacePanelVariants = cva("rounded-xl border", {
  variants: {
    tone: {
      default: "border-ui bg-[color:var(--ui-bg)]",
      soft: "border-ui bg-panel/90",
      subtle: "border-ui-subtle bg-[color:var(--ui-bg-alt)]",
      strong: "border-ui bg-[color:var(--ui-bg-strong)]",
    },
    padding: {
      none: "",
      sm: "p-2",
      md: "p-3",
      lg: "p-4",
    },
  },
  defaultVariants: {
    tone: "default",
    padding: "md",
  },
});

export type SurfacePanelProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof surfacePanelVariants>;

const SurfacePanel = forwardRef<HTMLDivElement, SurfacePanelProps>(function SurfacePanel(
  { className, tone, padding, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="surface-panel"
      className={cn(surfacePanelVariants({ tone, padding }), className)}
      {...props}
    />
  );
});

SurfacePanel.displayName = "SurfacePanel";

export default SurfacePanel;
