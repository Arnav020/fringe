"use client";

import { useEffect } from "react";
import { boardKey, buildOnce, store } from "@/lib/client";
import type { BuildInput } from "@/lib/types";

/**
 * Warms up the first persona's board while someone reads the landing page, so "Open the studio"
 * shows a finished board instead of a ten-second wait. The studio joins this build if it's still running.
 */
export default function Prefetch({ input }: { input: BuildInput }) {
  useEffect(() => {
    if (store.get(boardKey(input))) return;
    const t = setTimeout(() => buildOnce(input, () => {}).catch(() => {}), 1200);
    return () => clearTimeout(t);
  }, [input]);
  return null;
}
