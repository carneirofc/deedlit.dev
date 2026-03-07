import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";

import { cn, SPACING_PATTERNS, BORDER_PATTERNS } from "./utils";

export type TableProps = ComponentPropsWithoutRef<"table">;
export type TableHeaderProps = ComponentPropsWithoutRef<"thead">;
export type TableBodyProps = ComponentPropsWithoutRef<"tbody">;
export type TableFooterProps = ComponentPropsWithoutRef<"tfoot">;
export type TableRowProps = ComponentPropsWithoutRef<"tr">;
export type TableHeadProps = ComponentPropsWithoutRef<"th">;
export type TableCellProps = ComponentPropsWithoutRef<"td">;
export type TableCaptionProps = ComponentPropsWithoutRef<"caption">;

const Table = forwardRef<ElementRef<"table">, TableProps>(function Table({ className, ...props }, ref) {
  return <table ref={ref} className={cn("min-w-full text-left text-ui-xs text-[color:var(--ui-ink-table)]", className)} {...props} />;
});

const TableHeader = forwardRef<ElementRef<"thead">, TableHeaderProps>(function TableHeader(
  { className, ...props },
  ref,
) {
  return (
    <thead
      ref={ref}
      className={cn(
        "bg-[color:var(--ui-bg-soft)] text-ui-xs uppercase tracking-[0.08em] text-[color:var(--ui-ink-muted)]",
        className,
      )}
      {...props}
    />
  );
});

const TableBody = forwardRef<ElementRef<"tbody">, TableBodyProps>(function TableBody(
  { className, ...props },
  ref,
) {
  return <tbody ref={ref} className={cn(className)} {...props} />;
});

const TableFooter = forwardRef<ElementRef<"tfoot">, TableFooterProps>(function TableFooter(
  { className, ...props },
  ref,
) {
  return (
    <tfoot
      ref={ref}
      className={cn(BORDER_PATTERNS.topFaint, "bg-[color:var(--ui-bg-soft)]", className)}
      {...props}
    />
  );
});

const TableRow = forwardRef<ElementRef<"tr">, TableRowProps>(function TableRow({ className, ...props }, ref) {
  return <tr ref={ref} className={cn(BORDER_PATTERNS.topFaint, className)} {...props} />;
});

const TableHead = forwardRef<ElementRef<"th">, TableHeadProps>(function TableHead({ className, ...props }, ref) {
  return <th ref={ref} className={cn(SPACING_PATTERNS.controlMd, "font-medium", className)} {...props} />;
});

const TableCell = forwardRef<ElementRef<"td">, TableCellProps>(function TableCell({ className, ...props }, ref) {
  return <td ref={ref} className={cn(SPACING_PATTERNS.controlMd, "align-middle", className)} {...props} />;
});

const TableCaption = forwardRef<ElementRef<"caption">, TableCaptionProps>(function TableCaption(
  { className, ...props },
  ref,
) {
  return <caption ref={ref} className={cn("mt-3 text-ui-xs text-[color:var(--ui-ink-subtle)]", className)} {...props} />;
});

Table.displayName = "Table";
TableHeader.displayName = "TableHeader";
TableBody.displayName = "TableBody";
TableFooter.displayName = "TableFooter";
TableRow.displayName = "TableRow";
TableHead.displayName = "TableHead";
TableCell.displayName = "TableCell";
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption };


