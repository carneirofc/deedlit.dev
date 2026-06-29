"use client";

// The directory picker now lives in the shared UI package. Re-exported here so
// existing `@/components/DirectoryPicker` imports keep working.
export { DirectoryPicker, DirectoryPicker as default } from "@deedlit.dev/ui";
export type { DirectoryPickerProps } from "@deedlit.dev/ui";
