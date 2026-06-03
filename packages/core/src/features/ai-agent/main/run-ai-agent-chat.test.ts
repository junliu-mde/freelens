/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

const Type = {
  Object: jest.fn((value) => value),
  String: jest.fn((value) => value),
  Optional: jest.fn((value) => value),
  Union: jest.fn((value) => value),
  Literal: jest.fn((value) => value),
  Boolean: jest.fn((value) => value),
  Number: jest.fn((value) => value),
  Array: jest.fn((value) => value),
};

jest.mock("@earendil-works/pi-ai", () => ({
  completeSimple: jest.fn(),
  stream: jest.fn(),
  validateToolCall: jest.fn(),
  Type,
}));

import { completeSimple, stream, validateToolCall } from "@earendil-works/pi-ai";
import { runAiAgentChat } from "./run-ai-agent-chat";

import type { AiAgentSendRequest, AiAgentStreamEvent } from "../common/channels";
import type { AiAgentSettings } from "../common/settings";
import type { ExecuteAiAgentKubectlTool } from "./execute-ai-agent-kubectl-tool.injectable";

describe("run-ai-agent-chat", () => {
  const toolCall = {
    type: "toolCall",
    id: "call-1",
    name: "kubectl_apply",
    arguments: {
      manifest: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: some-pod\n",
      dryRun: true,
      namespace: "default",
    },
  } as const;

  const request: AiAgentSendRequest = {
    tabId: "tab-1",
    runId: "run-1",
    permissionMode: "read-write",
    messages: [
      {
        role: "user",
        createdAt: 1,
        parts: [
          {
            type: "text",
            text: "Apply this manifest with dry-run first.",
          },
        ],
      },
    ],
  };

  const settings: AiAgentSettings = {
    provider: "custom-openai-compat",
    baseUrl: "http://localhost:8000/v1",
    apiKey: "irrelevant",
    model: "some-model",
    reasoningEffort: "off",
    maxTokens: 512,
    temperature: undefined,
    enableKubectlTools: true,
    enableMcpTools: true,
    mcpConfigPath: "~/.mcp.json",
    maxToolIterations: 1,
    enableCompaction: true,
    compactionReserveTokens: 16_384,
    compactionKeepRecentTokens: 20_000,
  };

  let completeSimpleMock: jest.MockedFunction<typeof completeSimple>;
  let streamMock: jest.MockedFunction<typeof stream>;
  let validateToolCallMock: jest.MockedFunction<typeof validateToolCall>;

  beforeEach(() => {
    completeSimpleMock = completeSimple as jest.MockedFunction<typeof completeSimple>;
    streamMock = stream as jest.MockedFunction<typeof stream>;
    validateToolCallMock = validateToolCall as jest.MockedFunction<typeof validateToolCall>;

    completeSimpleMock.mockReset();
    streamMock.mockReset();
    validateToolCallMock.mockReset();
    validateToolCallMock.mockImplementation(() => undefined);
  });

  it("hydrates structured transcript history before streaming", async () => {
    const executeKubectlTool = jest.fn((async () => ({
      content: "unused",
      isError: false,
    })) as ExecuteAiAgentKubectlTool);
    const requestWithHistory: AiAgentSendRequest = {
      ...request,
      messages: [
        {
          role: "user",
          createdAt: 1,
          parts: [{ type: "text", text: "Inspect pod-a" }],
        },
        {
          role: "assistant",
          createdAt: 2,
          parts: [
            {
              type: "tool_call",
              toolCallId: "call-0",
              name: "kubectl_get",
              argumentsText: JSON.stringify({ resource: "pods", namespace: "default" }, null, 2),
              done: true,
            },
            {
              type: "tool_result",
              toolCallId: "call-0",
              content: "$ kubectl get pods\npod-a",
              isError: false,
            },
            {
              type: "text",
              text: "pod-a is running",
            },
          ],
        },
      ],
    };

    streamMock.mockReturnValue(
      (async function* () {
        yield {
          type: "done",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "done" }],
            timestamp: Date.now(),
          },
        };
      })() as never,
    );

    await runAiAgentChat(
      requestWithHistory,
      settings,
      "cluster-1" as never,
      executeKubectlTool,
      () => undefined,
      new AbortController().signal,
    );

    expect(streamMock).toHaveBeenCalledTimes(1);

    const [, context] = streamMock.mock.calls[0];

    expect(context.messages.slice(0, 4)).toMatchObject([
      {
        role: "user",
        content: "Inspect pod-a",
        timestamp: 1,
      },
      {
        role: "assistant",
        stopReason: "toolUse",
        timestamp: 2,
        content: [
          {
            type: "toolCall",
            id: "call-0",
            name: "kubectl_get",
            arguments: {
              resource: "pods",
              namespace: "default",
            },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "call-0",
        toolName: "kubectl_get",
        isError: false,
        timestamp: 2,
        content: [{ type: "text", text: "$ kubectl get pods\npod-a" }],
      },
      {
        role: "assistant",
        stopReason: "stop",
        timestamp: 2,
        content: [{ type: "text", text: "pod-a is running" }],
      },
    ]);
  });

  it("stops after an aborted tool execution without emitting run-error or run-done", async () => {
    const controller = new AbortController();
    const events: AiAgentStreamEvent[] = [];
    const executeKubectlTool = jest.fn((async (_clusterId, _toolCall, signal) => {
      expect(signal).toBe(controller.signal);

      controller.abort("AI Agent run was stopped.");

      return {
        content: "AI Agent run was stopped.",
        isError: true,
      };
    }) as ExecuteAiAgentKubectlTool);

    streamMock.mockReturnValue(
      (async function* () {
        yield { type: "toolcall_start", contentIndex: 0 };
        yield { type: "toolcall_end", toolCall };
        yield {
          type: "done",
          message: {
            role: "assistant",
            content: [toolCall],
            timestamp: Date.now(),
          },
        };
      })() as never,
    );

    await runAiAgentChat(
      request,
      settings,
      "cluster-1" as never,
      executeKubectlTool,
      (event) => events.push(event),
      controller.signal,
    );

    expect(validateToolCallMock).toHaveBeenCalled();
    expect(executeKubectlTool).toHaveBeenCalledWith("cluster-1", toolCall, controller.signal);
    expect(events).toEqual([
      { type: "run-start", tabId: "tab-1", runId: "run-1" },
      { type: "tool-call-start", tabId: "tab-1", runId: "run-1", toolCallId: "0" },
      {
        type: "tool-call-end",
        tabId: "tab-1",
        runId: "run-1",
        toolCallId: "call-1",
        name: "kubectl_apply",
        argumentsText: JSON.stringify(toolCall.arguments, null, 2),
      },
      {
        type: "tool-result",
        tabId: "tab-1",
        runId: "run-1",
        toolCallId: "call-1",
        content: "AI Agent run was stopped.",
        isError: true,
      },
    ]);
  });

  it("compacts long history before streaming and emits the replacement history", async () => {
    const executeKubectlTool = jest.fn((async () => ({
      content: "unused",
      isError: false,
    })) as ExecuteAiAgentKubectlTool);
    const events: AiAgentStreamEvent[] = [];
    const requestWithLongHistory: AiAgentSendRequest = {
      ...request,
      messages: [
        {
          role: "user",
          createdAt: 1,
          parts: [{ type: "text", text: "old context ".repeat(500) }],
        },
        {
          role: "assistant",
          createdAt: 2,
          parts: [{ type: "text", text: "old answer ".repeat(500) }],
        },
        {
          role: "user",
          createdAt: 3,
          parts: [{ type: "text", text: "latest question" }],
        },
      ],
    };

    completeSimpleMock.mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "## Goal\nKeep debugging the cluster" }],
      api: "openai-completions",
      provider: "custom-openai-compat",
      model: "some-model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    } as never);
    streamMock.mockReturnValue(
      (async function* () {
        yield {
          type: "done",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "done" }],
            timestamp: Date.now(),
          },
        };
      })() as never,
    );

    await runAiAgentChat(
      requestWithLongHistory,
      {
        ...settings,
        compactionReserveTokens: 199_500,
        compactionKeepRecentTokens: 1,
      },
      "cluster-1" as never,
      executeKubectlTool,
      (event) => events.push(event),
      new AbortController().signal,
    );

    expect(completeSimpleMock).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === "history-compacted")).toBe(true);
    expect(streamMock).toHaveBeenCalledTimes(1);

    const [, context] = streamMock.mock.calls[0];

    expect(context.messages[0]).toMatchObject({
      role: "user",
      content: expect.stringContaining("The conversation history before this point was compacted"),
    });
    expect(context.messages[1]).toMatchObject({
      role: "user",
      content: "latest question",
    });
  });

  it("suspends execution when ask tool is called and resumes when handleAskResponse is called", async () => {
    const executeKubectlTool = jest.fn();
    const events: AiAgentStreamEvent[] = [];

    const askToolCall = {
      type: "toolCall" as const,
      id: "ask-call-id",
      name: "ask",
      arguments: {
        questions: [
          {
            id: "namespace",
            question: "Which namespace?",
            options: [{ label: "default" }],
          },
        ],
      },
    };

    streamMock.mockReturnValue(
      (async function* () {
        yield { type: "toolcall_start", contentIndex: 0 };
        yield {
          type: "toolcall_end",
          toolCall: askToolCall,
        };
        yield {
          type: "done",
          message: {
            role: "assistant",
            content: [askToolCall],
            timestamp: 100,
          },
        };
      })() as never,
    );

    setTimeout(() => {
      const { AiAgentChatSession } = require("./ai-agent-chat-session");
      AiAgentChatSession.handleAskResponse("tab-1", "run-1", "ask-call-id", [
        {
          id: "namespace",
          selectedOptions: ["default"],
        },
      ]);
    }, 50);

    await runAiAgentChat(
      request,
      settings,
      "cluster-1" as never,
      executeKubectlTool,
      (event) => events.push(event),
      new AbortController().signal,
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool-result",
        toolCallId: "ask-call-id",
        content: "User answers:\nnamespace: default",
        isError: false,
        details: {
          results: [{ id: "namespace", selectedOptions: ["default"] }],
        },
      }),
    );
  });

  it("recovers gracefully and stringifies non-string content returned from tools", async () => {
    const events: AiAgentStreamEvent[] = [];
    const complexResult = { status: "Active", replicas: 3 };

    const executeKubectlTool = jest.fn(async () => ({
      content: complexResult as any,
      isError: false,
    }));

    const mockToolCall = {
      type: "toolCall" as const,
      id: "call-xyz",
      name: "kubectl_get",
      arguments: {
        resource: "pods",
      },
    };

    streamMock.mockReturnValue(
      (async function* () {
        yield { type: "toolcall_start", contentIndex: 0 };
        yield {
          type: "toolcall_end",
          toolCall: mockToolCall,
        };
        yield {
          type: "done",
          message: {
            role: "assistant",
            content: [mockToolCall],
            timestamp: 100,
          },
        };
      })() as never,
    );

    await runAiAgentChat(
      request,
      settings,
      "cluster-1" as never,
      executeKubectlTool,
      (event) => events.push(event),
      new AbortController().signal,
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool-result",
        toolCallId: "call-xyz",
        content: JSON.stringify(complexResult),
        isError: false,
      }),
    );
  });

  it("bounds tool results before emitting them and before sending them back to the model", async () => {
    const events: AiAgentStreamEvent[] = [];
    const largeOutput = Array.from({ length: 3_500 }, (_, index) => `line-${index}`).join("\n");
    const executeKubectlTool = jest.fn(async () => ({
      content: largeOutput,
      isError: false,
    }));
    const toolResultCall = {
      type: "toolCall" as const,
      id: "call-large",
      name: "kubectl_get",
      arguments: {
        resource: "pods",
      },
    };

    streamMock
      .mockReturnValueOnce(
        (async function* () {
          yield { type: "toolcall_start", contentIndex: 0 };
          yield {
            type: "toolcall_end",
            toolCall: toolResultCall,
          };
          yield {
            type: "done",
            message: {
              role: "assistant",
              content: [toolResultCall],
              timestamp: 100,
            },
          };
        })() as never,
      )
      .mockReturnValueOnce(
        (async function* () {
          yield {
            type: "done",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "done" }],
              timestamp: 101,
            },
          };
        })() as never,
      );

    await runAiAgentChat(
      request,
      {
        ...settings,
        maxToolIterations: 2,
      },
      "cluster-1" as never,
      executeKubectlTool,
      (event) => events.push(event),
      new AbortController().signal,
    );

    const toolResultEvent = events.find(
      (event): event is Extract<AiAgentStreamEvent, { type: "tool-result" }> => event.type === "tool-result",
    );

    expect(toolResultEvent?.content).not.toContain("line-0\n");
    expect(toolResultEvent?.content).toContain("line-500\n");
    expect(toolResultEvent?.content).toContain("line-3499");
    expect(toolResultEvent?.details?.truncation).toMatchObject({
      truncated: true,
      outputLines: 3_000,
      totalLines: 3_500,
    });

    const [, secondContext] = streamMock.mock.calls[1];
    const toolResultMessage = secondContext.messages.find(
      (message) => message.role === "toolResult" && message.toolCallId === "call-large",
    );

    expect(toolResultMessage?.content).toEqual([
      {
        type: "text",
        text: toolResultEvent?.content,
      },
    ]);
  });
});
