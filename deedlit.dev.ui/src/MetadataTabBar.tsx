"use client";

import SegmentedControl, { type SegmentedControlOption } from "./SegmentedControl";
import { cn } from "./utils";

export type MetadataTabValue = "details" | "workflow" | "raw";

export type MetadataTabBarProps = {
  value: MetadataTabValue;
  onValueChange: (value: MetadataTabValue) => void;
  className?: string;
  optionClassName?: string;
};

const TAB_OPTIONS: SegmentedControlOption<MetadataTabValue>[] = [
  { value: "details", label: "Details" },
  { value: "workflow", label: "Workflow" },
  { value: "raw", label: "Raw Metadata" },
];

export default function MetadataTabBar({
  value,
  onValueChange,
  className,
  optionClassName,
}: MetadataTabBarProps) {
  return (
    <SegmentedControl<MetadataTabValue>
      value={value}
      options={TAB_OPTIONS}
      onValueChange={onValueChange}
      className={cn("sticky top-0 z-10 w-full backdrop-blur", className)}
      optionClassName={cn("flex-1 py-1.5 text-ui-xs font-semibold", optionClassName)}
    />
  );
}
