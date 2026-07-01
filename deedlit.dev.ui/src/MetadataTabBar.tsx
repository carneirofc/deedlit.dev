"use client";

import { Tabs, TabsList, TabsTrigger } from "./Tabs";
import { cn } from "./utils";

export type MetadataTabValue = "details" | "workflow" | "raw";

export type MetadataTabBarProps = {
  value: MetadataTabValue;
  onValueChange: (value: MetadataTabValue) => void;
  className?: string;
  optionClassName?: string;
};

const TAB_OPTIONS: Array<{ value: MetadataTabValue; label: string }> = [
  { value: "details", label: "Details" },
  { value: "workflow", label: "Workflow" },
  { value: "raw", label: "Raw Metadata" },
];

/**
 * Metadata tab bar built on the accessible {@link Tabs} primitives (roving
 * focus, arrow-key navigation, `role="tablist"`). Renders the tab strip only;
 * pair the controlled `value` with your own panels, or use the `Tabs`/
 * `TabsContent` primitives directly for fully linked `aria-controls` panels.
 */
export default function MetadataTabBar({
  value,
  onValueChange,
  className,
  optionClassName,
}: MetadataTabBarProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(next as MetadataTabValue)}
      className={cn("sticky top-0 z-10 w-full backdrop-blur", className)}
    >
      <TabsList className="w-full">
        {TAB_OPTIONS.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            data-testid={`metadata-tab-${option.value}`}
            className={cn("flex-1 py-1.5 text-ui-xs font-semibold", optionClassName)}
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
