import { getEncoding, type Tiktoken } from 'js-tiktoken';

let encoder: Tiktoken | null = null;

function enc(): Tiktoken {
  encoder ??= getEncoding('cl100k_base');
  return encoder;
}

export function countTokens(text: string): number {
  if (!text) return 0;
  return enc().encode(text).length;
}

/** 在 token 边界截断，保证截断后的 token 数不超过 budget。 */
export function truncateToTokens(text: string, budget: number): string {
  if (budget <= 0) return '';
  const tokens = enc().encode(text);
  if (tokens.length <= budget) return text;
  return enc().decode(tokens.slice(0, budget));
}
