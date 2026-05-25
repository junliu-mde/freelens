/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observable, reaction } from "mobx";
import {
  type AiAgentConversationMessage,
  type AiAgentMessage,
  type AiAgentMessagePart,
  type AiAgentRunStatus,
  deriveAiAgentSessionTitle,
  finalizeAiAgentMessagesForSave,
  toAiAgentConversationHistory,
} from "../../../../features/ai-agent/common/transcript";
import { DockTabStore } from "../dock-tab-store/dock-tab.store";

import type { AiAgentPermissionMode } from "../../../../features/ai-agent/common/channels";
import type { StorageLayer } from "../../../utils/storage-helper";
import type { TabId } from "../dock/store";
import type { DockTabStoreDependencies } from "../dock-tab-store/dock-tab.store";

export type { AiAgentMessage, AiAgentMessagePart, AiAgentRunStatus };

export interface AiAgentTabData {
  inputDraft: string;
  messages: AiAgentMessage[];
  selectedModelId?: string;
  status: AiAgentRunStatus;
  activeRunId?: string;
  clusterId?: string;
  sessionId: string;
  permissionMode: AiAgentPermissionMode;
}

export interface AiAgentSession {
  id: string;
  title: string;
  messages: AiAgentMessage[];
  clusterId?: string;
  permissionMode?: AiAgentPermissionMode;
  createdAt: number;
  updatedAt: number;
}

export interface AiAgentTabStoreDependencies extends DockTabStoreDependencies {}

type MutableAiAgentMessagePart = AiAgentMessagePart;

export interface AiAgentSessionsStorage {
  sessions: Record<string, AiAgentSession>;
}

export class AiAgentTabStore extends DockTabStore<AiAgentTabData> {
  private readonly sessions = observable.map<string, AiAgentSession>();
  private sessionsStorage?: StorageLayer<AiAgentSessionsStorage>;

  constructor(protected readonly dependencies: AiAgentTabStoreDependencies) {
    super(dependencies, {
      storageKey: "ai_agent",
    });

    // Create a separate storage for sessions
    this.sessionsStorage = this.dependencies.createStorage("ai_agent_sessions", { sessions: {} });

    // Load sessions from storage
    const stored = this.sessionsStorage.get().sessions;

    for (const [id, session] of Object.entries(stored)) {
      this.sessions.set(id, session);
    }

    // Persist sessions on change
    reaction(
      () => this.sessionsToJSON(),
      (data) => {
        this.sessionsStorage?.set({ sessions: data });
      },
    );
  }

  protected finalizeDataForSave(data: AiAgentTabData): AiAgentTabData {
    return {
      ...data,
      status: data.status === "streaming" ? "idle" : data.status,
      activeRunId: undefined,
      messages: finalizeAiAgentMessagesForSave(data.messages),
    };
  }

  initTab(tabId: TabId): AiAgentTabData {
    const existingData = this.getData(tabId);

    if (existingData) {
      return existingData;
    }

    const sessionId = crypto.randomUUID();
    const data: AiAgentTabData = {
      inputDraft: "",
      messages: [],
      status: "idle",
      clusterId: undefined,
      sessionId,
      permissionMode: "read-only",
    };

    this.setData(tabId, data);
    this.saveSession(tabId, sessionId, data.messages, data.clusterId, data.permissionMode);

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

  setPermissionMode(tabId: TabId, permissionMode: AiAgentPermissionMode): void {
    const data = this.initTab(tabId);

    this.setData(tabId, {
      ...data,
      permissionMode,
    });
  }

  togglePermissionMode(tabId: TabId): void {
    const data = this.initTab(tabId);

    this.setData(tabId, {
      ...data,
      permissionMode: data.permissionMode === "read-only" ? "read-write" : "read-only",
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

    // Save current session before clearing
    this.saveSession(tabId, data.sessionId, data.messages, data.clusterId, data.permissionMode);

    // Start a new session
    const sessionId = crypto.randomUUID();

    this.setData(tabId, {
      inputDraft: "",
      messages: [],
      status: "idle",
      clusterId: data.clusterId,
      sessionId,
      permissionMode: "read-only",
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

  // ── Session management ──────────────────────────────────────────────

  private sessionsToJSON(): Record<string, AiAgentSession> {
    return Object.fromEntries(this.sessions);
  }

  private saveSession(
    tabId: TabId,
    sessionId: string,
    messages: AiAgentMessage[],
    clusterId?: string,
    permissionMode?: AiAgentPermissionMode,
  ): void {
    if (!messages.length) return;

    const existing = this.sessions.get(sessionId);
    const title = this.deriveSessionTitle(messages);
    const now = Date.now();

    this.sessions.set(sessionId, {
      id: sessionId,
      title,
      messages: finalizeAiAgentMessagesForSave(messages),
      clusterId,
      permissionMode: permissionMode ?? existing?.permissionMode,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  private deriveSessionTitle(messages: AiAgentMessage[]): string {
    return deriveAiAgentSessionTitle(messages);
  }

  /** Auto-save current session when messages change */
  autoSaveSession(tabId: TabId): void {
    const data = this.getData(tabId);

    if (data && data.messages.length > 0) {
      this.saveSession(tabId, data.sessionId, data.messages, data.clusterId, data.permissionMode);
    }
  }

  getConversationMessages(tabId: TabId): AiAgentConversationMessage[] {
    return toAiAgentConversationHistory(this.initTab(tabId).messages);
  }

  getSessionsForCluster(clusterId?: string): AiAgentSession[] {
    const sessions = Array.from(this.sessions.values());

    if (!clusterId) return sessions.sort((a, b) => b.updatedAt - a.updatedAt);

    return sessions.filter((s) => !s.clusterId || s.clusterId === clusterId).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  switchToSession(tabId: TabId, sessionId: string): void {
    const data = this.initTab(tabId);
    const session = this.sessions.get(sessionId);

    if (!session) return;

    // Save current session first
    this.saveSession(tabId, data.sessionId, data.messages, data.clusterId);

    // Load the target session
    this.setData(tabId, {
      inputDraft: "",
      messages: session.messages,
      status: "idle",
      clusterId: session.clusterId ?? data.clusterId,
      sessionId: session.id,
      permissionMode: session.permissionMode ?? "read-only",
    });
  }

  newSession(tabId: TabId): void {
    this.clear(tabId);
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
