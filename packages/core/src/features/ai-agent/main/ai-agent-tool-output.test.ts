/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { createAiAgentToolExecutionPayload, truncateToolOutputTail } from "./ai-agent-tool-output";

describe("ai-agent tool output", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not truncate short output", () => {
    const payload = createAiAgentToolExecutionPayload("kubectl get pods", "pod-a\npod-b");

    expect(payload).toEqual({
      content: "pod-a\npod-b",
      details: {
        command: "kubectl get pods",
      },
    });
  });

  it("truncates large output and keeps the full output path", () => {
    const payload = createAiAgentToolExecutionPayload(
      "kubectl logs pod-a",
      Array.from({ length: 2_500 }, (_, index) => `line-${index}`).join("\n"),
    );

    expect(payload.details?.truncation?.truncated).toBe(true);
    expect(payload.details?.fullOutputPath).toBeDefined();
    expect(payload.content).toContain("Full output:");

    const fullOutputPath = payload.details?.fullOutputPath;

    expect(fullOutputPath && existsSync(fullOutputPath)).toBe(true);

    if (fullOutputPath) {
      expect(readFileSync(fullOutputPath, "utf-8")).toContain("line-2499");
      unlinkSync(fullOutputPath);
    }
  });

  it("truncates from the tail without returning partial utf8 bytes", () => {
    const result = truncateToolOutputTail("a\nb\n你好\n世界", 2, 8);

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("世界");
    expect(result.content.includes("\ufffd")).toBe(false);
  });
});
