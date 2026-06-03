/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { stream, validateToolCall } from "@earendil-works/pi-ai";
import { normalizeAiAgentSettings } from "../common/settings";
import { toAiAgentLlmMessages } from "../common/transcript";
import { compactAiAgentConversation } from "./ai-agent-chat-compaction";
import { createAiAgentChatModel, createAiAgentSystemPrompt, getAiAgentKubectlTools } from "./ai-agent-chat-context";

import type { AssistantMessage, Context, ToolCall, UserMessage } from "@earendil-works/pi-ai";

import type { ClusterId } from "../../../common/cluster-types";
import type { AiAgentPermissionMode, AiAgentSendRequest, AiAgentStreamEvent } from "../common/channels";
import type { AiAgentSettings } from "../common/settings";
import type { AiAgentToolResultDetails } from "../common/tool-result-details";
import type { AiAgentConversationMessage, AiAgentMessagePart } from "../common/transcript";
import type { AiAgentMcpToolSupport, CreateAiAgentMcpToolSupport } from "./ai-agent-mcp-tool-support.injectable";
import type { ExecuteAiAgentKubectlTool } from "./execute-ai-agent-kubectl-tool.injectable";

const continueAfterToolResultsPrompt =
  "Continue after the tool results. Summarize the evidence and answer the user's debugging request.";

const getTextFromAssistantMessage = (message: AssistantMessage) =>
  message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

const cloneConversationMessage = (message: AiAgentConversationMessage): AiAgentConversationMessage => ({
  ...message,
  parts: message.parts.map((part) => ({ ...part })),
});

const toPendingUserMessage = (content: string): UserMessage => ({
  role: "user",
  content,
  timestamp: Date.now(),
});

const getPendingUserMessageText = (message: UserMessage | undefined) => {
  if (!message) {
    return undefined;
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
};

const toAssistantHistoryParts = (message: AssistantMessage): AiAgentMessagePart[] => {
  const parts: AiAgentMessagePart[] = [];

  for (const part of message.content) {
    switch (part.type) {
      case "text":
        parts.push({ type: "text", text: part.text });
        break;
      case "thinking":
        parts.push({ type: "thinking", text: part.thinking, done: true });
        break;
      case "toolCall":
        parts.push({
          type: "tool_call",
          toolCallId: part.id,
          name: part.name,
          argumentsText: JSON.stringify(part.arguments, null, 2),
          done: true,
        });
        break;
    }
  }

  return parts;
};

interface AiAgentChatSessionOptions {
  request: AiAgentSendRequest;
  rawSettings: AiAgentSettings | undefined;
  clusterId: ClusterId | undefined;
  executeKubectlTool: ExecuteAiAgentKubectlTool;
  emit: (event: AiAgentStreamEvent) => void;
  signal: AbortSignal;
  createMcpToolSupport?: CreateAiAgentMcpToolSupport;
}

interface PendingAsk {
  resolve: (value: { content: string; isError: boolean; details?: any }) => void;
  reject: (reason: any) => void;
  signal: AbortSignal;
}

interface StreamAssistantMessageResult {
  didEmitError: boolean;
  finalMessage?: AssistantMessage;
}

export class AiAgentChatSession {
  private static pendingAsks = new Map<string, PendingAsk>();

  public static handleAskResponse(tabId: string, runId: string, toolCallId: string, results: any) {
    const key = `${tabId}:${runId}:${toolCallId}`;
    const pending = this.pendingAsks.get(key);

    if (pending) {
      this.pendingAsks.delete(key);
      const responseParts: string[] = [];
      const formattedResults: any[] = [];

      for (const res of results) {
        formattedResults.push(res);
        if (res.selectedOptions && res.selectedOptions.length > 0) {
          responseParts.push(`${res.id}: ${res.selectedOptions.join(", ")}`);
        }
        if (res.customInput !== undefined && res.customInput !== "") {
          responseParts.push(`${res.id} (custom): ${res.customInput}`);
        }
      }

      const text =
        responseParts.length > 0 ? `User answers:\n${responseParts.join("\n")}` : "User answered the questions.";

      pending.resolve({
        content: text,
        isError: false,
        details: { results: formattedResults },
      });
    }
  }

  private async executeAskTool(toolCall: ToolCall): Promise<{ content: string; isError: boolean; details?: any }> {
    const key = `${this.request.tabId}:${this.request.runId}:${toolCall.id}`;

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        AiAgentChatSession.pendingAsks.delete(key);
      };

      const onAbort = () => {
        cleanup();
        reject(new Error("Ask tool was cancelled by the user"));
      };

      if (this.signal.aborted) {
        return reject(new Error("Run aborted"));
      }

      this.signal.addEventListener("abort", onAbort);

      AiAgentChatSession.pendingAsks.set(key, {
        resolve: (val) => {
          this.signal.removeEventListener("abort", onAbort);
          resolve(val);
        },
        reject: (err) => {
          this.signal.removeEventListener("abort", onAbort);
          reject(err);
        },
        signal: this.signal,
      });
    });
  }

  private readonly clusterId: ClusterId | undefined;
  private readonly request: AiAgentSendRequest;
  private readonly executeKubectlTool: ExecuteAiAgentKubectlTool;
  private readonly emit: (event: AiAgentStreamEvent) => void;
  private readonly signal: AbortSignal;
  private readonly permissionMode: AiAgentPermissionMode;
  private readonly createMcpToolSupport;
  private readonly settings;
  private readonly model;
  private readonly systemPrompt;
  private readonly historyMetadata;
  private history: AiAgentConversationMessage[];
  private currentAssistantMessageIndex: number | undefined;
  private pendingContinuationPrompt: UserMessage | undefined;
  private tools;
  private mcpToolSupport: AiAgentMcpToolSupport | undefined;

  constructor({
    request,
    rawSettings,
    clusterId,
    executeKubectlTool,
    emit,
    signal,
    createMcpToolSupport,
  }: AiAgentChatSessionOptions) {
    const settings = normalizeAiAgentSettings(rawSettings);
    const permissionMode = request.permissionMode ?? "read-only";
    const model = createAiAgentChatModel(settings);

    this.request = request;
    this.clusterId = clusterId;
    this.executeKubectlTool = executeKubectlTool;
    this.emit = emit;
    this.signal = signal;
    this.permissionMode = permissionMode;
    this.createMcpToolSupport = createMcpToolSupport;
    this.settings = settings;
    this.model = model;
    this.tools = getAiAgentKubectlTools(settings, permissionMode);
    this.systemPrompt = createAiAgentSystemPrompt(clusterId, permissionMode);
    this.historyMetadata = {
      api: model.api,
      provider: model.provider,
      model: model.id,
    };
    this.history = request.messages.map(cloneConversationMessage);
  }

  async run(): Promise<void> {
    try {
      await this.initializeTools();

      if (this.signal.aborted) {
        return;
      }

      this.emit({ type: "run-start", tabId: this.request.tabId, runId: this.request.runId });

      for (let iteration = 0; iteration <= this.settings.maxToolIterations; iteration += 1) {
        if (this.signal.aborted) {
          return;
        }

        const wasAbortedDuringCompaction = await this.maybeCompactHistory();

        if (wasAbortedDuringCompaction) {
          return;
        }

        const { didEmitError, finalMessage } = await this.streamAssistantMessage();

        this.pendingContinuationPrompt = undefined;

        if (this.signal.aborted || didEmitError) {
          return;
        }

        if (!finalMessage) {
          this.emitRunError("AI stream ended without a final message");

          return;
        }

        this.appendAssistantMessageToHistory(finalMessage);

        const toolCalls = finalMessage.content.filter((block): block is ToolCall => block.type === "toolCall");

        if (toolCalls.length === 0) {
          this.emitRunDone();

          return;
        }

        if (!this.tools || iteration >= this.settings.maxToolIterations) {
          await this.appendToolResultErrors(
            toolCalls,
            !this.settings.enableKubectlTools && !this.settings.enableMcpTools
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
          this.pendingContinuationPrompt = toPendingUserMessage(continueAfterToolResultsPrompt);
        }
      }

      this.emitRunDone();
    } finally {
      await this.closeMcpToolSupport();
    }
  }

  private buildContext(): Context {
    const messages = toAiAgentLlmMessages(this.history, this.historyMetadata);

    if (this.pendingContinuationPrompt) {
      messages.push(this.pendingContinuationPrompt);
    }

    return {
      systemPrompt: this.systemPrompt,
      messages,
      tools: this.tools,
    };
  }

  private async initializeTools() {
    if (!this.createMcpToolSupport || !this.settings.enableMcpTools) {
      return;
    }

    this.mcpToolSupport = await this.createMcpToolSupport(this.settings, this.permissionMode, this.signal);

    const tools = [...(this.tools ?? []), ...(this.mcpToolSupport?.tools ?? [])];

    this.tools = tools.length > 0 ? tools : undefined;
  }

  private async closeMcpToolSupport() {
    await this.mcpToolSupport?.close();
    this.mcpToolSupport = undefined;
  }

  private async maybeCompactHistory() {
    try {
      const hadActiveAssistant = this.currentAssistantMessageIndex !== undefined;
      const compactionResult = await compactAiAgentConversation({
        messages: this.history,
        settings: this.settings,
        model: this.model,
        apiKey: this.settings.apiKey,
        signal: this.signal,
        systemPrompt: this.systemPrompt,
        tools: this.tools,
        extraText: getPendingUserMessageText(this.pendingContinuationPrompt),
      });

      if (this.signal.aborted || !compactionResult) {
        return this.signal.aborted;
      }

      this.history = compactionResult.messages.map(cloneConversationMessage);
      this.currentAssistantMessageIndex =
        hadActiveAssistant && this.history[this.history.length - 1]?.role === "assistant"
          ? this.history.length - 1
          : undefined;

      this.emit({
        type: "history-compacted",
        tabId: this.request.tabId,
        runId: this.request.runId,
        messages: this.getHistoryForRenderer(),
      });

      return false;
    } catch (error) {
      if (this.signal.aborted) {
        return true;
      }

      throw error;
    }
  }

  private getHistoryForRenderer() {
    return this.history
      .filter((_message, index) => index !== this.currentAssistantMessageIndex)
      .map(cloneConversationMessage);
  }

  private appendAssistantMessageToHistory(message: AssistantMessage) {
    const parts = toAssistantHistoryParts(message);

    if (parts.length === 0) {
      return;
    }

    if (this.currentAssistantMessageIndex === undefined) {
      this.history.push({
        role: "assistant",
        createdAt: message.timestamp,
        parts,
      });
      this.currentAssistantMessageIndex = this.history.length - 1;

      return;
    }

    const currentAssistantMessage = this.history[this.currentAssistantMessageIndex];

    if (!currentAssistantMessage || currentAssistantMessage.role !== "assistant") {
      return;
    }

    this.history[this.currentAssistantMessageIndex] = {
      ...currentAssistantMessage,
      parts: [...currentAssistantMessage.parts, ...parts],
    };
  }

  private appendToolResultToHistory(
    toolCall: ToolCall,
    content: string,
    isError: boolean,
    details?: AiAgentToolResultDetails,
  ) {
    if (this.currentAssistantMessageIndex === undefined) {
      return;
    }

    const currentAssistantMessage = this.history[this.currentAssistantMessageIndex];

    if (!currentAssistantMessage || currentAssistantMessage.role !== "assistant") {
      return;
    }

    this.history[this.currentAssistantMessageIndex] = {
      ...currentAssistantMessage,
      parts: [
        ...currentAssistantMessage.parts,
        {
          type: "tool_result",
          toolCallId: toolCall.id,
          content,
          isError,
          details,
        },
      ],
    };
  }

  private async streamAssistantMessage(): Promise<StreamAssistantMessageResult> {
    let finalMessage: AssistantMessage | undefined;

    for await (const event of stream(this.model, this.buildContext(), {
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
      let details;

      try {
        if (toolCall.name === "ask") {
          const result = await this.executeAskTool(toolCall);
          resultContent = result.content;
          isError = result.isError;
          details = result.details;
        } else {
          validateToolCall(this.tools ?? [], toolCall);
          const result = this.mcpToolSupport?.hasTool(toolCall.name)
            ? await this.mcpToolSupport.execute(toolCall, this.signal)
            : await this.executeKubectlTool(this.clusterId, toolCall, this.signal);

          resultContent =
            typeof result.content === "string" ? result.content : result.content ? JSON.stringify(result.content) : "";
          isError = result.isError;
          details = result.details;
        }
      } catch (error) {
        resultContent = error instanceof Error ? error.message : String(error);
        isError = true;
      }

      this.appendToolResultToHistory(toolCall, resultContent, isError, details);
      this.emit({
        type: "tool-result",
        tabId: this.request.tabId,
        runId: this.request.runId,
        toolCallId: toolCall.id,
        content: resultContent,
        isError,
        details,
      });

      if (this.signal.aborted) {
        return true;
      }
    }

    return false;
  }

  private async appendToolResultErrors(toolCalls: ToolCall[], text: string) {
    for (const toolCall of toolCalls) {
      this.appendToolResultToHistory(toolCall, text, true);
      this.emit({
        type: "tool-result",
        tabId: this.request.tabId,
        runId: this.request.runId,
        toolCallId: toolCall.id,
        content: text,
        isError: true,
        details: undefined,
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
