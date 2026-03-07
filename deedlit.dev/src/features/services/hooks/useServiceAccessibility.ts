"use client";

import { useEffect, useState, useCallback } from "react";
import type { LocalServiceApp } from "@/features/services/types";

export type AccessibilityStatus = "checking" | "accessible" | "unreachable" | "error";

interface ServiceAccessibility {
  [serviceId: string]: {
    status: AccessibilityStatus;
    responseTime?: number;
    lastChecked?: Date;
    error?: string;
  };
}

/**
 * Hook to check if services are accessible from the client browser.
 * Performs HEAD requests to verify connectivity without full page loads.
 */
export function useServiceAccessibility(apps: LocalServiceApp[]) {
  const [accessibility, setAccessibility] = useState<ServiceAccessibility>({});
  const [isChecking, setIsChecking] = useState(true);

  const checkService = useCallback(async (app: LocalServiceApp) => {
    const startTime = Date.now();
    
    try {
      // Use AbortController for timeout (reduced to 3 seconds for faster feedback)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      // Use cors mode to actually check if service is responding with success
      const response = await fetch(app.url, {
        method: "HEAD",
        mode: "cors",
        signal: controller.signal,
        cache: "no-store",
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      // Check if response is successful (200-299)
      const isAccessible = response.ok;
      
      setAccessibility((prev) => ({
        ...prev,
        [app.id]: {
          status: isAccessible ? "accessible" : "unreachable",
          responseTime,
          lastChecked: new Date(),
          error: isAccessible ? undefined : `HTTP ${response.status}`,
        },
      }));
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      // Distinguish between timeout and other errors
      const isTimeout = error instanceof Error && error.name === "AbortError";
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      setAccessibility((prev) => ({
        ...prev,
        [app.id]: {
          status: "unreachable",
          responseTime,
          lastChecked: new Date(),
          error: isTimeout ? "Timeout (3s)" : errorMessage,
        },
      }));
    }
  }, []);

  const checkAllServices = useCallback(async () => {
    setIsChecking(true);
    
    // Initialize all as checking
    const initialState: ServiceAccessibility = {};
    apps.forEach((app) => {
      initialState[app.id] = { status: "checking" };
    });
    setAccessibility(initialState);

    // Check all services in parallel
    await Promise.all(apps.map((app) => checkService(app)));
    
    setIsChecking(false);
  }, [apps, checkService]);

  // Initial check on mount
  useEffect(() => {
    checkAllServices();
  }, [checkAllServices]);

  return {
    accessibility,
    isChecking,
    checkAllServices,
  };
}
