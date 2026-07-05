/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type {
  Api,
  AssistantMessage,
  Message,
  Provider,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";

import type { AiAgentToolResultDetails } from "./tool-result-details";

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
  startedAt?: number;
  runningAt?: number;
}

export interface AiAgentToolResultPart {
  type: "tool_result";
  toolCallId: string;
  content: string;
  isError: boolean;
  details?: AiAgentToolResultDetails;
  completedAt?: number;
}

export interface AiAgentCompactionSummaryPart {
  type: "compaction_summary";
  summary: string;
  tokensBefore: number;
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
  | AiAgentCompactionSummaryPart
  | AiAgentErrorPart;

export interface AiAgentConversationMessage {
  role: AiAgentMessageRole;
  createdAt: number;
  parts: AiAgentMessagePart[];
}

export interface AiAgentMessage extends AiAgentConversationMessage {
  id: string;
  runId?: string;
  status: AiAgentRunStatus;
  /** Transient UI hint while the run is still streaming without visible text. */
  runStatusHint?: string;
}

export interface AiAgentAssistantMessageMetadata {
  api: Api;
  provider: Provider;
  model: string;
}

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

export const aiAgentCompactionSummaryPrefix = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const aiAgentCompactionSummarySuffix = `
</summary>`;

const maxSessionTitleLength = 60;

const hasText = (value: string | undefined) => Boolean(value?.trim().length);

const isTextPart = (part: AiAgentMessagePart): part is AiAgentTextPart => part.type === "text";

const parseToolCallArguments = (argumentsText: string | undefined): Record<string, unknown> => {
  const trimmed = argumentsText?.trim() ?? "";

  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    return { value: parsed };
  } catch {
    return { raw: trimmed };
  }
};

const getToolCallNamesById = (parts: AiAgentMessagePart[]) => {
  const toolCallNamesById = new Map<string, string>();

  for (const part of parts) {
    if (part.type === "tool_call") {
      toolCallNamesById.set(part.toolCallId, part.name);
    }
  }

  return toolCallNamesById;
};

const createUserMessage = (content: UserMessage["content"], timestamp: number): UserMessage => ({
  role: "user",
  content,
  timestamp,
});

const createAssistantMessage = (
  content: AssistantMessage["content"],
  timestamp: number,
  metadata: AiAgentAssistantMessageMetadata,
): AssistantMessage => ({
  role: "assistant",
  content: [...content],
  api: metadata.api,
  provider: metadata.provider,
  model: metadata.model,
  usage: emptyUsage,
  stopReason: content.some((part) => part.type === "toolCall") ? "toolUse" : "stop",
  timestamp,
});

const createToolResultMessage = (
  part: AiAgentToolResultPart,
  toolName: string,
  timestamp: number,
): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: part.toolCallId,
  toolName,
  content: hasText(part.content) ? [{ type: "text", text: part.content }] : [],
  isError: part.isError,
  timestamp,
});

const flushAssistantContent = (
  llmMessages: Message[],
  assistantContent: AssistantMessage["content"],
  timestamp: number,
  metadata: AiAgentAssistantMessageMetadata,
) => {
  if (assistantContent.length === 0) {
    return;
  }

  llmMessages.push(createAssistantMessage(assistantContent, timestamp, metadata));
};

const toUserMessage = (message: AiAgentConversationMessage): UserMessage | undefined => {
  const content = message.parts
    .flatMap((part) => {
      switch (part.type) {
        case "text":
          return hasText(part.text) ? [part.text] : [];
        case "compaction_summary":
          return hasText(part.summary)
            ? [`${aiAgentCompactionSummaryPrefix}${part.summary}${aiAgentCompactionSummarySuffix}`]
            : [];
        default:
          return [];
      }
    })
    .join("\n\n")
    .trim();

  if (!content) {
    return undefined;
  }

  return createUserMessage(content, message.createdAt);
};

const toAssistantMessages = (
  message: AiAgentConversationMessage,
  metadata: AiAgentAssistantMessageMetadata,
): Message[] => {
  const llmMessages: Message[] = [];
  const assistantContent: AssistantMessage["content"] = [];
  const toolCallNamesById = getToolCallNamesById(message.parts);
  const resolvedToolCallIds = new Set(
    message.parts
      .filter((part): part is AiAgentToolResultPart => part.type === "tool_result")
      .map((part) => part.toolCallId),
  );

  for (const part of message.parts) {
    switch (part.type) {
      case "text":
        if (hasText(part.text)) {
          assistantContent.push({ type: "text", text: part.text });
        }
        break;
      case "thinking":
        // Keep prior visible output and tool history in context, but skip old hidden reasoning.
        break;
      case "tool_call":
        // Only forward tool calls that have a matching tool result. An orphan tool call
        // (e.g. the run was aborted mid-tool) would produce an assistant message carrying
        // tool_calls with no following tool messages, which OpenAI-compatible endpoints reject.
        if (resolvedToolCallIds.has(part.toolCallId)) {
          const toolCall: ToolCall = {
            type: "toolCall",
            id: part.toolCallId,
            name: part.name,
            arguments: parseToolCallArguments(part.argumentsText),
          };

          assistantContent.push(toolCall);
        }
        break;
      case "tool_result":
        flushAssistantContent(llmMessages, assistantContent, message.createdAt, metadata);
        assistantContent.length = 0;
        llmMessages.push(
          createToolResultMessage(part, toolCallNamesById.get(part.toolCallId) ?? "tool_call", message.createdAt),
        );
        break;
      case "compaction_summary":
        if (hasText(part.summary)) {
          assistantContent.push({
            type: "text",
            text: `${aiAgentCompactionSummaryPrefix}${part.summary}${aiAgentCompactionSummarySuffix}`,
          });
        }
        break;
      case "error":
        if (hasText(part.message)) {
          assistantContent.push({ type: "text", text: `Error: ${part.message}` });
        }
        break;
    }
  }

  flushAssistantContent(llmMessages, assistantContent, message.createdAt, metadata);

  return llmMessages;
};

export const getAiAgentTextFromParts = (parts: AiAgentMessagePart[]) =>
  parts
    .filter(isTextPart)
    .map((part) => part.text ?? "")
    .join("");

export const getAiAgentTextFromMessage = (message: Pick<AiAgentConversationMessage, "parts">) =>
  getAiAgentTextFromParts(message.parts);

export const isAiAgentCompactionMessage = (message: Pick<AiAgentConversationMessage, "role" | "parts">) =>
  message.role === "user" &&
  message.parts.length > 0 &&
  message.parts.every((part) => part.type === "compaction_summary");

export const getAiAgentFirstRealUserPrompt = (
  messages: ReadonlyArray<Pick<AiAgentConversationMessage, "role" | "parts">>,
) =>
  messages.find(
    (message) =>
      message.role === "user" && !isAiAgentCompactionMessage(message) && getAiAgentTextFromMessage(message).trim(),
  );

export const getAiAgentUserTurnCount = (messages: ReadonlyArray<Pick<AiAgentConversationMessage, "role" | "parts">>) =>
  messages.filter(
    (message) =>
      message.role === "user" && !isAiAgentCompactionMessage(message) && getAiAgentTextFromMessage(message).trim(),
  ).length;

export const hasAiAgentMessageContent = (message: Pick<AiAgentConversationMessage, "parts">) =>
  message.parts.some((part) => {
    switch (part.type) {
      case "text":
        return hasText(part.text);
      case "thinking":
        return false;
      case "tool_call":
        return part.done || hasText(part.argumentsText);
      case "tool_result":
        return hasText(part.content) || part.isError;
      case "compaction_summary":
        return hasText(part.summary);
      case "error":
        return hasText(part.message);
    }
  });

export const toAiAgentConversationHistory = (messages: AiAgentMessage[]): AiAgentConversationMessage[] =>
  messages
    .filter((message) => hasAiAgentMessageContent(message))
    .map(({ role, createdAt, parts }) => ({
      role,
      createdAt,
      parts: parts.map((part) => ({ ...part })),
    }));

export const toAiAgentLlmMessages = (
  messages: AiAgentConversationMessage[],
  metadata: AiAgentAssistantMessageMetadata,
): Message[] =>
  messages.flatMap((message) => {
    if (!hasAiAgentMessageContent(message)) {
      return [];
    }

    return message.role === "user"
      ? [toUserMessage(message)].filter((value): value is UserMessage => Boolean(value))
      : toAssistantMessages(message, metadata);
  });

export const hydrateAiAgentMessages = (messages: AiAgentConversationMessage[]): AiAgentMessage[] =>
  messages
    .filter((message) => hasAiAgentMessageContent(message))
    .map((message, index) => ({
      id: `history-${message.createdAt}-${index}`,
      role: message.role,
      createdAt: message.createdAt,
      status: "done" as const,
      parts: message.parts.map((part) => ({ ...part })),
    }));

export const finalizeAiAgentMessagesForSave = (messages: AiAgentMessage[]): AiAgentMessage[] =>
  messages.map((message) => ({
    ...message,
    status: message.status === "streaming" ? "done" : message.status,
  }));

export const deriveAiAgentSessionTitle = (
  messages: ReadonlyArray<Pick<AiAgentConversationMessage, "role" | "parts">>,
) => {
  const firstUserMessage = getAiAgentFirstRealUserPrompt(messages);

  if (!firstUserMessage) {
    return "New session";
  }

  const text = getAiAgentTextFromMessage(firstUserMessage).trim();

  if (!text) {
    return "New session";
  }

  return text.length > maxSessionTitleLength ? `${text.slice(0, maxSessionTitleLength - 3)}...` : text;
};
