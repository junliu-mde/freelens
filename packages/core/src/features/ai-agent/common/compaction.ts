/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { Tool } from "@earendil-works/pi-ai";

import type { AiAgentSettings } from "./settings";
import type { AiAgentConversationMessage, AiAgentMessagePart } from "./transcript";

export interface AiAgentCompactionPreparation {
  previousSummary?: string;
  messagesToSummarize: AiAgentConversationMessage[];
  keptMessages: AiAgentConversationMessage[];
  tokensBefore: number;
}

const estimateTextTokens = (value: string) => Math.ceil(value.length / 4);

const clonePart = <TPart extends AiAgentMessagePart>(part: TPart): TPart => ({ ...part });

const cloneMessage = (message: AiAgentConversationMessage): AiAgentConversationMessage => ({
  ...message,
  parts: message.parts.map(clonePart),
});

const findLastCompactionSummaryIndex = (messages: AiAgentConversationMessage[]) =>
  messages.findLastIndex((message) => message.parts.some((part) => part.type === "compaction_summary"));

const getLastCompactionSummary = (messages: AiAgentConversationMessage[]) => {
  const index = findLastCompactionSummaryIndex(messages);
  const part = index >= 0 ? messages[index].parts.find((item) => item.type === "compaction_summary") : undefined;

  return {
    index,
    summary: part?.type === "compaction_summary" ? part.summary : undefined,
  };
};

const estimatePartTokens = (part: AiAgentMessagePart) => {
  switch (part.type) {
    case "text":
      return estimateTextTokens(part.text);
    case "thinking":
      return 0;
    case "tool_call":
      return estimateTextTokens(part.name) + estimateTextTokens(part.argumentsText);
    case "tool_result":
      return estimateTextTokens(part.content);
    case "error":
      return estimateTextTokens(part.message);
    case "compaction_summary":
      return estimateTextTokens(part.summary);
  }
};

export const estimateAiAgentConversationTokens = (messages: AiAgentConversationMessage[]) =>
  messages.reduce(
    (total, message) => total + message.parts.reduce((partTotal, part) => partTotal + estimatePartTokens(part), 0),
    0,
  );

export const estimateAiAgentContextTokens = (
  messages: AiAgentConversationMessage[],
  systemPrompt?: string,
  tools?: Tool[],
  extraText?: string,
) =>
  estimateAiAgentConversationTokens(messages) +
  estimateTextTokens(systemPrompt ?? "") +
  estimateTextTokens(tools ? JSON.stringify(tools) : "") +
  estimateTextTokens(extraText ?? "");

export const shouldCompactAiAgentContext = (
  contextTokens: number,
  contextWindow: number,
  settings: Pick<AiAgentSettings, "enableCompaction" | "compactionReserveTokens">,
) => settings.enableCompaction && contextTokens > contextWindow - settings.compactionReserveTokens;

export const prepareAiAgentCompaction = (
  messages: AiAgentConversationMessage[],
  settings: Pick<AiAgentSettings, "enableCompaction" | "compactionReserveTokens" | "compactionKeepRecentTokens">,
  contextWindow: number,
  systemPrompt?: string,
  tools?: Tool[],
  extraText?: string,
): AiAgentCompactionPreparation | undefined => {
  const tokensBefore = estimateAiAgentContextTokens(messages, systemPrompt, tools, extraText);

  if (!shouldCompactAiAgentContext(tokensBefore, contextWindow, settings)) {
    return undefined;
  }

  const { index: previousSummaryIndex, summary: previousSummary } = getLastCompactionSummary(messages);
  const boundaryStart = previousSummaryIndex + 1;
  let keptStartIndex = boundaryStart;
  let accumulatedTokens = 0;
  let foundRecentBoundary = false;

  for (let index = messages.length - 1; index >= boundaryStart; index -= 1) {
    accumulatedTokens += messages[index].parts.reduce((total, part) => total + estimatePartTokens(part), 0);

    if (accumulatedTokens >= settings.compactionKeepRecentTokens) {
      keptStartIndex = index;
      foundRecentBoundary = true;
      break;
    }
  }

  if (keptStartIndex <= boundaryStart) {
    // The recent tail totals fewer than compactionKeepRecentTokens, yet shouldCompactAiAgentContext
    // already established the overall context exceeds the window (e.g. a very large tool/system
    // prompt dominates). Rather than silently doing nothing and sending an oversized request, fall
    // back to keeping just the most recent message so compaction can still make progress — but only
    // when there is something to summarize. When the loop stopped because a single recent message
    // already exceeds the budget (foundRecentBoundary), keep it as-is.
    const lastIndex = messages.length - 1;

    if (!foundRecentBoundary && lastIndex > boundaryStart) {
      keptStartIndex = lastIndex;
    } else {
      return undefined;
    }
  }

  return {
    previousSummary,
    messagesToSummarize: messages.slice(boundaryStart, keptStartIndex).map(cloneMessage),
    keptMessages: messages.slice(keptStartIndex).map(cloneMessage),
    tokensBefore,
  };
};

export const createAiAgentCompactionSummaryMessage = (
  summary: string,
  tokensBefore: number,
  createdAt = Date.now(),
): AiAgentConversationMessage => ({
  role: "user",
  createdAt,
  parts: [
    {
      type: "compaction_summary",
      summary,
      tokensBefore,
    },
  ],
});

export const applyAiAgentCompaction = (
  preparation: AiAgentCompactionPreparation,
  summary: string,
  createdAt = Date.now(),
): AiAgentConversationMessage[] => [
  createAiAgentCompactionSummaryMessage(summary, preparation.tokensBefore, createdAt),
  ...preparation.keptMessages.map(cloneMessage),
];

const formatPartForSummary = (part: AiAgentMessagePart) => {
  switch (part.type) {
    case "text":
      return part.text;
    case "thinking":
      return "";
    case "tool_call":
      return `Tool call ${part.name}:\n${part.argumentsText}`;
    case "tool_result":
      return `${part.isError ? "Tool error" : "Tool result"} (${part.toolCallId}):\n${part.content}`;
    case "error":
      return `Error: ${part.message}`;
    case "compaction_summary":
      return `Compaction summary:\n${part.summary}`;
  }
};

export const serializeAiAgentConversationForSummary = (messages: AiAgentConversationMessage[]) =>
  messages
    .map((message) => {
      const speaker = message.role === "user" ? "User" : "Assistant";
      const body = message.parts.map(formatPartForSummary).filter(Boolean).join("\n\n").trim();

      if (!body) {
        return "";
      }

      return `${speaker}:\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
