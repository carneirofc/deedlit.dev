"use client";

import { forwardRef, type ReactNode } from "react";

import { cn } from "./utils";

export type PanelSectionHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  actionsClassName?: string;
};

const PanelSectionHeader = forwardRef<HTMLDivElement, PanelSectionHeaderProps>(
  function PanelSectionHeader(
    { title, description, actions, className, titleClassName, descriptionClassName, actionsClassName },
    ref,
  ) {
    return (
      <div ref={ref} className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
        <div>
          <p
            className={cn(
              "ui-text-label-sm text-(--ui-ink-accent)",
              titleClassName,
            )}
          >
            {title}
          </p>
          {description && (
            <p className={cn("mt-1 text-ui-xs text-[color:var(--ui-ink-subtle)]", descriptionClassName)}>
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className={cn("flex flex-wrap items-center gap-2", actionsClassName)}>{actions}</div>
        )}
      </div>
    );
  },
);

export default PanelSectionHeader;


