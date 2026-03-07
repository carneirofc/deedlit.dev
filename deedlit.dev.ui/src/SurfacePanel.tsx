"use client";

import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "./utils";

export type SurfacePanelTone = "default" | "soft" | "subtle" | "strong";
export type SurfacePanelPadding = "none" | "sm" | "md" | "lg";

export type SurfacePanelProps = HTMLAttributes<HTMLDivElement> & {
  tone?: SurfacePanelTone;
  padding?: SurfacePanelPadding;
};

const TONE_CLASS_NAMES: Record<SurfacePanelTone, string> = {
  default: "border-ui bg-[color:var(--ui-bg)]",
  soft: "border-ui bg-panel/90",
  subtle: "border-ui-subtle bg-[color:var(--ui-bg-alt)]",
  strong: "border-ui bg-[color:var(--ui-bg-strong)]",
};

const PADDING_CLASS_NAMES: Record<SurfacePanelPadding, string> = {
  none: "",
  sm: "p-2",
  md: "p-3",
  lg: "p-4",
};

const SurfacePanel = forwardRef<HTMLDivElement, SurfacePanelProps>(function SurfacePanel(
  { className, tone = "default", padding = "md", ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("rounded-xl border", TONE_CLASS_NAMES[tone], PADDING_CLASS_NAMES[padding], className)}
      {...props}
    />
  );
});

export default SurfacePanel;
