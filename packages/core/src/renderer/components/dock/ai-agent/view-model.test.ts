/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import {
  buildAiAgentContextIndicator,
  buildAiAgentConversationViewModel,
  buildAiAgentSessionList,
  formatAiAgentDuration,
} from "./view-model";

import type { AiAgentMessage, AiAgentSession } from "./store";

describe("ai-agent view model", () => {
  it("keeps assistant text, thinking, tool, and error blocks in a stable order", () => {
    const messages: AiAgentMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        runId: "run-1",
        status: "done",
        parts: [
          { type: "text", text: "First answer." },
          { type: "thinking", text: "internal notes", done: true },
          {
            type: "tool_call",
            toolCallId: "call-1",
            name: "kubectl_logs",
            argumentsText: JSON.stringify({ namespace: "gpu", pod: "worker-a" }),
            done: true,
            startedAt: 100,
            runningAt: 250,
          },
          {
            type: "tool_result",
            toolCallId: "call-1",
            content: "error: crash loop",
            isError: true,
            completedAt: 1_250,
            details: {
              command: "kubectl logs -n gpu worker-a",
              fullOutputPath: "/tmp/worker-a.log",
            },
          },
          { type: "error", message: "follow-up failed" },
        ],
      },
    ];

    const [message] = buildAiAgentConversationViewModel(messages);

    expect(message.blocks.map((block) => block.type)).toEqual(["text", "thinking", "tool", "error"]);

    const textBlock = message.blocks[0] as Extract<(typeof message.blocks)[number], { type: "text" }>;
    expect(textBlock.text).toBe("First answer.");

    const toolBlock = message.blocks[2] as Extract<(typeof message.blocks)[number], { type: "tool" }>;

    expect(toolBlock).toMatchObject({
      type: "tool",
      name: "kubectl_logs",
      stage: "error",
      parameterSummary: expect.stringContaining("namespace=gpu"),
      command: "kubectl logs -n gpu worker-a",
      durationMs: 1_000,
    });
  });

  it("turns compaction checkpoint messages into dedicated compact cards", () => {
    const [message] = buildAiAgentConversationViewModel([
      {
        id: "history-1",
        role: "user",
        createdAt: 1,
        status: "done",
        parts: [{ type: "compaction_summary", summary: "## Goal\nKeep going", tokensBefore: 68_000 }],
      },
    ]);

    expect(message.kind).toBe("compact");
    expect(message.blocks).toMatchObject([
      {
        type: "compact",
        summary: "## Goal\nKeep going",
        tokensBefore: 68_000,
      },
    ]);
  });

  it("filters sessions by title and first real user prompt while keeping compaction turns out of the count", () => {
    const sessions: AiAgentSession[] = [
      {
        id: "session-1",
        title: "GPU incident",
        titleSource: "manual",
        createdAt: 1,
        updatedAt: 2,
        messages: [
          {
            id: "history-1",
            role: "user",
            createdAt: 1,
            status: "done",
            parts: [{ type: "compaction_summary", summary: "summary", tokensBefore: 60_000 }],
          },
          {
            id: "user-1",
            role: "user",
            createdAt: 2,
            status: "done",
            parts: [{ type: "text", text: "Inspect the gpu operator" }],
          },
        ],
      },
    ];

    expect(
      buildAiAgentSessionList({
        activeSessionId: "session-1",
        clusterLabel: "cluster-a",
        search: "operator",
        sessions,
      }),
    ).toMatchObject([
      {
        id: "session-1",
        title: "GPU incident",
        turnCount: 1,
        clusterLabel: "cluster-a",
        active: true,
      },
    ]);
  });

  it("handles legacy tabs with an undefined session search string", () => {
    expect(
      buildAiAgentSessionList({
        activeSessionId: "session-1",
        clusterLabel: "cluster-a",
        search: undefined,
        sessions: [
          {
            id: "session-1",
            title: "GPU incident",
            createdAt: 1,
            updatedAt: 2,
            messages: [],
          },
        ],
      }),
    ).toHaveLength(1);
  });

  it("falls back to a derived title for legacy sessions without a saved title", () => {
    expect(
      buildAiAgentSessionList({
        activeSessionId: "session-legacy",
        clusterLabel: "cluster-a",
        search: "",
        sessions: [
          {
            id: "session-legacy",
            title: undefined as unknown as string,
            createdAt: 1,
            updatedAt: 2,
            messages: [
              {
                id: "user-1",
                role: "user",
                createdAt: 2,
                status: "done",
                parts: [{ type: "text", text: "Inspect the gpu operator rollout" }],
              },
            ],
          },
        ],
      })[0].title,
    ).toBe("Inspect the gpu operator rollout");
  });

  it("formats tool durations for short and long runs", () => {
    expect(formatAiAgentDuration(820)).toBe("820ms");
    expect(formatAiAgentDuration(1_500)).toBe("1.5s");
    expect(formatAiAgentDuration(67_000)).toBe("1m 7s");
  });

  it("uses at least a 200k context window when no model is configured", () => {
    expect(
      buildAiAgentContextIndicator({
        lastCompactionAt: undefined,
        messages: [],
        selectedModelId: undefined,
      }),
    ).toMatchObject({
      label: "1k context",
      progress: 0,
    });
  });

  it("uses the configured model context window when available", () => {
    expect(
      buildAiAgentContextIndicator({
        configuredModelId: "gemini-2.5-pro",
        lastCompactionAt: undefined,
        messages: [],
        selectedModelId: undefined,
      }).progress,
    ).toBe(0);
  });
});
