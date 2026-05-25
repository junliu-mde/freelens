/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { completeSimple } from "@earendil-works/pi-ai";
import {
  applyAiAgentCompaction,
  prepareAiAgentCompaction,
  serializeAiAgentConversationForSummary,
} from "../common/compaction";

import type { Model, Tool } from "@earendil-works/pi-ai";

import type { AiAgentSettings } from "../common/settings";
import type { AiAgentConversationMessage } from "../common/transcript";

export interface AiAgentCompactionResult {
  messages: AiAgentConversationMessage[];
  tokensBefore: number;
  summary: string;
}

const compactionSystemPrompt =
  "You are creating a compact checkpoint for another assistant that will continue the same Kubernetes debugging chat. Keep it short, concrete, and faithful to the source.";

const compactionPrompt = `Summarize the conversation below so another assistant can continue the work without rereading everything.

Use this exact format:

## Goal
[What the user is trying to do]

## Constraints & Preferences
- [Important constraints or preferences]
- [(none)] if there are none

## Progress
### Done
- [x] [What is already done]

### In Progress
- [ ] [What is still being worked on]

### Blocked
- [Anything that is currently blocked]

## Key Findings
- [Important evidence, outputs, or observations]

## Next Steps
1. [What should happen next]

## Critical Context
- [Exact file paths, commands, cluster names, tool outputs, or error text worth preserving]

Keep the wording compact. Preserve exact file paths, tool names, and error messages when they matter.`;

const compactionUpdatePrompt = `Update the existing summary using the new conversation below.

Rules:
- Keep the existing useful context.
- Add any new progress and findings.
- Move items from "In Progress" to "Done" when they are finished.
- Refresh "Next Steps" so they match the current state.
- Preserve exact file paths, tool names, commands, and error messages when they matter.

Use the same exact format as before.`;

const getSummaryText = (text: string) => text.trim();

const createCompactionRequestText = (messages: AiAgentConversationMessage[], previousSummary: string | undefined) => {
  let promptText = `<conversation>\n${serializeAiAgentConversationForSummary(messages)}\n</conversation>\n\n`;

  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n${compactionUpdatePrompt}`;
  } else {
    promptText += compactionPrompt;
  }

  return promptText;
};

const getCompactionMaxTokens = (settings: AiAgentSettings) =>
  Math.max(1024, Math.min(Math.floor(settings.compactionReserveTokens * 0.8), Math.max(settings.maxTokens, 4096)));

export const compactAiAgentConversation = async ({
  messages,
  settings,
  model,
  apiKey,
  signal,
  systemPrompt,
  tools,
  extraText,
}: {
  messages: AiAgentConversationMessage[];
  settings: AiAgentSettings;
  model: Model<any>;
  apiKey: string;
  signal: AbortSignal;
  systemPrompt?: string;
  tools?: Tool[];
  extraText?: string;
}): Promise<AiAgentCompactionResult | undefined> => {
  const preparation = prepareAiAgentCompaction(messages, settings, model.contextWindow, systemPrompt, tools, extraText);

  if (!preparation || preparation.messagesToSummarize.length === 0) {
    return undefined;
  }

  const response = await completeSimple(
    model,
    {
      systemPrompt: compactionSystemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: createCompactionRequestText(preparation.messagesToSummarize, preparation.previousSummary),
            },
          ],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey,
      signal,
      maxTokens: getCompactionMaxTokens(settings),
      ...(settings.reasoningEffort === "off" ? {} : { reasoning: settings.reasoningEffort }),
    },
  );

  if (response.stopReason === "aborted" || signal.aborted) {
    return undefined;
  }

  if (response.stopReason === "error") {
    throw new Error(response.errorMessage || "AI compaction failed");
  }

  const summary = getSummaryText(
    response.content
      .filter((part): part is Extract<(typeof response.content)[number], { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
  );

  if (!summary) {
    return undefined;
  }

  return {
    messages: applyAiAgentCompaction(preparation, summary),
    tokensBefore: preparation.tokensBefore,
    summary,
  };
};
