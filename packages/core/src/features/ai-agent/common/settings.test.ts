/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { normalizeAiAgentSettings } from "./settings";

describe("normalizeAiAgentSettings", () => {
  it("drops removed maxTokens from persisted preferences", () => {
    const normalized = normalizeAiAgentSettings({
      model: "GLM-5.1-Coding",
      maxTokens: 128_000,
    });

    expect(normalized.model).toBe("GLM-5.1-Coding");
    expect("maxTokens" in normalized).toBe(false);
  });
});
