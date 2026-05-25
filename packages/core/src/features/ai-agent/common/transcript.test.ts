/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import {
  aiAgentCompactionSummaryPrefix,
  deriveAiAgentSessionTitle,
  getAiAgentFirstRealUserPrompt,
  getAiAgentUserTurnCount,
  isAiAgentCompactionMessage,
  toAiAgentConversationHistory,
  toAiAgentLlmMessages,
} from "./transcript";

import type { AiAgentMessage } from "./transcript";

describe("ai-agent transcript", () => {
  it("drops empty placeholder messages from conversation history", () => {
    const history = toAiAgentConversationHistory([
      {
        id: "user-1",
        role: "user",
        createdAt: 1,
        status: "done",
        parts: [{ type: "text", text: "Inspect the pod" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 2,
        status: "streaming",
        parts: [{ type: "text", text: "" }],
      },
    ]);

    expect(history).toEqual([
      {
        role: "user",
        createdAt: 1,
        parts: [{ type: "text", text: "Inspect the pod" }],
      },
    ]);
  });

  it("turns tool execution history back into LLM messages", () => {
    const messages: AiAgentMessage[] = [
      {
        id: "user-1",
        role: "user",
        createdAt: 1,
        status: "done",
        parts: [{ type: "text", text: "Inspect the pod" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 2,
        status: "done",
        parts: [
          {
            type: "tool_call",
            toolCallId: "call-1",
            name: "kubectl_get",
            argumentsText: JSON.stringify({ resource: "pods", namespace: "default" }, null, 2),
            done: true,
          },
          {
            type: "tool_result",
            toolCallId: "call-1",
            content: "$ kubectl get pods\npod-a",
            isError: false,
          },
          {
            type: "text",
            text: "pod-a is running",
          },
        ],
      },
    ];

    const llmMessages = toAiAgentLlmMessages(toAiAgentConversationHistory(messages), {
      api: "openai-completions",
      provider: "custom-openai-compat",
      model: "some-model",
    });

    expect(llmMessages).toHaveLength(4);
    expect(llmMessages[0]).toMatchObject({
      role: "user",
      content: "Inspect the pod",
      timestamp: 1,
    });
    expect(llmMessages[1]).toMatchObject({
      role: "assistant",
      stopReason: "toolUse",
      timestamp: 2,
      content: [
        {
          type: "toolCall",
          id: "call-1",
          name: "kubectl_get",
          arguments: {
            resource: "pods",
            namespace: "default",
          },
        },
      ],
    });
    expect(llmMessages[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "kubectl_get",
      isError: false,
      timestamp: 2,
      content: [{ type: "text", text: "$ kubectl get pods\npod-a" }],
    });
    expect(llmMessages[3]).toMatchObject({
      role: "assistant",
      stopReason: "stop",
      timestamp: 2,
      content: [{ type: "text", text: "pod-a is running" }],
    });
  });

  it("turns compaction summary history back into a user checkpoint message", () => {
    const llmMessages = toAiAgentLlmMessages(
      [
        {
          role: "user",
          createdAt: 1,
          parts: [
            {
              type: "compaction_summary",
              summary: "Older debugging steps and tool outputs were compacted.",
              tokensBefore: 72_000,
            },
          ],
        },
        {
          role: "user",
          createdAt: 2,
          parts: [{ type: "text", text: "Check the GPU nodes again." }],
        },
      ],
      {
        api: "openai-completions",
        provider: "custom-openai-compat",
        model: "some-model",
      },
    );

    expect(llmMessages[0]).toMatchObject({
      role: "user",
      timestamp: 1,
      content: expect.stringContaining(aiAgentCompactionSummaryPrefix),
    });
    expect(llmMessages[1]).toMatchObject({
      role: "user",
      timestamp: 2,
      content: "Check the GPU nodes again.",
    });
  });

  it("derives a session title from the first real user prompt after compaction", () => {
    expect(
      deriveAiAgentSessionTitle([
        {
          role: "user",
          parts: [
            {
              type: "compaction_summary",
              summary: "summary",
              tokensBefore: 12_345,
            },
          ],
        },
        {
          role: "user",
          parts: [{ type: "text", text: "Inspect the GPU operator deployment" }],
        },
      ]),
    ).toBe("Inspect the GPU operator deployment");
  });

  it("counts user turns without compaction checkpoints", () => {
    expect(
      getAiAgentUserTurnCount([
        {
          role: "user",
          parts: [
            {
              type: "compaction_summary",
              summary: "summary",
              tokensBefore: 12_345,
            },
          ],
        },
        {
          role: "assistant",
          parts: [{ type: "text", text: "still working" }],
        },
        {
          role: "user",
          parts: [{ type: "text", text: "Inspect the GPU operator deployment" }],
        },
        {
          role: "user",
          parts: [{ type: "text", text: "Check the daemonset logs too" }],
        },
      ]),
    ).toBe(2);
  });

  it("returns the first real user prompt instead of a compaction checkpoint", () => {
    expect(
      getAiAgentFirstRealUserPrompt([
        {
          role: "user",
          parts: [
            {
              type: "compaction_summary",
              summary: "summary",
              tokensBefore: 12_345,
            },
          ],
        },
        {
          role: "user",
          parts: [{ type: "text", text: "Inspect the GPU operator deployment" }],
        },
      ]),
    ).toMatchObject({
      role: "user",
      parts: [{ type: "text", text: "Inspect the GPU operator deployment" }],
    });
  });

  it("marks a checkpoint message as synthetic history", () => {
    expect(
      isAiAgentCompactionMessage({
        role: "user",
        parts: [
          {
            type: "compaction_summary",
            summary: "summary",
            tokensBefore: 12_345,
          },
        ],
      }),
    ).toBe(true);
    expect(
      isAiAgentCompactionMessage({
        role: "user",
        parts: [{ type: "text", text: "Inspect the GPU operator deployment" }],
      }),
    ).toBe(false);
  });
});
