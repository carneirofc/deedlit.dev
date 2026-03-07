import type { ReactNode } from "react";

import { SurfacePanel } from "@deedlit.dev/ui";

type DebugSectionProps = {
  title: string;
  children: ReactNode;
  className?: string;
};

export default function DebugSection({ title, children, className }: DebugSectionProps) {
  return (
    <SurfacePanel tone="soft" className={className} padding="md">
      <p className="ui-text-label text-[color:var(--ui-ink-muted)]">
        {title}
      </p>
      {children}
    </SurfacePanel>
  );
}



