/**
 * LLM pricing table — USD per 1M tokens. Used to estimate `costUsd` when an
 * executor reports token counts without a price. Numbers are list prices and
 * drift over time; treat the estimate as a guide, not a billing source of
 * truth. Hosts can override with `setPricing`.
 *
 * Lookup is prefix-based: `claude-opus-4-8-20990101` matches the
 * `claude-opus-4` entry. Longest matching prefix wins.
 */

export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

const DEFAULT_PRICING: Record<string, ModelPrice> = {
  // Anthropic (Claude)
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku-4': { input: 1, output: 5 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-opus': { input: 15, output: 75 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  // OpenAI
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'o1-mini': { input: 1.1, output: 4.4 },
  'o1': { input: 15, output: 60 },
};

const pricing: Record<string, ModelPrice> = { ...DEFAULT_PRICING };

/** Register or override a model's price. Prefix-matched at lookup. */
export function setPricing(model: string, price: ModelPrice): void {
  pricing[model] = price;
}

/** Resolve the price for a model id by longest-prefix match. */
export function priceFor(model: string | undefined): ModelPrice | undefined {
  if (!model) return undefined;
  const key = model.toLowerCase();
  if (pricing[key]) return pricing[key];
  let best: { len: number; price: ModelPrice } | undefined;
  for (const [prefix, price] of Object.entries(pricing)) {
    if (key.startsWith(prefix) && (!best || prefix.length > best.len)) {
      best = { len: prefix.length, price };
    }
  }
  return best?.price;
}

/** Estimate USD spend for a call. Returns 0 when the model is unknown. */
export function estimateCost(
  model: string | undefined,
  inputTokens = 0,
  outputTokens = 0,
): number {
  const price = priceFor(model);
  if (!price) return 0;
  const cost = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
  // Round to 6 decimals (micro-dollars) to avoid float noise.
  return Math.round(cost * 1_000_000) / 1_000_000;
}
