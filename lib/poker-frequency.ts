function clampFrequency(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Keeps tiny mixed branches visible and reserves 100% for a genuinely pure
 * action. The old integer rounding made 99.6% look identical to 100%.
 */
export function formatPokerFrequency(value: number) {
  const frequency = clampFrequency(value);
  if (frequency === 0) return "0%";
  if (frequency === 1) return "100%";
  const percent = frequency * 100;
  if (percent < 0.1) return "<0.1%";
  if (percent >= 99.95) return ">99.9%";
  if (percent < 10 || percent > 99) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

export function formatPokerFrequencyMix(items: Array<{ label: string; frequency: number }>) {
  return items
    .filter((item) => Number.isFinite(item.frequency) && item.frequency > 0)
    .map((item) => `${item.label} ${formatPokerFrequency(item.frequency)}`)
    .join(" · ");
}
