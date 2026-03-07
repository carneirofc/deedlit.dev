"use client";

import { StatusBanner, SectionLabel, KeyValueField, PromptBlock } from "@deedlit.dev/ui";
import type { GenerationDetails } from "@/lib/gallery-types";

type DetailsTabContentProps = {
  details: GenerationDetails;
  isLoading: boolean;
  error: string | null;
  copiedPrompt: "positive" | "negative" | null;
  onPromptCopy: (kind: "positive" | "negative", value: string) => Promise<void>;
};

const DETAIL_FIELDS: { label: string; key: keyof GenerationDetails }[] = [
  { label: "Model", key: "model" },
  { label: "Sampler", key: "sampler" },
  { label: "Scheduler", key: "scheduler" },
  { label: "CFG Scale", key: "cfgScale" },
  { label: "Steps", key: "steps" },
  { label: "Seed", key: "seed" },
  { label: "Size", key: "size" },
];

export default function DetailsTabContent({
  details,
  isLoading,
  error,
  copiedPrompt,
  onPromptCopy,
}: DetailsTabContentProps) {
  const visibleFields = DETAIL_FIELDS.filter(
    (entry) => Boolean(details[entry.key]),
  );

  return (
    <div className="space-y-4">
      {isLoading && <StatusBanner tone="loading">Loading full metadata...</StatusBanner>}
      {error && <StatusBanner tone="error">{error}</StatusBanner>}

      <div className="grid grid-cols-2 gap-2 text-ui-sm">
        {visibleFields.map((entry) => (
          <KeyValueField
            key={entry.label}
            label={entry.label}
            value={details[entry.key] as string}
          />
        ))}
      </div>

      {details.positivePrompt && (
        <PromptBlock
          label="Positive Prompt"
          tone="positive"
          copied={copiedPrompt === "positive"}
          onCopy={() => void onPromptCopy("positive", details.positivePrompt!)}
        >
          {details.positivePrompt}
        </PromptBlock>
      )}

      {details.negativePrompt && (
        <PromptBlock
          label="Negative Prompt"
          tone="negative"
          copied={copiedPrompt === "negative"}
          onCopy={() => void onPromptCopy("negative", details.negativePrompt!)}
        >
          {details.negativePrompt}
        </PromptBlock>
      )}

      {details.additional.length > 0 && (
        <section>
          <SectionLabel>Additional</SectionLabel>
          <div className="mt-2 space-y-2">
            {details.additional.map((entry) => (
              <KeyValueField key={entry.label} label={entry.label} value={entry.value} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}




