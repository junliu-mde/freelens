/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { stream, validateToolCall } from "@earendil-works/pi-ai";
import { createAiAgentChatContext } from "./ai-agent-chat-context";

import type { AssistantMessage, Context, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";

import type { ClusterId } from "../../../common/cluster-types";
import type { AiAgentSendRequest, AiAgentStreamEvent } from "../common/channels";
import type { AiAgentSettings } from "../common/settings";
import type { ExecuteAiAgentKubectlTool } from "./execute-ai-agent-kubectl-tool.injectable";

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

interface AiAgentChatSessionOptions {
  request: AiAgentSendRequest;
  rawSettings: AiAgentSettings | undefined;
  clusterId: ClusterId | undefined;
  executeKubectlTool: ExecuteAiAgentKubectlTool;
  emit: (event: AiAgentStreamEvent) => void;
  signal: AbortSignal;
}

interface StreamAssistantMessageResult {
  didEmitError: boolean;
  finalMessage?: AssistantMessage;
}

export class AiAgentChatSession {
  private readonly clusterId: ClusterId | undefined;
  private readonly request: AiAgentSendRequest;
  private readonly executeKubectlTool: ExecuteAiAgentKubectlTool;
  private readonly emit: (event: AiAgentStreamEvent) => void;
  private readonly signal: AbortSignal;
  private readonly settings;
  private readonly model;
  private readonly tools;
  private readonly context: Context;

  constructor({ request, rawSettings, clusterId, executeKubectlTool, emit, signal }: AiAgentChatSessionOptions) {
    const { context, model, settings, tools } = createAiAgentChatContext(request, rawSettings, clusterId);

    this.request = request;
    this.clusterId = clusterId;
    this.executeKubectlTool = executeKubectlTool;
    this.emit = emit;
    this.signal = signal;
    this.settings = settings;
    this.model = model;
    this.tools = tools;
    this.context = context;
  }

  async run(): Promise<void> {
    if (this.signal.aborted) {
      return;
    }

    this.emit({ type: "run-start", tabId: this.request.tabId, runId: this.request.runId });

    for (let iteration = 0; iteration <= this.settings.maxToolIterations; iteration += 1) {
      if (this.signal.aborted) {
        return;
      }

      const { didEmitError, finalMessage } = await this.streamAssistantMessage();

      if (this.signal.aborted || didEmitError) {
        return;
      }

      if (!finalMessage) {
        this.emitRunError("AI stream ended without a final message");

        return;
      }

      this.context.messages.push(finalMessage);

      const toolCalls = finalMessage.content.filter((block): block is ToolCall => block.type === "toolCall");

      if (toolCalls.length === 0) {
        this.emitRunDone();

        return;
      }

      if (!this.tools || iteration >= this.settings.maxToolIterations) {
        await this.appendToolResultErrors(
          toolCalls,
          !this.settings.enableKubectlTools
            ? "Tool execution is disabled in AI Agent preferences."
            : "Maximum tool iterations reached.",
        );
        this.emitRunDone();

        return;
      }

      const wasAborted = await this.executeToolCalls(toolCalls);

      if (wasAborted) {
        return;
      }

      if (getTextFromAssistantMessage(finalMessage).trim()) {
        this.context.messages.push({
          role: "user",
          content: "Continue after the tool results. Summarize the evidence and answer the user's debugging request.",
          timestamp: Date.now(),
        });
      }
    }

    this.emitRunDone();
  }

  private async streamAssistantMessage(): Promise<StreamAssistantMessageResult> {
    let finalMessage: AssistantMessage | undefined;

    for await (const event of stream(this.model, this.context, {
      apiKey: this.settings.apiKey,
      signal: this.signal,
      maxTokens: this.settings.maxTokens,
      ...(this.settings.temperature === undefined ? {} : { temperature: this.settings.temperature }),
      ...(this.settings.reasoningEffort === "off" ? {} : { reasoning: this.settings.reasoningEffort }),
    })) {
      switch (event.type) {
        case "text_delta":
          this.emit({ type: "text-delta", tabId: this.request.tabId, runId: this.request.runId, delta: event.delta });
          break;
        case "thinking_start":
          this.emit({ type: "thinking-start", tabId: this.request.tabId, runId: this.request.runId });
          break;
        case "thinking_delta":
          this.emit({
            type: "thinking-delta",
            tabId: this.request.tabId,
            runId: this.request.runId,
            delta: event.delta,
          });
          break;
        case "thinking_end":
          this.emit({ type: "thinking-end", tabId: this.request.tabId, runId: this.request.runId });
          break;
        case "toolcall_start":
          this.emit({
            type: "tool-call-start",
            tabId: this.request.tabId,
            runId: this.request.runId,
            toolCallId: String(event.contentIndex),
          });
          break;
        case "toolcall_delta":
          this.emit({
            type: "tool-call-delta",
            tabId: this.request.tabId,
            runId: this.request.runId,
            delta: event.delta,
          });
          break;
        case "toolcall_end":
          this.emit({
            type: "tool-call-end",
            tabId: this.request.tabId,
            runId: this.request.runId,
            toolCallId: event.toolCall.id,
            name: event.toolCall.name,
            argumentsText: JSON.stringify(event.toolCall.arguments, null, 2),
          });
          break;
        case "done":
          finalMessage = event.message;
          break;
        case "error":
          if (this.signal.aborted) {
            return { didEmitError: false };
          }

          this.emitRunError(event.error.errorMessage || "AI stream failed");

          return { didEmitError: true };
      }
    }

    return { didEmitError: false, finalMessage };
  }

  private async executeToolCalls(toolCalls: ToolCall[]) {
    for (const toolCall of toolCalls) {
      let resultContent: string;
      let isError = false;

      try {
        validateToolCall(this.tools ?? [], toolCall);
        const result = await this.executeKubectlTool(this.clusterId, toolCall, this.signal);

        resultContent = result.content;
        isError = result.isError;
      } catch (error) {
        resultContent = error instanceof Error ? error.message : String(error);
        isError = true;
      }

      this.context.messages.push(toToolResultMessage(toolCall, resultContent, isError));
      this.emit({
        type: "tool-result",
        tabId: this.request.tabId,
        runId: this.request.runId,
        toolCallId: toolCall.id,
        content: resultContent,
        isError,
      });

      if (this.signal.aborted) {
        return true;
      }
    }

    return false;
  }

  private async appendToolResultErrors(toolCalls: ToolCall[], text: string) {
    for (const toolCall of toolCalls) {
      this.context.messages.push(toToolResultMessage(toolCall, text, true));
      this.emit({
        type: "tool-result",
        tabId: this.request.tabId,
        runId: this.request.runId,
        toolCallId: toolCall.id,
        content: text,
        isError: true,
      });
    }
  }

  private emitRunDone() {
    if (!this.signal.aborted) {
      this.emit({ type: "run-done", tabId: this.request.tabId, runId: this.request.runId });
    }
  }

  private emitRunError(error: string) {
    this.emit({
      type: "run-error",
      tabId: this.request.tabId,
      runId: this.request.runId,
      error,
    });
  }
}
