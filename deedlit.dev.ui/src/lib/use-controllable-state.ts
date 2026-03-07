import { useState, useCallback } from "react";

/**
 * Encapsulates the controlled / uncontrolled component pattern.
 *
 * When the caller supplies `value` the hook delegates entirely to the
 * external owner (controlled mode). Otherwise it falls back to an
 * internal `useState` seeded with `defaultValue` (uncontrolled mode).
 *
 * Returns `[currentValue, setValue]` — safe to call unconditionally.
 */
export function useControllableState<T>(options: {
  value?: T;
  defaultValue: T;
  onChange?: (next: T) => void;
}): [T, (next: T | ((prev: T) => T)) => void] {
  const { value: controlledValue, defaultValue, onChange } = options;
  const isControlled = controlledValue !== undefined;

  const [internal, setInternal] = useState(defaultValue);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      if (isControlled) {
        // In controlled mode, resolve the updater and notify the owner.
        const resolved =
          typeof next === "function"
            ? (next as (prev: T) => T)(controlledValue as T)
            : next;
        onChange?.(resolved);
      } else {
        setInternal(next);
      }
    },
    [isControlled, controlledValue, onChange],
  );

  return [isControlled ? (controlledValue as T) : internal, setValue];
}
