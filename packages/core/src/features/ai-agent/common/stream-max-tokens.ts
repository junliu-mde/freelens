/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

/** Matches oh-my-pi openai-completions Kimi-family detection for max_tokens injection. */
export const isAiAgentKimiFamilyModel = (modelId: string) =>
  modelId.includes("moonshotai/kimi") || /(^|\/)kimi[-.]/i.test(modelId);

/** Default max_tokens sent for Kimi-family models when the user leaves output tokens on automatic. */
export const aiAgentKimiFamilyDefaultMaxTokens = 8192;

export const getAiAgentModelCatalogMaxTokens = (modelId: string | undefined) =>
  modelId && isAiAgentKimiFamilyModel(modelId) ? aiAgentKimiFamilyDefaultMaxTokens : 4096;

export interface ResolveAiAgentStreamMaxTokensInput {
  modelId: string;
  catalogMaxTokens: number;
  contextWindow: number;
  estimatedInputTokens: number;
  reserveTokens?: number;
}

const clampToRemainingContext = (
  requested: number,
  contextWindow: number,
  estimatedInputTokens: number,
  reserveTokens: number,
) => {
  const remaining = Math.max(0, contextWindow - estimatedInputTokens - reserveTokens);

  if (remaining === 0) {
    return undefined;
  }

  return Math.min(requested, remaining);
};

/**
 * Resolves max_tokens for chat completion requests.
 *
 * Follows oh-my-pi openai-completions behavior:
 * - Default: omit max_tokens so the server uses remaining context.
 * - Kimi family: send a catalog default, clamped to remaining context.
 */
export const resolveAiAgentStreamMaxTokens = ({
  modelId,
  catalogMaxTokens,
  contextWindow,
  estimatedInputTokens,
  reserveTokens = 1024,
}: ResolveAiAgentStreamMaxTokensInput): number | undefined => {
  if (isAiAgentKimiFamilyModel(modelId)) {
    return clampToRemainingContext(catalogMaxTokens, contextWindow, estimatedInputTokens, reserveTokens);
  }

  return undefined;
};
