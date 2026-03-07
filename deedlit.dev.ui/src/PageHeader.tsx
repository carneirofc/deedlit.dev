"use client";

import { forwardRef, type ReactNode } from "react";

import { cn } from "./utils";

export type PageHeaderProps = {
  /** Subtitle shown above the title (e.g. "deedlit.dev // gallery") */
  subtitle: string;
  /** Main heading */
  title: string;
  /** Heading tag used for title text */
  titleTag?: "h1" | "h2";
  /** Description paragraph below title */
  description: string;
  /** Optional id and data-testid for the header element */
  testId?: string;
  /** Optional class name for the root header container */
  className?: string;
  /** Optional summary pills rendered on the right */
  pills?: ReactNode;
  /** Optional class name for the pill container */
  pillsClassName?: string;
  /** Optional children rendered after the header */
  children?: ReactNode;
};

const PageHeader = forwardRef<HTMLElement, PageHeaderProps>(function PageHeader(
  { subtitle, title, titleTag = "h1", description, testId, className, pills, pillsClassName, children },
  ref,
) {
  const TitleTag = titleTag;

  return (
    <header
      ref={ref}
      id={testId}
      data-testid={testId}
      className={cn("flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4", className)}
    >
      <div>
        <p className="text-ui-xs uppercase tracking-[0.24em] text-[color:color-mix(in_oklab,var(--accent-cyan)_55%,var(--accent-pink)_45%)]">
          {subtitle}
        </p>
        <TitleTag className="cyber-title mt-2 text-ui-display font-semibold">{title}</TitleTag>
        <p className="cyber-muted mt-2 max-w-3xl text-ui-md">{description}</p>
      </div>
      {pills && (
        <div className={cn("cyber-muted flex flex-wrap items-center gap-2 text-ui-sm", pillsClassName)}>
          {pills}
        </div>
      )}
      {children}
    </header>
  );
});

PageHeader.displayName = "PageHeader";

export default PageHeader;


