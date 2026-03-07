import type { EndpointHealth } from "../admin-types";

import { InfoChip, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@deedlit.dev/ui";
import { toFriendlyDate } from "@/lib/format-utils";

import { StatusText } from "./DebugField";
import DebugSection from "./DebugSection";

export type ApiHealthSectionProps = {
  healthyEndpointCount: number;
  failedEndpointCount: number;
  healthCheckedAt: string | null;
  healthChecks: EndpointHealth[];
};

function EndpointStatus({ entry }: { entry: EndpointHealth }) {
  if (entry.ok === null) return <StatusText color="warning">pending</StatusText>;
  if (entry.ok) return <StatusText color="success">ok ({entry.status ?? "n/a"})</StatusText>;
  return (
    <StatusText color="danger">
      fail ({entry.status ?? "n/a"}){entry.error ? `: ${entry.error}` : ""}
    </StatusText>
  );
}

export default function ApiHealthSection({
  healthyEndpointCount,
  failedEndpointCount,
  healthCheckedAt,
  healthChecks,
}: ApiHealthSectionProps) {
  return (
    <DebugSection title="API Health">
      <div className="mt-2 flex flex-wrap gap-2 text-ui-2xs text-[color:var(--ui-ink-note)]">
        <InfoChip className="border border-success-edge bg-success px-2 py-0.5">
          Healthy endpoints: {healthyEndpointCount}
        </InfoChip>
        <InfoChip className="border border-error-edge bg-error px-2 py-0.5">
          Failed endpoints: {failedEndpointCount}
        </InfoChip>
        <InfoChip className="border border-[color:var(--ui-border)] bg-[color:var(--ui-bg)] px-2 py-0.5">
          Last check: {healthCheckedAt ? toFriendlyDate(healthCheckedAt) : "never"}
        </InfoChip>
      </div>
      <div className="mt-2 overflow-auto rounded-md border border-[color:var(--ui-border-subtle)]">
        <Table className="text-ui-2xs text-[color:var(--ui-ink-secondary)]">
          <TableHeader className="text-[color:var(--ui-ink-subtle)]">
            <TableRow className="border-t-0">
              <TableHead className="px-2 py-1">Endpoint</TableHead>
              <TableHead className="px-2 py-1">Status</TableHead>
              <TableHead className="px-2 py-1">Latency</TableHead>
              <TableHead className="px-2 py-1">Checked</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {healthChecks.map((entry) => (
              <TableRow key={entry.id} className="border-t border-[color:var(--ui-border-faintest)]">
                <TableCell className="px-2 py-1 font-medium">{entry.path}</TableCell>
                <TableCell className="px-2 py-1">
                  <EndpointStatus entry={entry} />
                </TableCell>
                <TableCell className="px-2 py-1">
                  {entry.latencyMs !== null ? `${entry.latencyMs} ms` : "n/a"}
                </TableCell>
                <TableCell className="px-2 py-1">{entry.checkedAt ? toFriendlyDate(entry.checkedAt) : "n/a"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </DebugSection>
  );
}




