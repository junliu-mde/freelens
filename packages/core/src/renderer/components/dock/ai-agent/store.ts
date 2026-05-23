/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { DockTabStore } from "../dock-tab-store/dock-tab.store";

import type { DockTabStoreDependencies } from "../dock-tab-store/dock-tab.store";
import type { TabId } from "../dock/store";

export type AiAgentMessageRole = "user" | "assistant";

export type AiAgentRunStatus = "idle" | "streaming" | "done" | "error" | "aborted";

export interface AiAgentTextPart {
  type: "text";
  text: string;
}

export interface AiAgentThinkingPart {
  type: "thinking";
  text: string;
  done: boolean;
}

export interface AiAgentToolCallPart {
  type: "tool_call";
  toolCallId: string;
  name: string;
  argumentsText: string;
  done: boolean;
}

export interface AiAgentToolResultPart {
  type: "tool_result";
  toolCallId: string;
  content: string;
  isError: boolean;
}

export interface AiAgentErrorPart {
  type: "error";
  message: string;
}

export type AiAgentMessagePart =
  | AiAgentTextPart
  | AiAgentThinkingPart
  | AiAgentToolCallPart
  | AiAgentToolResultPart
  | AiAgentErrorPart;

export interface AiAgentMessage {
  id: string;
  role: AiAgentMessageRole;
  createdAt: number;
  runId?: string;
  status: AiAgentRunStatus;
  parts: AiAgentMessagePart[];
}

export interface AiAgentTabData {
  inputDraft: string;
  messages: AiAgentMessage[];
  selectedModelId?: string;
  status: AiAgentRunStatus;
  activeRunId?: string;
  clusterId?: string;
}

export interface AiAgentTabStoreDependencies extends DockTabStoreDependencies {}

type MutableAiAgentMessagePart = AiAgentMessagePart;

export class AiAgentTabStore extends DockTabStore<AiAgentTabData> {
  constructor(protected readonly dependencies: AiAgentTabStoreDependencies) {
    super(dependencies, {
      storageKey: "ai_agent",
    });
  }

  protected finalizeDataForSave(data: AiAgentTabData): AiAgentTabData {
    return {
      ...data,
      status: data.status === "streaming" ? "idle" : data.status,
      activeRunId: undefined,
      messages: data.messages.map((message) => ({
        ...message,
        status: message.status === "streaming" ? "done" : message.status,
      })),
    };
  }

  initTab(tabId: TabId): AiAgentTabData {
    const existingData = this.getData(tabId);

    if (existingData) {
      return existingData;
    }

    const data: AiAgentTabData = {
      inputDraft: "",
      messages: [],
      status: "idle",
      clusterId: undefined,
    };

    this.setData(tabId, data);

    return data;
  }

  setInputDraft(tabId: TabId, inputDraft: string): void {
    const data = this.initTab(tabId);

    this.setData(tabId, {
      ...data,
      inputDraft,
    });
  }

  setClusterId(tabId: TabId, clusterId: string): void {
    const data = this.initTab(tabId);

    this.setData(tabId, {
      ...data,
      clusterId,
    });
  }

  appendUserMessage(tabId: TabId, text: string): AiAgentMessage {
    const data = this.initTab(tabId);
    const message: AiAgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      createdAt: Date.now(),
      status: "done",
      parts: [
        {
          type: "text",
          text,
        },
      ],
    };

    this.setData(tabId, {
      ...data,
      inputDraft: "",
      messages: [...data.messages, message],
    });

    return message;
  }

  startAssistantMessage(tabId: TabId, runId: string): AiAgentMessage {
    const data = this.initTab(tabId);
    const message: AiAgentMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      createdAt: Date.now(),
      runId,
      status: "streaming",
      parts: [
        {
          type: "text",
          text: "",
        },
      ],
    };

    this.setData(tabId, {
      ...data,
      status: "streaming",
      activeRunId: runId,
      messages: [...data.messages, message],
    });

    return message;
  }

  appendTextDelta(tabId: TabId, runId: string, delta: string): void {
    const data = this.initTab(tabId);

    this.setData(tabId, {
      ...data,
      messages: data.messages.map((message) => {
        if (message.role !== "assistant" || message.runId !== runId) {
          return message;
        }

        const parts = [...message.parts];
        const lastPart = parts[parts.length - 1];

        if (lastPart?.type === "text") {
          parts[parts.length - 1] = {
            ...lastPart,
            text: lastPart.text + delta,
          };
        } else {
          parts.push({
            type: "text",
            text: delta,
          });
        }

        return {
          ...message,
          parts,
        };
      }),
    });
  }

  startThinking(tabId: TabId, runId: string): void {
    this.appendAssistantPart(tabId, runId, {
      type: "thinking",
      text: "",
      done: false,
    });
  }

  appendThinkingDelta(tabId: TabId, runId: string, delta: string): void {
    this.updateLastAssistantPart(tabId, runId, "thinking", (part) => ({
      ...part,
      text: part.text + delta,
    }));
  }

  finishThinking(tabId: TabId, runId: string): void {
    this.updateLastAssistantPart(tabId, runId, "thinking", (part) => ({
      ...part,
      done: true,
    }));
  }

  startToolCall(tabId: TabId, runId: string, toolCallId: string, name = "tool_call"): void {
    this.appendAssistantPart(tabId, runId, {
      type: "tool_call",
      toolCallId,
      name,
      argumentsText: "",
      done: false,
    });
  }

  appendToolCallDelta(tabId: TabId, runId: string, delta: string): void {
    this.updateLastAssistantPart(tabId, runId, "tool_call", (part) => ({
      ...part,
      argumentsText: part.argumentsText + delta,
    }));
  }

  finishToolCall(tabId: TabId, runId: string, toolCallId: string, name: string, argumentsText: string): void {
    this.updateLastAssistantPart(tabId, runId, "tool_call", (part) => ({
      ...part,
      toolCallId,
      name,
      argumentsText,
      done: true,
    }));
  }

  appendToolResult(tabId: TabId, runId: string, toolCallId: string, content: string, isError: boolean): void {
    this.appendAssistantPart(tabId, runId, {
      type: "tool_result",
      toolCallId,
      content,
      isError,
    });
  }

  finishRun(tabId: TabId, runId: string, status: Exclude<AiAgentRunStatus, "idle" | "streaming">): void {
    const data = this.initTab(tabId);

    this.setData(tabId, {
      ...data,
      status,
      activeRunId: data.activeRunId === runId ? undefined : data.activeRunId,
      messages: data.messages.map((message) =>
        message.role === "assistant" && message.runId === runId
          ? {
              ...message,
              status,
            }
          : message,
      ),
    });
  }

  appendError(tabId: TabId, runId: string, message: string): void {
    const data = this.initTab(tabId);

    this.setData(tabId, {
      ...data,
      messages: data.messages.map((chatMessage) =>
        chatMessage.role === "assistant" && chatMessage.runId === runId
          ? {
              ...chatMessage,
              parts: [
                ...chatMessage.parts,
                {
                  type: "error" as const,
                  message,
                },
              ],
            }
          : chatMessage,
      ),
    });
  }

  clear(tabId: TabId): void {
    const data = this.initTab(tabId);

    this.setData(tabId, {
      inputDraft: "",
      messages: [],
      status: "idle",
      clusterId: data.clusterId,
    });
  }

  private appendAssistantPart(tabId: TabId, runId: string, part: MutableAiAgentMessagePart): void {
    const data = this.initTab(tabId);

    this.setData(tabId, {
      ...data,
      messages: data.messages.map((message) =>
        message.role === "assistant" && message.runId === runId
          ? {
              ...message,
              parts: [...message.parts, part],
            }
          : message,
      ),
    });
  }

  private updateLastAssistantPart<TType extends AiAgentMessagePart["type"]>(
    tabId: TabId,
    runId: string,
    type: TType,
    update: (part: Extract<AiAgentMessagePart, { type: TType }>) => Extract<AiAgentMessagePart, { type: TType }>,
  ): void {
    const data = this.initTab(tabId);

    this.setData(tabId, {
      ...data,
      messages: data.messages.map((message) => {
        if (message.role !== "assistant" || message.runId !== runId) {
          return message;
        }

        const index = message.parts.findLastIndex((part) => part.type === type);

        if (index < 0) {
          return message;
        }

        const parts = [...message.parts];
        parts[index] = update(parts[index] as Extract<AiAgentMessagePart, { type: TType }>);

        return {
          ...message,
          parts,
        };
      }),
    });
  }
}
