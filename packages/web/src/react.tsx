"use client";

import { useEffect } from "react";
import { init, type LaunchBuddyOptions } from "./index";

export function LaunchBuddy({ projectKey, endpoint, pathPrefixes, debug }: LaunchBuddyOptions) {
  useEffect(() => {
    init({ projectKey, endpoint, pathPrefixes, debug });
  }, [projectKey, endpoint, pathPrefixes, debug]);
  return null;
}
