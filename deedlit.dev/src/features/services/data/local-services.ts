import type { LocalServiceApp } from "@/features/services/types";

export const localServiceApps: LocalServiceApp[] = [
  {
    id: "gallery-admin",
    name: "Gallery Admin",
    host: "gallery.local.deedlit.dev",
    url: "https://gallery.local.deedlit.dev",
    description: "Review queue, tagging, and collection curation.",
    status: "online",
    category: "archive",
    icon: "gallery"
  },
  {
    id: "prompt-lab",
    name: "Prompt Lab",
    host: "prompts.local.deedlit.dev",
    url: "https://prompts.local.deedlit.dev",
    description: "Prompt presets, variants, and parameter templates.",
    status: "online",
    category: "workflow",
    icon: "prompt"
  },
  {
    id: "metrics",
    name: "Metrics",
    host: "metrics.local.deedlit.dev",
    url: "https://metrics.local.deedlit.dev",
    description: "Resource and latency dashboards.",
    status: "offline",
    category: "ops",
    icon: "metrics"
  },
  {
    id: "comfyui",
    name: "ComfyUI",
    host: "comfyui.local.deedlit.dev",
    url: "https://comfyui.local.deedlit.dev",
    description: "ComfyUI node editor and generation runtime.",
    status: "online",
    category: "workflow",
    icon: "comfyui"
  },
  {
    id: "seanime",
    name: "Seanime",
    host: "seanime.local.deedlit.dev",
    url: "https://seanime.local.deedlit.dev",
    description: "Local anime library and tracking app.",
    status: "online",
    category: "media",
    icon: "searnime"
  },
  {
    id: "files",
    name: "Files",
    host: "files.local.deedlit.dev",
    url: "https://files.local.deedlit.dev",
    description: "File browser and shared storage index.",
    status: "online",
    category: "storage",
    icon: "files"
  },
  {
    id: "idp",
    name: "Identity Provider",
    host: "idp.deedlit.dev",
    url: "https://idp.deedlit.dev",
    description: "Authentication and SSO portal.",
    status: "online",
    category: "auth",
    icon: "idp"
  }
];
