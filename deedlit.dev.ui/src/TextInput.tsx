"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

import { cn, SPACING_PATTERNS } from "./utils";

export type TextInputSize = "sm" | "md";

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  controlSize?: TextInputSize;
};

const BASE_CLASS_NAME = "cyber-input outline-none";

const SIZE_CLASS_NAMES: Record<TextInputSize, string> = {
  sm: cn("rounded-lg", SPACING_PATTERNS.controlSm, "text-ui-xs"),
  md: cn("rounded-xl", SPACING_PATTERNS.controlMd, "text-ui-sm"),
};

const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, controlSize = "md", ...props },
  ref,
) {
  return <input ref={ref} className={cn(BASE_CLASS_NAME, SIZE_CLASS_NAMES[controlSize], className)} {...props} />;
});

export default TextInput;
