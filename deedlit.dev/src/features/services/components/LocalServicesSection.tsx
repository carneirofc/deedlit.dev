"use client";

import { useMemo, useState } from "react";
import {
  FiImage,
  FiMessageSquare,
  FiBarChart2,
  FiShare2,
  FiSearch,
  FiFolder,
  FiLock,
  FiRefreshCw,
  FiLink,
  FiExternalLink,
} from "react-icons/fi";
import {
  CopyIcon,
  OutlineButton,
  SectionLabel,
  StatusBadge,
  SurfacePanel,
  TextInput,
} from "@deedlit.dev/ui";
import type { LocalServiceApp, ServiceIcon } from "@/features/services/types";
import { useServiceAccessibility } from "@/features/services/hooks/useServiceAccessibility";

interface LocalServicesSectionProps {
  apps: LocalServiceApp[];
}

function ServiceGlyph({ icon }: { icon: ServiceIcon }) {
  const props = { size: 20, "aria-hidden": true as const, strokeWidth: 1.8 };
  switch (icon) {
    case "gallery": return <FiImage {...props} />;
    case "prompt": return <FiMessageSquare {...props} />;
    case "metrics": return <FiBarChart2 {...props} />;
    case "comfyui": return <FiShare2 {...props} />;
    case "searnime": return <FiSearch {...props} />;
    case "files": return <FiFolder {...props} />;
    case "idp": return <FiLock {...props} />;
    default: return null;
  }
}

export function LocalServicesSection({ apps }: LocalServicesSectionProps) {
  const [query, setQuery] = useState("");
  const [copyState, setCopyState] = useState("");
  const { accessibility, isChecking, checkAllServices } = useServiceAccessibility(apps);

  const filteredApps = useMemo(() => {
    const q = query.trim().toLowerCase();

    return apps.filter((app) => {
      if (!q) return true;
      return `${app.name} ${app.host} ${app.category} ${app.description}`
        .toLowerCase()
        .includes(q);
    });
  }, [apps, query]);

  const copyValue = async (value: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(`Copied: ${value}`);
      setTimeout(() => setCopyState(""), 2000);
    } catch {
      setCopyState("Copy unavailable");
      setTimeout(() => setCopyState(""), 2000);
    }
  };

  return (
    <section id="services" className="section-anchor mx-auto max-w-7xl px-4 pb-16 pt-10 sm:px-6 lg:px-8">
      <div className="mb-5">
        <SectionLabel>Services Hub</SectionLabel>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Quick Access</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Click any service to open. All services hosted under deedlit.dev domain.
        </p>
      </div>

      <SurfacePanel tone="soft" padding="lg" className="mb-5">
        <label htmlFor="service-search" className="mb-1 block text-xs text-muted">
          Search
        </label>
        <TextInput
          id="service-search"
          type="search"
          controlSize="sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="name, host, category"
          className="w-full"
        />
      </SurfacePanel>

      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-muted" aria-live="polite">
          {filteredApps.length}/{apps.length} services
          {isChecking && <span className="ml-2 animate-pulse">· Checking accessibility...</span>}
        </p>
        <div className="flex items-center gap-3">
          {copyState && (
            <p className="text-xs text-emerald-400" aria-live="polite">
              {copyState}
            </p>
          )}
          <OutlineButton
            type="button"
            controlSize="xs"
            onClick={checkAllServices}
            disabled={isChecking}
            title="Refresh accessibility check"
          >
            <FiRefreshCw className={`h-3.5 w-3.5 ${isChecking ? 'animate-spin' : ''}`} />
            Refresh
          </OutlineButton>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredApps.map((app) => {
          const accessInfo = accessibility[app.id];
          const isAccessible = accessInfo?.status === "accessible";
          const isCheckingService = !accessInfo || accessInfo?.status === "checking";
          const isUnreachable = accessInfo?.status === "unreachable";

          return (
            <a
              key={app.id}
              href={app.url}
              target="_blank"
              rel="noreferrer"
              className={`focus-ring group relative block overflow-hidden rounded-xl2 border shadow-soft transition-all duration-200 ${isAccessible
                  ? "border-line/80 bg-surface/75 hover:border-accent/50 hover:bg-surface hover:shadow-md"
                  : isUnreachable
                    ? "border-line/40 bg-surface/30 opacity-60"
                    : "border-line/80 bg-surface/75"
                }`}
            >
              {/* Status indicator bar */}
              <div className={`h-1 ${isCheckingService
                  ? "bg-blue-500/40 animate-pulse"
                  : isAccessible
                    ? "bg-emerald-500/40"
                    : "bg-rose-500/40"
                }`} />

              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors ${isAccessible
                        ? "border-line/80 bg-base/70 text-muted group-hover:border-accent/50 group-hover:bg-accent/10 group-hover:text-accent"
                        : "border-line/40 bg-base/40 text-muted/50"
                      }`}>
                      <span className="h-5 w-5 flex items-center justify-center">
                        <ServiceGlyph icon={app.icon} />
                      </span>
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold tracking-tight group-hover:text-accent transition-colors">
                        {app.name}
                      </h3>
                      <p className="mt-1 text-xs text-muted line-clamp-2">{app.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <StatusBadge
                      tone={
                        isCheckingService ? "neutral" : isAccessible ? "success" : "error"
                      }
                      className={isCheckingService ? "animate-pulse" : undefined}
                    >
                      {isCheckingService ? "checking" : isAccessible ? "accessible" : "unreachable"}
                    </StatusBadge>
                    {accessInfo?.responseTime && (
                      <span className="text-[9px] text-muted/60">
                        {accessInfo.responseTime}ms
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="font-[var(--font-mono)] text-[11px] text-muted/80 truncate">
                    {app.host}
                  </p>
                  <div className="flex gap-1.5 shrink-0">
                    <OutlineButton
                      type="button"
                      controlSize="icon"
                      onClick={(e) => copyValue(app.host, e)}
                      title="Copy hostname"
                      aria-label="Copy hostname"
                    >
                      <CopyIcon size="h-3.5 w-3.5" />
                    </OutlineButton>
                    <OutlineButton
                      type="button"
                      controlSize="icon"
                      onClick={(e) => copyValue(app.url, e)}
                      title="Copy URL"
                      aria-label="Copy URL"
                    >
                      <FiLink className="h-3.5 w-3.5" />
                    </OutlineButton>
                  </div>
                </div>

                {/* Hover indicator */}
                {isAccessible && !isCheckingService && (
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100">
                    <span>Open service</span>
                    <FiExternalLink className="h-3 w-3" />
                  </div>
                )}
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

