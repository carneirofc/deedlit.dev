export { ActivityDock, ActivityToasts } from "./ActivityDock";
export { default as ConfirmationDialog } from "./ConfirmationDialog";
export { default as CollapsiblePanel } from "./CollapsiblePanel";
export { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./Collapsible";
export { default as CodeBlock } from "./CodeBlock";
export { default as CopyButton } from "./CopyButton";
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "./Dialog";
export { default as DirectoryPicker, DEFAULT_FS_BROWSE_ENDPOINT } from "./DirectoryPicker";
export { default as DockPanel } from "./DockPanel";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
} from "./DropdownMenu";
export { default as PathInput } from "./PathInput";
export { default as EmptyState } from "./EmptyState";
export { default as Gallery } from "./Gallery";
export { default as InfoChip } from "./InfoChip";
export { default as FilterSelectionCard } from "./FilterSelectionCard";
export { CompareTrayBar } from "./CompareTrayBar";
export { CyberPanel, CyberSubpanel } from "./CyberPanels";
export { default as KeyValueField } from "./KeyValueField";
export { default as MediaStage } from "./MediaStage";
export { default as MetadataTabBar } from "./MetadataTabBar";
export { default as MetadataInfoBlock } from "./MetadataInfoBlock";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./Tabs";
export { default as OutlineButton } from "./OutlineButton";
export { default as PageHeader } from "./PageHeader";
export { default as Pagination } from "./Pagination";
export { default as PanelSectionHeader } from "./PanelSectionHeader";
export { default as PromptBlock } from "./PromptBlock";
export { default as ScanProgress, DEFAULT_SCAN_STAGE_LABELS } from "./ScanProgress";
export { default as SectionLabel } from "./SectionLabel";
export { default as SegmentedControl } from "./SegmentedControl";
export { default as SelectInput } from "./SelectInput";
export { default as StatusBanner } from "./StatusBanner";
export { default as StatusMessage } from "./StatusMessage";
export { default as StatusBadge } from "./StatusBadge";
export { default as SurfacePanel } from "./SurfacePanel";
export { default as TagSelect } from "./TagSelect";
export { default as ThemeToggleButton } from "./ThemeToggleButton";
export { default as Toast } from "./Toast";
export { default as TextAreaInput } from "./TextAreaInput";
export { default as TextInput } from "./TextInput";
export { default as WarningList } from "./WarningList";
export { default as Checkbox } from "./Checkbox";

// ── Styling utilities & variant recipes ──────────────────────────────
export { cn, SPACING_PATTERNS, LAYOUT_PATTERNS, BORDER_PATTERNS } from "./utils";
export { buttonVariants } from "./OutlineButton";
export { statusBadgeVariants } from "./StatusBadge";
export { statusBannerVariants } from "./StatusBanner";
export { emptyStateVariants } from "./EmptyState";
export { promptBlockTextVariants } from "./PromptBlock";
export { surfacePanelVariants } from "./SurfacePanel";
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./Table";

// ── Icons ────────────────────────────────────────────────────────────
export {
  HeartIcon,
  XIcon,
  TrashIcon,
  FolderIcon,
  FolderPlusIcon,
  DownloadIcon,
  CopyIcon,
  PlusIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentIcon,
  DocumentPlusIcon,
  ShuffleIcon,
  PlayIcon,
  PauseIcon,
  EditIcon,
} from "./Icons";

export type {
  Activity,
  ActivityStatus,
  ActivityProgress,
  ActivityDockProps,
  ActivityToastsProps,
} from "./ActivityDock";
export type { CodeBlockProps } from "./CodeBlock";
export type { ConfirmationDialogData, ConfirmationDialogProps } from "./ConfirmationDialog";
export type { CollapsiblePanelProps } from "./CollapsiblePanel";
export { useControllableState } from "./lib/use-controllable-state";
export type { CopyButtonProps } from "./CopyButton";
export type { DirectoryPickerProps } from "./DirectoryPicker";
export type { DockPanelProps, DockPanelSize } from "./DockPanel";
export type { DialogSize, DialogContentProps } from "./Dialog";
export type { PathInputProps } from "./PathInput";
export type { EmptyStateProps, EmptyStateTone } from "./EmptyState";
export type { GalleryProps, GalleryViewMode, GalleryItemContext } from "./Gallery";
export type { InfoChipProps } from "./InfoChip";
export type { FilterSelectionCardProps } from "./FilterSelectionCard";
export type { CompareTrayBarProps, CompareTrayItem } from "./CompareTrayBar";
export type { CyberPanelProps, CyberSubpanelProps } from "./CyberPanels";
export type { IconProps } from "./Icons";
export type { KeyValueFieldProps } from "./KeyValueField";
export type { MediaStageProps } from "./MediaStage";
export type { MetadataTabBarProps, MetadataTabValue } from "./MetadataTabBar";
export type { MetadataInfoBlockProps } from "./MetadataInfoBlock";
export type { OutlineButtonProps, OutlineButtonSize, OutlineButtonVariant } from "./OutlineButton";
export type { PageHeaderProps } from "./PageHeader";
export type { PaginationProps } from "./Pagination";
export type { PanelSectionHeaderProps } from "./PanelSectionHeader";
export type { PromptBlockProps, PromptBlockTone } from "./PromptBlock";
export type { ScanProgressProps } from "./ScanProgress";
export type { SectionLabelProps } from "./SectionLabel";
export type { SegmentedControlOption, SegmentedControlProps } from "./SegmentedControl";
export type { SelectInputProps, SelectInputSize } from "./SelectInput";
export type { StatusBannerProps, StatusBannerTone } from "./StatusBanner";
export type { StatusMessageProps, StatusTone } from "./StatusMessage";
export type { StatusBadgeProps, StatusBadgeTone } from "./StatusBadge";
export type { SurfacePanelProps, SurfacePanelTone, SurfacePanelPadding } from "./SurfacePanel";
export type { TagSelectProps } from "./TagSelect";
export type { ThemeToggleButtonProps, ThemeMode } from "./ThemeToggleButton";
export type { ToastProps, ToastRole, ToastTone } from "./Toast";
export type { TextAreaInputProps, TextAreaInputSize } from "./TextAreaInput";
export type { TextInputProps, TextInputSize } from "./TextInput";
export type { WarningListProps } from "./WarningList";
export type {
  TableBodyProps,
  TableCaptionProps,
  TableCellProps,
  TableFooterProps,
  TableHeadProps,
  TableHeaderProps,
  TableProps,
  TableRowProps,
} from "./Table";
