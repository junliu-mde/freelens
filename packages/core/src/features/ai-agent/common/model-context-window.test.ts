/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getAiAgentContextWindow, minimumAiAgentContextWindow } from "./model-context-window";

describe("getAiAgentContextWindow", () => {
  it("falls back to the minimum context window when no model is configured", () => {
    expect(getAiAgentContextWindow(undefined)).toBe(minimumAiAgentContextWindow);
    expect(getAiAgentContextWindow("")).toBe(minimumAiAgentContextWindow);
  });

  it("uses a larger known window for gemini models", () => {
    expect(getAiAgentContextWindow("gemini-2.5-pro")).toBe(1_000_000);
  });

  it("keeps known models at or above the minimum window", () => {
    expect(getAiAgentContextWindow("gpt-5")).toBe(200_000);
    expect(getAiAgentContextWindow("qwen3-coder")).toBe(262_144);
  });
});
