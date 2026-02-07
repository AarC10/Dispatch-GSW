import type { FixStatus } from "./types";

export function colorForIndex(idx: number) {
  const palette = [
    "#e41a1c",
    "#377eb8",
    "#4daf4a",
    "#984ea3",
    "#ff7f00",
    "#ffff33",
    "#a65628",
    "#f781bf",
    "#999999",
  ];
  if (idx < palette.length) return palette[idx];
  const hue = (idx * 137.508) % 360; // golden angle to spread hues
  return `hsl(${hue}, 70%, 50%)`;
}

export function fixFromString(s?: string): FixStatus | undefined {
  if (!s) return undefined;
  const upper = s.toUpperCase();
  if (upper.includes("NO")) return "NOFIX";
  if (upper.includes("DIFF")) return "DIFF";
  if (upper.includes("EST")) return "EST";
  if (upper.includes("FIX")) return "FIX";
  return "UNKNOWN";
}
