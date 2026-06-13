"use client";

import { useState } from "react";

import { FolderIcon } from "@deedlit.dev/ui";

import { DirectoryPicker } from "@/components/DirectoryPicker";

export interface PathInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called when Enter is pressed in the text field (e.g. submit the form). */
  onEnter?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Class for the outer flex wrapper (use to size it within a row). */
  className?: string;
  /** Class for the text input — pass the page's existing input styling. */
  inputClassName?: string;
  /** Class for the Browse button — pass the page's existing button styling. */
  buttonClassName?: string;
  pickerTitle?: string;
  inputTestId?: string;
  buttonTestId?: string;
}

/**
 * A text input for a server-side filesystem path paired with a "Browse" button
 * that opens the {@link DirectoryPicker}.  The text field stays fully editable
 * (type/paste a path) while the picker offers point-and-click navigation.
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
}: PathInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className={`flex gap-2 ${className ?? ""}`}>
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

      <DirectoryPicker
        open={pickerOpen}
        initialPath={value}
        title={pickerTitle}
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
