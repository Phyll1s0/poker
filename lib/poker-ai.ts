export const AI_PROFILES = {
  gto: { aggression: 0.7, looseness: 0.27, bluff: 0.12 },
  lag: { aggression: 0.78, looseness: 0.4, bluff: 0.2 },
  tag: { aggression: 0.64, looseness: 0.22, bluff: 0.05 },
  adaptive: { aggression: 0.7, looseness: 0.28, bluff: 0.15 },
  nit: { aggression: 0.38, looseness: 0.16, bluff: 0.02 },
} as const;

export type AiStyleKey = keyof typeof AI_PROFILES;

export const AI_STYLE_OPTIONS: { style: string; styleKey: AiStyleKey }[] = [
  { style: "GTO 平衡", styleKey: "gto" },
  { style: "松凶压迫", styleKey: "lag" },
  { style: "紧凶价值", styleKey: "tag" },
  { style: "动态适应", styleKey: "adaptive" },
  { style: "稳健保守", styleKey: "nit" },
];

export function sampleAiStyle(random = Math.random) {
  const index = Math.min(AI_STYLE_OPTIONS.length - 1, Math.floor(random() * AI_STYLE_OPTIONS.length));
  return { ...AI_STYLE_OPTIONS[index] };
}

export function sampleAiLineup(count: number, random = Math.random) {
  return Array.from({ length: count }, () => sampleAiStyle(random));
}
