/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { prepareAiAgentCompaction } from "./compaction";

describe("ai-agent compaction", () => {
  it("summarizes only the messages before the keep-recent boundary", () => {
    const result = prepareAiAgentCompaction(
      [
        {
          role: "user",
          createdAt: 1,
          parts: [{ type: "text", text: "a".repeat(400) }],
        },
        {
          role: "assistant",
          createdAt: 2,
          parts: [{ type: "text", text: "b".repeat(400) }],
        },
        {
          role: "user",
          createdAt: 3,
          parts: [{ type: "text", text: "recent question" }],
        },
      ],
      {
        enableCompaction: true,
        compactionReserveTokens: 900,
        compactionKeepRecentTokens: 1,
      },
      1_000,
    );

    expect(result?.messagesToSummarize).toHaveLength(2);
    expect(result?.keptMessages).toEqual([
      {
        role: "user",
        createdAt: 3,
        parts: [{ type: "text", text: "recent question" }],
      },
    ]);
  });

  it("reuses the previous compaction summary instead of re-summarizing it", () => {
    const result = prepareAiAgentCompaction(
      [
        {
          role: "user",
          createdAt: 1,
          parts: [{ type: "compaction_summary", summary: "older summary", tokensBefore: 40_000 }],
        },
        {
          role: "assistant",
          createdAt: 2,
          parts: [{ type: "text", text: "older assistant output".repeat(30) }],
        },
        {
          role: "user",
          createdAt: 3,
          parts: [{ type: "text", text: "new question" }],
        },
      ],
      {
        enableCompaction: true,
        compactionReserveTokens: 950,
        compactionKeepRecentTokens: 1,
      },
      1_000,
    );

    expect(result?.previousSummary).toBe("older summary");
    expect(result?.messagesToSummarize).toEqual([
      {
        role: "assistant",
        createdAt: 2,
        parts: [{ type: "text", text: "older assistant output".repeat(30) }],
      },
    ]);
  });
});
