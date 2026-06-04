/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { estimateAiAgentConversationTokens } from "../../../../features/ai-agent/common/compaction";
import {
  getAiAgentContextWindow,
  minimumAiAgentContextWindow,
} from "../../../../features/ai-agent/common/model-context-window";
import {
  deriveAiAgentSessionTitle,
  getAiAgentFirstRealUserPrompt,
  getAiAgentTextFromMessage,
  getAiAgentUserTurnCount,
  isAiAgentCompactionMessage,
} from "../../../../features/ai-agent/common/transcript";

import type { AiAgentToolResultDetails } from "../../../../features/ai-agent/common/tool-result-details";
import type { AiAgentMessage, AiAgentMessagePart, AiAgentSession, AiAgentTabData, AiAgentTabStatus } from "./store";

export interface AiAgentContextIndicatorViewModel {
  estimatedTokens: number;
  label: string;
  progress: number;
  tone: "normal" | "warning" | "recently-compacted";
}

export interface AiAgentSessionListItemViewModel {
  id: string;
  title: string;
  updatedAt: number;
  turnCount: number;
  clusterLabel: string;
  searchText: string;
  active: boolean;
}

export type AiAgentExecutionStage = "building" | "running" | "done" | "error" | "aborted" | "timeout";

export interface AiAgentToolExecutionBlock {
  type: "tool";
  id: string;
  toolCallId: string;
  runId?: string;
  name: string;
  parameterSummary: string;
  argumentsText: string;
  stage: AiAgentExecutionStage;
  durationMs?: number;
  output?: string;
  isError: boolean;
  details?: AiAgentToolResultDetails;
  command?: string;
}

export interface AiAgentThinkingBlock {
  type: "thinking";
  id: string;
  text: string;
  done: boolean;
}

export interface AiAgentTextBlock {
  type: "text";
  id: string;
  text: string;
}

export interface AiAgentErrorBlock {
  type: "error";
  id: string;
  message: string;
}

export interface AiAgentCompactBlock {
  type: "compact";
  id: string;
  summary: string;
  tokensBefore: number;
}

export type AiAgentMessageCardBlock =
  | AiAgentCompactBlock
  | AiAgentErrorBlock
  | AiAgentTextBlock
  | AiAgentThinkingBlock
  | AiAgentToolExecutionBlock;

export interface AiAgentMessageCardViewModel {
  id: string;
  kind: "user" | "assistant" | "compact";
  label: string;
  status: string;
  createdAt: number;
  blocks: AiAgentMessageCardBlock[];
  showStreamingPlaceholder: boolean;
}

const defaultContextThreshold = minimumAiAgentContextWindow;

const summarizeToolParameters = (argumentsText: string | undefined) => {
  const trimmed = argumentsText?.trim() ?? "";

  if (!trimmed) {
    return "no parameters";
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return String(parsed);
    }

    const summary = Object.entries(parsed)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .slice(0, 3)
      .map(([key, value]) => {
        const stringValue = String(value);

        return `${key}=${stringValue.length > 40 ? `${stringValue.slice(0, 37)}...` : stringValue}`;
      })
      .join(" ");

    return summary || "no parameters";
  } catch {
    return trimmed.length > 72 ? `${trimmed.slice(0, 69)}...` : trimmed;
  }
};

const getToolCallStage = (
  call: Extract<AiAgentMessagePart, { type: "tool_call" }>,
  result: Extract<AiAgentMessagePart, { type: "tool_result" }> | undefined,
  messageStatus: AiAgentMessage["status"],
): AiAgentExecutionStage => {
  if (result?.isError) {
    return /\btimeout|timed out\b/i.test(result.content) ? "timeout" : "error";
  }

  if (result) {
    return "done";
  }

  // A tool call without a result is only genuinely in-flight while its run is still streaming.
  // For any finished/hydrated message (done/error/aborted) it was interrupted, so it must not
  // render as an active spinner or an interactive (and now unanswerable) ask form.
  if (messageStatus !== "streaming") {
    return "aborted";
  }

  return call.done ? "running" : "building";
};

const getToolDuration = (
  call: Extract<AiAgentMessagePart, { type: "tool_call" }>,
  result: Extract<AiAgentMessagePart, { type: "tool_result" }> | undefined,
) => {
  const end = result?.completedAt;
  const start = call.runningAt ?? call.startedAt;

  if (!start || !end) {
    return undefined;
  }

  return Math.max(0, end - start);
};

const getOrphanToolStage = (
  result: Extract<AiAgentMessagePart, { type: "tool_result" }>,
  messageStatus: AiAgentMessage["status"],
): AiAgentExecutionStage => {
  if (result.isError) {
    return /\btimeout|timed out\b/i.test(result.content) ? "timeout" : "error";
  }

  if (messageStatus === "aborted") {
    return "aborted";
  }

  return "done";
};

export const formatAiAgentDuration = (durationMs: number | undefined) => {
  if (!durationMs || durationMs < 1_000) {
    return durationMs ? `${durationMs}ms` : undefined;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);

  return `${minutes}m ${seconds}s`;
};

export const formatAiAgentRunState = (status: AiAgentTabStatus) => {
  switch (status) {
    case "streaming":
      return "streaming";
    case "waiting-for-tool":
      return "waiting for tool";
    case "aborted":
      return "aborted";
    case "error":
      return "error";
    case "idle":
      return "idle";
  }
};

export const buildAiAgentContextIndicator = (
  data: Pick<AiAgentTabData, "lastCompactionAt" | "messages" | "selectedModelId"> & { configuredModelId?: string },
): AiAgentContextIndicatorViewModel => {
  const estimatedTokens = estimateAiAgentConversationTokens(toConversationMessages(data.messages));
  const modelContextWindow = getAiAgentContextWindow(data.selectedModelId ?? data.configuredModelId);
  const lastCompactionTokens =
    [...data.messages]
      .reverse()
      .flatMap((message) => [...message.parts].reverse())
      .find(
        (part): part is Extract<AiAgentMessagePart, { type: "compaction_summary" }> =>
          part.type === "compaction_summary",
      )?.tokensBefore ?? defaultContextThreshold;
  const threshold = Math.max(modelContextWindow, lastCompactionTokens, minimumAiAgentContextWindow);
  const recentlyCompacted = Boolean(data.lastCompactionAt && Date.now() - data.lastCompactionAt < 6_000);
  const tone = recentlyCompacted ? "recently-compacted" : estimatedTokens >= threshold * 0.75 ? "warning" : "normal";

  return {
    estimatedTokens,
    label: `${Math.max(1, Math.round(estimatedTokens / 1_000))}k context`,
    progress: Math.min(100, Math.round((estimatedTokens / threshold) * 100)),
    tone,
  };
};

export const buildAiAgentSessionTitle = (
  data: Pick<AiAgentTabData, "messages" | "sessionId">,
  currentSession: Pick<AiAgentSession, "id" | "title" | "titleSource"> | undefined,
) => {
  if (
    currentSession?.id === data.sessionId &&
    currentSession.titleSource === "manual" &&
    currentSession.title?.trim()
  ) {
    return currentSession.title;
  }

  return deriveAiAgentSessionTitle(data.messages);
};

const getSessionDisplayTitle = (session: Pick<AiAgentSession, "messages" | "title">) =>
  session.title?.trim() || deriveAiAgentSessionTitle(session.messages);

export const buildAiAgentSessionList = ({
  activeSessionId,
  clusterLabel,
  search,
  sessions,
}: {
  activeSessionId: string;
  clusterLabel: string;
  search?: string;
  sessions: AiAgentSession[];
}) => {
  const normalizedSearch = search?.trim().toLowerCase() ?? "";

  return sessions
    .map<AiAgentSessionListItemViewModel>((session) => {
      const title = getSessionDisplayTitle(session);
      const firstPrompt = getAiAgentFirstRealUserPrompt(session.messages);
      const searchText = [title, getAiAgentTextFromMessage(firstPrompt ?? { parts: [] })].join(" ").toLowerCase();

      return {
        id: session.id,
        title,
        updatedAt: session.updatedAt,
        turnCount: getAiAgentUserTurnCount(session.messages),
        clusterLabel,
        searchText,
        active: session.id === activeSessionId,
      };
    })
    .filter((session) => !normalizedSearch || session.searchText.includes(normalizedSearch));
};

export const buildAiAgentConversationViewModel = (messages: AiAgentMessage[]): AiAgentMessageCardViewModel[] =>
  messages.map((message) => {
    if (isAiAgentCompactionMessage(message)) {
      const part = message.parts.find(
        (item): item is Extract<AiAgentMessagePart, { type: "compaction_summary" }> =>
          item.type === "compaction_summary",
      );

      return {
        id: message.id,
        kind: "compact",
        label: "history compacted",
        status: "checkpoint",
        createdAt: message.createdAt,
        blocks: part
          ? [
              {
                type: "compact",
                id: `${message.id}-compact`,
                summary: part.summary,
                tokensBefore: part.tokensBefore,
              },
            ]
          : [],
        showStreamingPlaceholder: false,
      };
    }

    if (message.role === "user") {
      const text = getAiAgentTextFromMessage(message);

      return {
        id: message.id,
        kind: "user",
        label: "user",
        status: message.status,
        createdAt: message.createdAt,
        blocks: text ? [{ type: "text", id: `${message.id}-text`, text }] : [],
        showStreamingPlaceholder: false,
      };
    }

    const blocks: AiAgentMessageCardBlock[] = [];
    const resultsByCallId = new Map<string, Extract<AiAgentMessagePart, { type: "tool_result" }>[]>();
    const consumedResultIds = new Set<string>();

    for (const part of message.parts) {
      if (part.type === "tool_result") {
        const results = resultsByCallId.get(part.toolCallId) ?? [];

        results.push(part);
        resultsByCallId.set(part.toolCallId, results);
      }
    }

    let hasText = false;

    for (let index = 0; index < message.parts.length; index += 1) {
      const part = message.parts[index];

      switch (part.type) {
        case "text":
          if (part.text) {
            hasText = true;
            blocks.push({
              type: "text",
              id: `${message.id}-text-${index}`,
              text: part.text,
            });
          }
          break;
        case "thinking":
          blocks.push({
            type: "thinking",
            id: `${message.id}-thinking-${index}`,
            text: part.text,
            done: part.done,
          });
          break;
        case "tool_call": {
          const results = resultsByCallId.get(part.toolCallId) ?? [];
          const result = results[results.length - 1];

          consumedResultIds.add(part.toolCallId);
          blocks.push({
            type: "tool",
            id: `${message.id}-tool-${part.toolCallId}`,
            toolCallId: part.toolCallId,
            runId: message.runId,
            name: part.name,
            parameterSummary: summarizeToolParameters(part.argumentsText),
            argumentsText: part.argumentsText,
            stage: getToolCallStage(part, result, message.status),
            durationMs: getToolDuration(part, result),
            output: result?.content,
            isError: Boolean(result?.isError),
            details: result?.details,
            command: result?.details?.command,
          });
          break;
        }
        case "tool_result":
          if (consumedResultIds.has(part.toolCallId)) {
            break;
          }

          blocks.push({
            type: "tool",
            id: `${message.id}-orphan-tool-${part.toolCallId}-${index}`,
            toolCallId: part.toolCallId,
            runId: message.runId,
            name: "kubectl result",
            parameterSummary: part.details?.command ?? "tool output",
            argumentsText: "",
            stage: getOrphanToolStage(part, message.status),
            durationMs: undefined,
            output: part.content,
            isError: part.isError,
            details: part.details,
            command: part.details?.command,
          });
          break;
        case "error":
          blocks.push({
            type: "error",
            id: `${message.id}-error-${index}`,
            message: part.message,
          });
          break;
        case "compaction_summary":
          break;
      }
    }

    return {
      id: message.id,
      kind: "assistant",
      label: "agent",
      status: message.status,
      createdAt: message.createdAt,
      blocks,
      showStreamingPlaceholder: !hasText && message.status === "streaming",
    };
  });

const toConversationMessages = (messages: AiAgentMessage[]) =>
  messages.map(({ createdAt, parts, role }) => ({
    role,
    createdAt,
    parts,
  }));
