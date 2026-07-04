/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import {
  aiAgentKimiFamilyDefaultMaxTokens,
  getAiAgentModelCatalogMaxTokens,
  isAiAgentKimiFamilyModel,
  resolveAiAgentStreamMaxTokens,
} from "./stream-max-tokens";

describe("stream-max-tokens", () => {
  it("detects Kimi-family model ids", () => {
    expect(isAiAgentKimiFamilyModel("accounts/fireworks/routers/kimi-k2p6-turbo")).toBe(true);
    expect(isAiAgentKimiFamilyModel("moonshotai/kimi-k2.5")).toBe(true);
    expect(isAiAgentKimiFamilyModel("GLM-5.1-Coding")).toBe(false);
  });

  it("omits max_tokens for non-Kimi models", () => {
    expect(
      resolveAiAgentStreamMaxTokens({
        modelId: "GLM-5.1-Coding",
        catalogMaxTokens: 4096,
        contextWindow: 202_752,
        estimatedInputTokens: 76_943,
      }),
    ).toBeUndefined();
  });

  it("uses catalog max_tokens for Kimi, clamped to remaining context", () => {
    expect(getAiAgentModelCatalogMaxTokens("kimi-k2.5")).toBe(aiAgentKimiFamilyDefaultMaxTokens);
    expect(
      resolveAiAgentStreamMaxTokens({
        modelId: "kimi-k2.5",
        catalogMaxTokens: aiAgentKimiFamilyDefaultMaxTokens,
        contextWindow: 262_144,
        estimatedInputTokens: 10_000,
      }),
    ).toBe(aiAgentKimiFamilyDefaultMaxTokens);
  });
});
