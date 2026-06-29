"use client";

import { type ReactNode, useState } from "react";

import DirectoryPicker from "./DirectoryPicker";
import { FolderIcon } from "./Icons";

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
   * Endpoint the {@link DirectoryPicker} browses. Defaults to the picker's own
   * default; pass to point at a different filesystem-browse route.
   */
  browseEndpoint?: string;
  /**
   * Optional content rendered under the field — e.g. a live validation/preview
   * line. Kept as a slot so the package stays free of app-specific data
   * fetching; consumers supply their own preview component.
   */
  preview?: ReactNode;
}

/**
 * A text input for a server-side filesystem path paired with a "Browse" button
 * that opens the {@link DirectoryPicker}. The text field stays fully editable
 * (type/paste a path) while the picker offers point-and-click navigation. Pass
 * `preview` to render a validation line beneath the field.
 */
export function PathInput({
  value,
  onChange,
  onEnter,
  placeholder,
  disabled,
  className,
  inputClassName,
  buttonClassName,
  pickerTitle,
  inputTestId,
  buttonTestId,
  browseEndpoint,
  preview,
}: PathInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <div className="flex gap-2">
        <input
          className={inputClassName}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && onEnter) onEnter();
          }}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          data-testid={inputTestId}
        />
        <button
          type="button"
          className={buttonClassName}
          onClick={() => setPickerOpen(true)}
          disabled={disabled}
          title="Browse folders"
          data-testid={buttonTestId}
        >
          <span className="inline-flex items-center gap-1.5">
            <FolderIcon className="h-4 w-4" />
            Browse
          </span>
        </button>
      </div>

      {preview}

      <DirectoryPicker
        open={pickerOpen}
        initialPath={value}
        title={pickerTitle}
        browseEndpoint={browseEndpoint}
        onClose={() => setPickerOpen(false)}
        onSelect={(path) => {
          onChange(path);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

export default PathInput;
