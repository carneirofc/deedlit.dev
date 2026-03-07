"use client";

import { forwardRef, type HTMLAttributes } from "react";

import OutlineButton from "./OutlineButton";
import { cn, LAYOUT_PATTERNS } from "./utils";

export type PaginationProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  page: number;
  totalPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  disabled?: boolean;
  prevLabel?: string;
  nextLabel?: string;
  testIdPrefix?: string;
};

const Pagination = forwardRef<HTMLDivElement, PaginationProps>(
  function Pagination(
    {
      page,
      totalPages,
      onPrevPage,
      onNextPage,
      disabled = false,
      prevLabel = "Previous",
      nextLabel = "Next",
      testIdPrefix,
      className,
      ...props
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(LAYOUT_PATTERNS.flexCenterBetweenGap2, className)}
        {...props}
      >
        <OutlineButton
          onClick={onPrevPage}
          disabled={page <= 1 || disabled}
          data-testid={testIdPrefix ? `${testIdPrefix}-prev-page-button` : undefined}
        >
          {prevLabel}
        </OutlineButton>
        <p className="text-ui-xs text-[color:var(--ui-ink-subtle)]">
          Page {page} of {totalPages}
        </p>
        <OutlineButton
          onClick={onNextPage}
          disabled={page >= totalPages || disabled}
          data-testid={testIdPrefix ? `${testIdPrefix}-next-page-button` : undefined}
        >
          {nextLabel}
        </OutlineButton>
      </div>
    );
  },
);

Pagination.displayName = "Pagination";

export default Pagination;
