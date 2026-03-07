import type { z } from "zod";

import type {
  AppSettingsSchema,
  ImageRecordSchema,
  PromptStatisticsSchema,
  PromptSummarySchema,
  RootDirectorySchema,
  ScanJobInfoSchema,
  ScanJobStatusSchema,
  ScanResultSchema,
  TagMetricSchema,
} from "@/lib/contracts/domain";

export type RootDirectory = z.infer<typeof RootDirectorySchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type TagFilterPreset = AppSettings["tagFilterPresets"][number];
export type PromptSummary = z.infer<typeof PromptSummarySchema>;
export type ImageRecord = z.infer<typeof ImageRecordSchema>;
export type ScanResult = z.infer<typeof ScanResultSchema>;
export type TagMetric = z.infer<typeof TagMetricSchema>;
export type PromptStatistics = z.infer<typeof PromptStatisticsSchema>;
export type ScanJobStatus = z.infer<typeof ScanJobStatusSchema>;
export type ScanJobInfo = z.infer<typeof ScanJobInfoSchema>;
