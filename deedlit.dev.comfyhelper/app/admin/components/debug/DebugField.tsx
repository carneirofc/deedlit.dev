import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StatusColor = "success" | "warning" | "danger" | "neutral";

type DebugFieldProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

type StatusTextProps = {
  color: StatusColor;
  children: ReactNode;
  className?: string;
};

const statusClasses: Record<StatusColor, string> = {
  success: "text-emerald-700",
  warning: "text-amber-700",
  danger: "text-rose-700",
  neutral: "",
};

export function StatusText({ color, children, className }: StatusTextProps) {
  return <span className={cn("font-semibold", statusClasses[color], className)}>{children}</span>;
}

export function DebugField({ label, children, className }: DebugFieldProps) {
  return (
    <p className={className}>
      {label}: {children}
    </p>
  );
}

type DebugFieldGridProps = {
  children: ReactNode;
  columns?: 1 | 2;
  className?: string;
};

export function DebugFieldGrid({ children, columns = 2, className }: DebugFieldGridProps) {
  return (
    <div
      className={cn(
        "mt-2 grid gap-1 text-ui-xs text-[color:var(--ui-ink-secondary)]",
        columns === 2 && "sm:grid-cols-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

