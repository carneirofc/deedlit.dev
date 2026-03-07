"use client";

import { forwardRef, type SelectHTMLAttributes } from "react";

import { cn, SPACING_PATTERNS } from "./utils";

export type SelectInputSize = "sm" | "md";

export type SelectInputProps = SelectHTMLAttributes<HTMLSelectElement> & {
  controlSize?: SelectInputSize;
};

const BASE_CLASS_NAME = "cyber-input outline-none";

const SIZE_CLASS_NAMES: Record<SelectInputSize, string> = {
  sm: cn("rounded-lg", SPACING_PATTERNS.controlSm, "text-ui-xs"),
  md: cn("rounded-xl", SPACING_PATTERNS.controlMd, "text-ui-sm"),
};

const SelectInput = forwardRef<HTMLSelectElement, SelectInputProps>(function SelectInput(
  { className, controlSize = "md", ...props },
  ref,
) {
  return <select ref={ref} className={cn(BASE_CLASS_NAME, SIZE_CLASS_NAMES[controlSize], className)} {...props} />;
});

export default SelectInput;
