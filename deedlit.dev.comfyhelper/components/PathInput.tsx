"use client";

import { PathInput as UiPathInput } from "@deedlit.dev/ui";

import { hasMixedSeparators, isAlreadyConfigured } from "@/lib/library/paths";
import { usePathPreview } from "@/lib/library/use-path-preview";

export interface PathInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called when Enter is pressed in the text field (e.g. submit the form). */
  onEnter?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Class for the outer wrapper (use to size it within a row). */
  className?: string;
  /** Class for the text input — pass the page's existing input styling. */
  inputClassName?: string;
  /** Class for the Browse button — pass the page's existing button styling. */
  buttonClassName?: string;
  pickerTitle?: string;
  inputTestId?: string;
  buttonTestId?: string;
  /**
   * Show a live validation/preview line under the field: whether the path is a
   * real directory, how many images/sub-folders are in it, and mismatch/dupe
   * warnings. Off by default so unrelated callers are unaffected.
   */
  showPreview?: boolean;
  /**
   * Already-configured source-folder paths. When provided (with showPreview),
   * a path that matches one is flagged as a duplicate before submit.
   */
  knownPaths?: readonly string[];
}

/** The live validation/preview line shown under the field when enabled. */
function PathPreviewLine({
  value,
  knownPaths,
}: {
  value: string;
  knownPaths?: readonly string[];
}) {
  const preview = usePathPreview(value);
  const trimmed = value.trim();
  if (!trimmed) return null;

  const duplicate = knownPaths ? isAlreadyConfigured(value, knownPaths) : false;
  const mixed = hasMixedSeparators(trimmed);

  return (
    <div className="flex flex-col gap-0.5 text-ui-2xs" data-testid="path-preview">
      {preview.state === "checking" && <span className="text-ui-ink-muted">Checking path…</span>}

      {preview.state === "invalid" && (
        <span className="text-rose-500" data-testid="path-preview-invalid">
          ✗ {preview.error}
        </span>
      )}

      {preview.state === "valid" && (
        <span className="text-emerald-500" data-testid="path-preview-valid">
          ✓ {preview.imageCount} image{preview.imageCount === 1 ? "" : "s"}
          {preview.subdirCount > 0
            ? ` · ${preview.subdirCount} sub-folder${preview.subdirCount === 1 ? "" : "s"}`
            : ""}{" "}
          here
        </span>
      )}

      {duplicate && (
        <span className="text-amber-500" data-testid="path-preview-duplicate">
          ⚠ Already a configured source folder.
        </span>
      )}

      {mixed && (
        <span className="text-amber-500" data-testid="path-preview-mixed">
          ⚠ Path mixes “\” and “/” separators — check it is correct.
        </span>
      )}
    </div>
  );
}

/**
 * App adapter over the shared {@link UiPathInput}. Adds comfyhelper's live path
 * validation (via {@link usePathPreview}) as the package component's `preview`
 * slot, keeping filesystem/API coupling out of the shared package.
 */
export function PathInput({ showPreview, knownPaths, ...rest }: PathInputProps) {
  return (
    <UiPathInput
      {...rest}
      preview={showPreview ? <PathPreviewLine value={rest.value} knownPaths={knownPaths} /> : undefined}
    />
  );
}

export default PathInput;
