export type ServiceStatus = "online" | "degraded" | "offline";
export type ServiceIcon =
  | "gallery"
  | "prompt"
  | "metrics"
  | "comfyui"
  | "searnime"
  | "files"
  | "idp";

export interface LocalServiceApp {
  id: string;
  name: string;
  host: string;
  url: string;
  description: string;
  status: ServiceStatus;
  category: string;
  icon: ServiceIcon;
}
