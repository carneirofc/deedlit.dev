"use client";

import Link from "next/link";
import { CompareTrayBar as UiCompareTrayBar } from "@carneirofc/ui";

import { useCompareTray } from "@/lib/store/compare-tray";

/**
 * Comfyhelper adapter over the shared `CompareTrayBar`: wires the compare-tray
 * store, the library thumbnail endpoint, and a client-side `Link` to
 * `/library/compare`. The sidebar offset (`md:pl-24`) clears the app rail.
 */
export function CompareTrayBar() {
  const tray = useCompareTray();

  return (
    <UiCompareTrayBar
      items={tray.ids.map((id) => ({ id, thumbnailUrl: `/api/library/images/${id}/thumbnail` }))}
      max={tray.max}
      onRemove={tray.remove}
      onClear={tray.clear}
      className="md:pl-24"
      renderCompareAction={({ className, disabled, count }) => (
        <Link
          href={`/library/compare?ids=${tray.ids.join(",")}`}
          prefetch={false}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : undefined}
          className={className}
        >
          Compare {count}
        </Link>
      )}
    />
  );
}
