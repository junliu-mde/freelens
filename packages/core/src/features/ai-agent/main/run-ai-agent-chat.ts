/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { stream, validateToolCall } from "@earendil-works/pi-ai";
import { normalizeAiAgentSettings } from "../common/settings";
import { kubectlAiAgentTools } from "./kubectl-tools";

import type { AssistantMessage, Context, Model, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import type { ClusterId } from "../../../common/cluster-types";
import type { AiAgentSendRequest, AiAgentStreamEvent } from "../common/channels";
import type { AiAgentSettings } from "../common/settings";
import type { ExecuteAiAgentKubectlTool } from "./execute-ai-agent-kubectl-tool.injectable";

const createModel = (settings: AiAgentSettings): Model<"openai-completions"> => ({
  id: settings.model,
  name: settings.model,
  api: "openai-completions",
  provider: settings.provider,
  baseUrl: settings.baseUrl,
  reasoning: settings.reasoningEffort !== "off",
  input: ["text"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 128000,
  maxTokens: settings.maxTokens,
  compat: {
    supportsUsageInStreaming: false,
    maxTokensField: "max_tokens",
    thinkingFormat: "openai",
  },
});

const getTextFromAssistantMessage = (message: AssistantMessage) =>
  message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

const toToolResultMessage = (toolCall: ToolCall, content: string, isError: boolean): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: toolCall.id,
  toolName: toolCall.name,
  content: [{ type: "text", text: content }],
  isError,
  timestamp: Date.now(),
});

export const runAiAgentChat = async (
  request: AiAgentSendRequest,
  rawSettings: AiAgentSettings | undefined,
  clusterId: ClusterId | undefined,
  executeKubectlTool: ExecuteAiAgentKubectlTool,
  emit: (event: AiAgentStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> => {
  const settings = normalizeAiAgentSettings(rawSettings);
  const tools = settings.enableKubectlTools ? kubectlAiAgentTools : undefined;
  const clusterContext = clusterId ? `Active cluster ID: ${clusterId}.` : "No active cluster connected.";
  const context: Context = {
    systemPrompt: `You are an AI Agent inside Freelens, a Kubernetes IDE. ${clusterContext} Be concise and practical. When Kubernetes debugging is requested, use the provided read-only kubectl tools against the active cluster, inspect evidence first, then explain findings and next safe actions. Never suggest destructive kubectl actions unless the user explicitly asks.`,
    messages: request.messages.map((message) => ({
      role: "user" as const,
      content: `${message.role === "assistant" ? "Previous assistant" : "User"}: ${message.content}`,
      timestamp: Date.now(),
    })),
    tools,
  };

  emit({ type: "run-start", tabId: request.tabId, runId: request.runId });

  for (let iteration = 0; iteration <= settings.maxToolIterations; iteration += 1) {
    const model = createModel(settings);
    let finalMessage: AssistantMessage | undefined;

    for await (const event of stream(model, context, {
      apiKey: settings.apiKey,
      signal,
      maxTokens: settings.maxTokens,
      ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
      ...(settings.reasoningEffort === "off" ? {} : { reasoning: settings.reasoningEffort }),
    })) {
      switch (event.type) {
        case "text_delta":
          emit({ type: "text-delta", tabId: request.tabId, runId: request.runId, delta: event.delta });
          break;
        case "thinking_start":
          emit({ type: "thinking-start", tabId: request.tabId, runId: request.runId });
          break;
        case "thinking_delta":
          emit({ type: "thinking-delta", tabId: request.tabId, runId: request.runId, delta: event.delta });
          break;
        case "thinking_end":
          emit({ type: "thinking-end", tabId: request.tabId, runId: request.runId });
          break;
        case "toolcall_start":
          emit({
            type: "tool-call-start",
            tabId: request.tabId,
            runId: request.runId,
            toolCallId: String(event.contentIndex),
          });
          break;
        case "toolcall_delta":
          emit({ type: "tool-call-delta", tabId: request.tabId, runId: request.runId, delta: event.delta });
          break;
        case "toolcall_end":
          emit({
            type: "tool-call-end",
            tabId: request.tabId,
            runId: request.runId,
            toolCallId: event.toolCall.id,
            name: event.toolCall.name,
            argumentsText: JSON.stringify(event.toolCall.arguments, null, 2),
          });
          break;
        case "done":
          finalMessage = event.message;
          break;
        case "error":
          emit({
            type: "run-error",
            tabId: request.tabId,
            runId: request.runId,
            error: event.error.errorMessage || "AI stream failed",
          });
          return;
      }
    }

    if (!finalMessage) {
      emit({
        type: "run-error",
        tabId: request.tabId,
        runId: request.runId,
        error: "AI stream ended without a final message",
      });

      return;
    }

    context.messages.push(finalMessage);

    const toolCalls = finalMessage.content.filter((block): block is ToolCall => block.type === "toolCall");

    if (!toolCalls.length) {
      emit({ type: "run-done", tabId: request.tabId, runId: request.runId });

      return;
    }

    if (!settings.enableKubectlTools || !tools || iteration >= settings.maxToolIterations) {
      const text = !settings.enableKubectlTools
        ? "Tool execution is disabled in AI Agent preferences."
        : "Maximum tool iterations reached.";

      for (const toolCall of toolCalls) {
        const result = toToolResultMessage(toolCall, text, true);

        context.messages.push(result);
        emit({
          type: "tool-result",
          tabId: request.tabId,
          runId: request.runId,
          toolCallId: toolCall.id,
          content: text,
          isError: true,
        });
      }

      emit({ type: "run-done", tabId: request.tabId, runId: request.runId });

      return;
    }

    for (const toolCall of toolCalls) {
      let resultContent: string;
      let isError = false;

      try {
        validateToolCall(tools, toolCall);
        const result = await executeKubectlTool(clusterId, toolCall);

        resultContent = result.content;
        isError = result.isError;
      } catch (error) {
        resultContent = error instanceof Error ? error.message : String(error);
        isError = true;
      }

      context.messages.push(toToolResultMessage(toolCall, resultContent, isError));
      emit({
        type: "tool-result",
        tabId: request.tabId,
        runId: request.runId,
        toolCallId: toolCall.id,
        content: resultContent,
        isError,
      });
    }

    const assistantText = getTextFromAssistantMessage(finalMessage);

    if (assistantText.trim()) {
      context.messages.push({
        role: "user",
        content: "Continue after the tool results. Summarize the evidence and answer the user's debugging request.",
        timestamp: Date.now(),
      });
    }
  }

  emit({ type: "run-done", tabId: request.tabId, runId: request.runId });
};
