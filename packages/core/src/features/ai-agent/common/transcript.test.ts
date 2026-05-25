/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { toAiAgentConversationHistory, toAiAgentLlmMessages } from "./transcript";

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
});
