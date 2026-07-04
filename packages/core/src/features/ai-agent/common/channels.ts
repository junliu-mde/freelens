/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

export const aiAgentSendChannel = "ai-agent:send";
export const aiAgentAbortChannel = "ai-agent:abort";
export const aiAgentStreamEventChannel = "ai-agent:stream-event";
export const aiAgentAskResponseChannel = "ai-agent:ask-response";

export type AiAgentPermissionMode = "read-only" | "read-write";

import type { AiAgentToolResultDetails } from "./tool-result-details";
import type { AiAgentConversationMessage } from "./transcript";

export interface AiAgentSendRequest {
  tabId: string;
  runId: string;
  messages: AiAgentConversationMessage[];
  permissionMode: AiAgentPermissionMode;
  metadata?: Record<string, unknown>;
  forceCompact?: boolean;
}

export type AiAgentStreamEvent =
  | { type: "run-start"; tabId: string; runId: string }
  | { type: "run-status"; tabId: string; runId: string; status: string }
  | { type: "text-delta"; tabId: string; runId: string; delta: string }
  | { type: "thinking-start"; tabId: string; runId: string }
  | { type: "thinking-delta"; tabId: string; runId: string; delta: string }
  | { type: "thinking-end"; tabId: string; runId: string }
  | { type: "tool-call-start"; tabId: string; runId: string; toolCallId: string; name?: string }
  | { type: "tool-call-delta"; tabId: string; runId: string; index: string; delta: string }
  | {
      type: "tool-call-end";
      tabId: string;
      runId: string;
      index: string;
      toolCallId: string;
      name: string;
      argumentsText: string;
    }
  | { type: "history-compacted"; tabId: string; runId: string; messages: AiAgentConversationMessage[] }
  | {
      type: "tool-result";
      tabId: string;
      runId: string;
      toolCallId: string;
      content: string;
      isError: boolean;
      details?: AiAgentToolResultDetails;
    }
  | { type: "run-done"; tabId: string; runId: string }
  | { type: "run-error"; tabId: string; runId: string; error: string };

export interface AiAgentProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}
