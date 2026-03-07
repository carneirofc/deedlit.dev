"use client";

import { StatusBanner, CodeBlock, MetadataInfoBlock } from "@deedlit.dev/ui";
import { stringifyMetadata } from "@/lib/format-utils";

type RawMetadataTabContentProps = {
  metadataSource?: string;
  metadataPath?: string;
  metadata: unknown;
  isLoading: boolean;
  error: string | null;
};

export default function RawMetadataTabContent({
  metadataSource,
  metadataPath,
  metadata,
  isLoading,
  error,
}: RawMetadataTabContentProps) {
  return (
    <div className="space-y-3">
      {isLoading && <StatusBanner tone="loading">Loading full metadata...</StatusBanner>}
      {error && <StatusBanner tone="error">{error}</StatusBanner>}

      <MetadataInfoBlock>
        {metadataSource && <p>Metadata source: {metadataSource}</p>}
        {metadataPath && <p className="mt-1 break-all">Metadata path: {metadataPath}</p>}
      </MetadataInfoBlock>
      <CodeBlock>
        {isLoading ? "Loading metadata..." : stringifyMetadata(metadata ?? null)}
      </CodeBlock>
    </div>
  );
}



