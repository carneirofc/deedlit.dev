"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn, SPACING_PATTERNS } from "./utils";

export type CyberPanelProps = ComponentPropsWithoutRef<"section">;
export type CyberSubpanelProps = ComponentPropsWithoutRef<"div">;

export const CyberPanel = forwardRef<HTMLElement, CyberPanelProps>(function CyberPanel(
  { className, ...props },
  ref,
) {
  return (
    <section
      ref={ref}
      className={cn("cyber-panel rounded-[28px]", SPACING_PATTERNS.panelLarge, className)}
      {...props}
    />
  );
});

CyberPanel.displayName = "CyberPanel";

export const CyberSubpanel = forwardRef<HTMLDivElement, CyberSubpanelProps>(function CyberSubpanel(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("cyber-subpanel rounded-2xl", SPACING_PATTERNS.panelStandard, className)}
      {...props}
    />
  );
});

CyberSubpanel.displayName = "CyberSubpanel";
