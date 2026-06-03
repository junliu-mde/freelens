/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { action, makeObservable } from "mobx";
import { type AiAgentPermissionMode, aiAgentAskResponseChannel } from "../../../../features/ai-agent/common/channels";
import {
  type AiAgentConversationMessage,
  type AiAgentMessage,
  type AiAgentMessagePart,
  type AiAgentRunStatus,
  finalizeAiAgentMessagesForSave,
  hydrateAiAgentMessages,
  toAiAgentConversationHistory,
} from "../../../../features/ai-agent/common/transcript";
import { DockTabStore } from "../dock-tab-store/dock-tab.store";
import { type AiAgentSession, AiAgentSessionsRepository } from "./sessions-repository";

import type { IpcRenderer } from "electron";

import type { AiAgentToolResultDetails } from "../../../../features/ai-agent/common/tool-result-details";
import type { TabId } from "../dock/store";
import type { DockTabStoreDependencies } from "../dock-tab-store/dock-tab.store";

export type { AiAgentSession } from "./sessions-repository";
export type { AiAgentMessage, AiAgentMessagePart, AiAgentRunStatus };

export type AiAgentTabStatus = "idle" | "streaming" | "waiting-for-tool" | "aborted" | "error";

export interface AiAgentTabData {
  inputDraft: string;
  messages: AiAgentMessage[];
  selectedModelId?: string;
  status: AiAgentTabStatus;
  activeRunId?: string;
  clusterId?: string;
  sessionId: string;
  permissionMode: AiAgentPermissionMode;
  isNearBottom: boolean;
  hasUnreadBelow: boolean;
  lastCompactionAt?: number;
  lastCompactionSummaryPreview?: string;
  sessionSearch: string;
}

export interface AiAgentTabStoreDependencies extends DockTabStoreDependencies {
  ipcRenderer: IpcRenderer;
}

type MutableAiAgentMessagePart = AiAgentMessagePart;

const defaultUiState = (): Pick<
  AiAgentTabData,
  "hasUnreadBelow" | "isNearBottom" | "lastCompactionAt" | "lastCompactionSummaryPreview" | "sessionSearch"
> => ({
  isNearBottom: true,
  hasUnreadBelow: false,
  lastCompactionAt: undefined,
  lastCompactionSummaryPreview: undefined,
  sessionSearch: "",
});

const createEmptyTabData = (sessionId: string, clusterId?: string): AiAgentTabData => ({
  inputDraft: "",
  messages: [],
  status: "idle",
  activeRunId: undefined,
  clusterId,
  sessionId,
  permissionMode: "read-only",
  ...defaultUiState(),
});

const normalizeAiAgentTabData = (
  data: Partial<AiAgentTabData> & Pick<AiAgentTabData, "messages" | "inputDraft" | "sessionId" | "permissionMode">,
): AiAgentTabData => ({
  inputDraft: data.inputDraft,
  messages: data.messages,
  selectedModelId: data.selectedModelId,
  status: data.status ?? "idle",
  activeRunId: data.activeRunId,
  clusterId: data.clusterId,
  sessionId: data.sessionId,
  permissionMode: data.permissionMode,
  isNearBottom: data.isNearBottom ?? true,
  hasUnreadBelow: data.hasUnreadBelow ?? false,
  lastCompactionAt: data.lastCompactionAt,
  lastCompactionSummaryPreview: data.lastCompactionSummaryPreview,
  sessionSearch: data.sessionSearch ?? "",
});

const getLastCompactionSummaryPreview = (messages: AiAgentConversationMessage[]) => {
  const part = [...messages]
    .reverse()
    .flatMap((message) => [...message.parts].reverse())
    .find(
      (item): item is Extract<AiAgentMessagePart, { type: "compaction_summary" }> => item.type === "compaction_summary",
    );

  if (!part?.summary?.trim()) {
    return undefined;
  }

  const firstLine = part.summary
    .trim()
    .split("\n")
    .find((line) => line.trim());

  if (!firstLine) {
    return undefined;
  }

  return firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine;
};

export class AiAgentTabStore extends DockTabStore<AiAgentTabData> {
  private readonly sessionsRepository: AiAgentSessionsRepository;

  constructor(protected readonly dependencies: AiAgentTabStoreDependencies) {
    super(dependencies, {
      storageKey: "ai_agent",
    });
    this.sessionsRepository = new AiAgentSessionsRepository(this.dependencies.createStorage);
    makeObservable(this);

    // Active cleanup of input draft on restart / initialization
    for (const tabId of Object.keys(this.getAllData())) {
      const data = this.getData(tabId);

      if (data?.inputDraft) {
        this.setInputDraft(tabId, "");
      }
    }
  }

  protected finalizeDataForSave(data: AiAgentTabData): AiAgentTabData {
    return {
      ...data,
      inputDraft: "",
      status: "idle",
      activeRunId: undefined,
      messages: finalizeAiAgentMessagesForSave(data.messages),
      ...defaultUiState(),
    };
  }

  initTab(tabId: TabId): AiAgentTabData {
    const existingData = this.getData(tabId);

    if (existingData) {
      return normalizeAiAgentTabData(existingData);
    }

    const sessionId = "temp-session";
    return createEmptyTabData(sessionId);
  }

  @action
  createTabState(tabId: TabId): AiAgentTabData {
    const existingData = this.getData(tabId);

    if (existingData) {
      const normalizedData = normalizeAiAgentTabData(existingData);

      // Defend against legacy 'temp-session' being leaked and cached in store
      if (normalizedData.sessionId === "temp-session") {
        normalizedData.sessionId = crypto.randomUUID();
        this.setData(tabId, normalizedData);
        this.saveSession(
          tabId,
          normalizedData.sessionId,
          normalizedData.messages,
          normalizedData.clusterId,
          normalizedData.permissionMode,
        );
      }

      const needsNormalization =
        existingData.status === undefined ||
        existingData.isNearBottom === undefined ||
        existingData.hasUnreadBelow === undefined ||
        existingData.sessionSearch === undefined;

      if (needsNormalization) {
        this.setData(tabId, normalizedData);
      }

      return normalizedData;
    }

    const sessionId = crypto.randomUUID();
    const data = createEmptyTabData(sessionId);

    this.setData(tabId, data);
    this.saveSession(tabId, sessionId, data.messages, data.clusterId, data.permissionMode);

    return data;
  }

  @action
  setInputDraft(tabId: TabId, inputDraft: string): void {
    this.updateTab(tabId, (data) => ({
      ...data,
      inputDraft,
    }));
  }

  @action
  setClusterId(tabId: TabId, clusterId: string): void {
    const nextData = this.updateTab(tabId, (data) => ({
      ...data,
      clusterId,
    }));

    this.saveSession(tabId, nextData.sessionId, nextData.messages, nextData.clusterId, nextData.permissionMode);
  }

  @action
  setPermissionMode(tabId: TabId, permissionMode: AiAgentPermissionMode): void {
    const nextData = this.updateTab(tabId, (data) => ({
      ...data,
      permissionMode,
    }));

    this.saveSession(tabId, nextData.sessionId, nextData.messages, nextData.clusterId, nextData.permissionMode);
  }

  @action
  togglePermissionMode(tabId: TabId): void {
    const data = this.initTab(tabId);

    this.setPermissionMode(tabId, data.permissionMode === "read-only" ? "read-write" : "read-only");
  }

  @action
  setSessionSearch(tabId: TabId, sessionSearch: string): void {
    this.updateTab(tabId, (data) => ({
      ...data,
      sessionSearch,
    }));
  }

  @action
  setScrollState(tabId: TabId, state: Partial<Pick<AiAgentTabData, "hasUnreadBelow" | "isNearBottom">>): void {
    const nextState = Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined)) as Partial<
      Pick<AiAgentTabData, "hasUnreadBelow" | "isNearBottom">
    >;

    this.updateTab(tabId, (data) => ({
      ...data,
      ...nextState,
    }));
  }

  @action
  appendUserMessage(tabId: TabId, text: string): AiAgentMessage {
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

    this.updateTab(tabId, (data) => ({
      ...data,
      inputDraft: "",
      messages: [...data.messages, message],
    }));

    return message;
  }

  @action
  startAssistantMessage(tabId: TabId, runId: string): AiAgentMessage {
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

    this.updateTab(tabId, (data) => ({
      ...data,
      status: "streaming",
      activeRunId: runId,
      messages: [...data.messages, message],
    }));

    return message;
  }

  @action
  appendTextDelta(tabId: TabId, runId: string, delta: string): void {
    this.updateAssistantMessage(tabId, runId, "streaming", (message) => {
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
    });
  }

  @action
  startThinking(tabId: TabId, runId: string): void {
    this.appendAssistantPart(
      tabId,
      runId,
      {
        type: "thinking",
        text: "",
        done: false,
      },
      "streaming",
    );
  }

  @action
  appendThinkingDelta(tabId: TabId, runId: string, delta: string): void {
    this.updateLastAssistantPart(
      tabId,
      runId,
      "thinking",
      (part) => ({
        ...part,
        text: part.text + delta,
      }),
      "streaming",
    );
  }

  @action
  finishThinking(tabId: TabId, runId: string): void {
    this.updateLastAssistantPart(
      tabId,
      runId,
      "thinking",
      (part) => ({
        ...part,
        done: true,
      }),
      "streaming",
    );
  }

  @action
  startToolCall(tabId: TabId, runId: string, toolCallId: string, name = "tool_call"): void {
    this.appendAssistantPart(
      tabId,
      runId,
      {
        type: "tool_call",
        toolCallId,
        name,
        argumentsText: "",
        done: false,
        startedAt: Date.now(),
      },
      "waiting-for-tool",
    );
  }

  @action
  appendToolCallDelta(tabId: TabId, runId: string, delta: string): void {
    this.updateLastAssistantPart(
      tabId,
      runId,
      "tool_call",
      (part) => ({
        ...part,
        argumentsText: part.argumentsText + delta,
      }),
      "waiting-for-tool",
    );
  }

  @action
  finishToolCall(tabId: TabId, runId: string, toolCallId: string, name: string, argumentsText: string): void {
    this.updateLastAssistantPart(
      tabId,
      runId,
      "tool_call",
      (part) => ({
        ...part,
        toolCallId,
        name,
        argumentsText,
        done: true,
        runningAt: part.runningAt ?? Date.now(),
      }),
      "waiting-for-tool",
    );
  }

  @action
  appendToolResult(
    tabId: TabId,
    runId: string,
    toolCallId: string,
    content: string,
    isError: boolean,
    details?: AiAgentToolResultDetails,
  ): void {
    this.appendAssistantPart(
      tabId,
      runId,
      {
        type: "tool_result",
        toolCallId,
        content,
        isError,
        details,
        completedAt: Date.now(),
      },
      "waiting-for-tool",
    );
  }

  @action
  replaceConversationHistory(tabId: TabId, runId: string, history: AiAgentConversationMessage[]): void {
    const data = this.initTab(tabId);
    const activeAssistantMessage = data.messages.find(
      (message) => message.role === "assistant" && message.runId === runId && message.status === "streaming",
    );
    const nextData = {
      ...data,
      messages: [...hydrateAiAgentMessages(history), ...(activeAssistantMessage ? [activeAssistantMessage] : [])],
      lastCompactionAt: Date.now(),
      lastCompactionSummaryPreview: getLastCompactionSummaryPreview(history),
    };

    this.setData(tabId, nextData);
    this.saveSession(tabId, nextData.sessionId, nextData.messages, nextData.clusterId, nextData.permissionMode);
  }

  @action
  finishRun(tabId: TabId, runId: string, status: Exclude<AiAgentRunStatus, "idle" | "streaming">): void {
    const nextData = this.updateTab(tabId, (data) => ({
      ...data,
      status: status === "done" ? "idle" : status,
      activeRunId: data.activeRunId === runId ? undefined : data.activeRunId,
      messages: data.messages.map((message) =>
        message.role === "assistant" && message.runId === runId
          ? {
              ...message,
              status,
            }
          : message,
      ),
    }));

    this.saveSession(tabId, nextData.sessionId, nextData.messages, nextData.clusterId, nextData.permissionMode);
  }

  @action
  appendError(tabId: TabId, runId: string, message: string): void {
    this.updateTab(tabId, (data) => ({
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
    }));
  }

  @action
  clear(tabId: TabId): void {
    const data = this.initTab(tabId);

    this.saveSession(tabId, data.sessionId, data.messages, data.clusterId, data.permissionMode);
    this.setData(tabId, createEmptyTabData(crypto.randomUUID(), data.clusterId));
  }

  autoSaveSession(tabId: TabId): void {
    const data = this.getData(tabId);

    if (data && data.messages.length > 0) {
      this.saveSession(tabId, data.sessionId, data.messages, data.clusterId, data.permissionMode);
    }
  }

  getConversationMessages(tabId: TabId): AiAgentConversationMessage[] {
    return toAiAgentConversationHistory(this.initTab(tabId).messages);
  }

  getSession(sessionId: string) {
    return this.sessionsRepository.get(sessionId);
  }

  getSessionsForCluster(clusterId?: string): AiAgentSession[] {
    return this.sessionsRepository.listForCluster(clusterId);
  }

  renameSession(sessionId: string, title: string): void {
    this.sessionsRepository.rename(sessionId, title);
  }

  @action
  submitAskResponse(tabId: TabId, runId: string, toolCallId: string, results: any): void {
    this.dependencies.ipcRenderer.send(aiAgentAskResponseChannel, tabId, runId, toolCallId, results);
  }

  @action
  switchToSession(tabId: TabId, sessionId: string): void {
    const data = this.initTab(tabId);
    const session = this.sessionsRepository.get(sessionId);

    if (!session) {
      return;
    }

    this.saveSession(tabId, data.sessionId, data.messages, data.clusterId, data.permissionMode);
    this.setData(tabId, {
      ...createEmptyTabData(session.id, session.clusterId ?? data.clusterId),
      messages: session.messages,
      permissionMode: session.permissionMode ?? "read-only",
    });
  }

  @action
  newSession(tabId: TabId): void {
    this.clear(tabId);
  }

  @action
  deleteSession(tabId: TabId, sessionId: string): void {
    const data = this.initTab(tabId);

    this.sessionsRepository.delete(sessionId);

    if (data.sessionId !== sessionId) {
      return;
    }

    const nextSession = this.sessionsRepository.listForCluster(data.clusterId)[0];

    if (nextSession) {
      this.setData(tabId, {
        ...createEmptyTabData(nextSession.id, nextSession.clusterId ?? data.clusterId),
        messages: nextSession.messages,
        permissionMode: nextSession.permissionMode ?? "read-only",
      });

      return;
    }

    this.setData(tabId, createEmptyTabData(crypto.randomUUID(), data.clusterId));
  }

  private updateTab(tabId: TabId, update: (data: AiAgentTabData) => AiAgentTabData) {
    let currentData = this.getData(tabId);
    let isNew = false;

    if (!currentData) {
      currentData = this.initTab(tabId);
      isNew = true;
    }

    const nextData = update(currentData);

    if (isNew && nextData.sessionId === "temp-session") {
      nextData.sessionId = crypto.randomUUID();
    }

    this.setData(tabId, nextData);

    return nextData;
  }

  private updateAssistantMessage(
    tabId: TabId,
    runId: string,
    status: Extract<AiAgentTabStatus, "streaming" | "waiting-for-tool">,
    update: (message: AiAgentMessage) => AiAgentMessage,
  ) {
    this.updateTab(tabId, (data) => ({
      ...data,
      status,
      messages: data.messages.map((message) =>
        message.role === "assistant" && message.runId === runId ? update(message) : message,
      ),
    }));
  }

  private appendAssistantPart(
    tabId: TabId,
    runId: string,
    part: MutableAiAgentMessagePart,
    status: Extract<AiAgentTabStatus, "streaming" | "waiting-for-tool">,
  ): void {
    this.updateAssistantMessage(tabId, runId, status, (message) => ({
      ...message,
      parts: [...message.parts, part],
    }));
  }

  private updateLastAssistantPart<TType extends AiAgentMessagePart["type"]>(
    tabId: TabId,
    runId: string,
    type: TType,
    update: (part: Extract<AiAgentMessagePart, { type: TType }>) => Extract<AiAgentMessagePart, { type: TType }>,
    status: Extract<AiAgentTabStatus, "streaming" | "waiting-for-tool">,
  ): void {
    this.updateAssistantMessage(tabId, runId, status, (message) => {
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
    });
  }

  private saveSession(
    tabId: TabId,
    sessionId: string,
    messages: AiAgentMessage[],
    clusterId?: string,
    permissionMode?: AiAgentPermissionMode,
  ): void {
    void tabId;
    this.sessionsRepository.save(sessionId, messages, clusterId, permissionMode);
  }
}
