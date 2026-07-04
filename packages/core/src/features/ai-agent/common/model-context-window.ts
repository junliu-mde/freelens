/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

export const minimumAiAgentContextWindow = 200_000;

const knownModelContextWindows: Array<{ pattern: RegExp; tokens: number }> = [
  { pattern: /\bgemini\b/i, tokens: 1_000_000 },
  { pattern: /\b(?:gpt-5|gpt-4\.1|o1|o3|o4)\b/i, tokens: 200_000 },
  { pattern: /\bclaude\b/i, tokens: 200_000 },
  { pattern: /\b(?:qwen|qwq)/i, tokens: 262_144 },
  { pattern: /\b(?:glm|z\.ai)\b/i, tokens: 202_752 },
  { pattern: /\b(?:kimi|moonshot|deepseek|doubao|hunyuan)\b/i, tokens: 256_000 },
  { pattern: /\bgrok\b/i, tokens: 256_000 },
];

export const getAiAgentContextWindow = (modelId: string | undefined) => {
  const trimmedModelId = modelId?.trim();

  if (!trimmedModelId) {
    return minimumAiAgentContextWindow;
  }

  const matchedWindow = knownModelContextWindows.find(({ pattern }) => pattern.test(trimmedModelId))?.tokens;

  return Math.max(minimumAiAgentContextWindow, matchedWindow ?? minimumAiAgentContextWindow);
};
