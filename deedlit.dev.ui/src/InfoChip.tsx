"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn, SPACING_PATTERNS } from "./utils";

export type InfoChipProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  testId?: string;
  "data-testid"?: string;
};

const InfoChip = forwardRef<HTMLSpanElement, InfoChipProps>(function InfoChip(
  { children, testId, className, "data-testid": dataTestId, ...props },
  ref,
) {
  const resolvedTestId = testId ?? dataTestId;

  return (
    <span
      ref={ref}
      data-testid={resolvedTestId}
      {...props}
      className={cn("cyber-chip rounded-full", SPACING_PATTERNS.chipStandard, className)}
    >
      {children}
    </span>
  );
});

InfoChip.displayName = "InfoChip";

export default InfoChip;
