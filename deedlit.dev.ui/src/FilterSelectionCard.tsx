"use client";

import { forwardRef, type ReactNode } from "react";

import OutlineButton from "./OutlineButton";
import { cn } from "./utils";

export type FilterSelectionCardProps = {
  title: ReactNode;
  items: string[];
  onRemoveItem: (item: string) => void;
  emptyLabel?: ReactNode;
  testId?: string;
  className?: string;
  titleClassName?: string;
  emptyClassName?: string;
  listClassName?: string;
  chipClassName?: string;
  itemLabelClassName?: string;
  removeIconClassName?: string;
  removeTitlePrefix?: string;
};

const DEFAULT_CHIP_CLASS =
  "inline-flex max-w-full items-center gap-1 rounded-full border-ui-active bg-[color:var(--ui-bg-active)] px-1.5 py-0 my-0.5 text-ui-2xs text-[color:var(--ui-ink-highlight)]";

const FilterSelectionCard = forwardRef<HTMLDivElement, FilterSelectionCardProps>(function FilterSelectionCard({
  title,
  items,
  onRemoveItem,
  emptyLabel = "None",
  testId,
  className,
  titleClassName,
  emptyClassName,
  listClassName,
  chipClassName,
  itemLabelClassName,
  removeIconClassName,
  removeTitlePrefix = "Remove",
}, ref) {
  return (
    <div
      ref={ref}
      id={testId}
      data-testid={testId}
      className={cn(
        "rounded-lg border border-(--ui-border-soft) bg-panel/75 p-1.5",
        className,
      )}
    >
      <p
        className={cn(
          "text-ui-2xs tracking-[0.1em] text-(--ui-ink-faint)",
          titleClassName,
        )}
      >
        {title}
      </p>
      {items.length === 0 ? (
        <p
          className={cn(
            "mt-1 text-ui-2xs tracking-[0.08em] text-ui-ink-subtle",
            emptyClassName,
          )}
        >
          {emptyLabel}
        </p>
      ) : (
        <div
          className={cn(
            "mt-1 flex max-h-14 flex-wrap gap-1 overflow-x-hidden overflow-y-auto",
            listClassName,
          )}
        >
          {items.map((item, index) => (
            <OutlineButton
              key={`${item}-${index}`}
              onClick={() => onRemoveItem(item)}
              className={cn(DEFAULT_CHIP_CLASS, chipClassName)}
              title={`${removeTitlePrefix}: ${item}`}
            >
              <span className={cn("max-w-[180px] truncate", itemLabelClassName)}>{item}</span>
              <span aria-hidden className={removeIconClassName}>
                ×
              </span>
            </OutlineButton>
          ))}
        </div>
      )}
    </div>
  );
});

FilterSelectionCard.displayName = "FilterSelectionCard";

export default FilterSelectionCard;
