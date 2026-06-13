import type { ReactNode } from "react";

import { CompareTrayBar } from "@/app/library/components/CompareTrayBar";

/** Library section layout — mounts the global compare tray over every page. */
export default function LibraryLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <CompareTrayBar />
    </>
  );
}
