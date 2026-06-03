/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getAiAgentContextWindow } from "../common/model-context-window";
import { normalizeAiAgentSettings } from "../common/settings";
import { toAiAgentLlmMessages } from "../common/transcript";
import { kubectlAiAgentTools, kubectlAiAgentWriteTools } from "./kubectl-tools";

import type { Context, Model, Tool } from "@earendil-works/pi-ai";

import type { ClusterId } from "../../../common/cluster-types";
import type { AiAgentPermissionMode, AiAgentSendRequest } from "../common/channels";
import type { AiAgentSettings } from "../common/settings";

export const createAiAgentChatModel = (settings: AiAgentSettings): Model<"openai-completions"> => ({
  id: settings.model,
  name: settings.model,
  api: "openai-completions",
  provider: settings.provider,
  baseUrl: settings.baseUrl,
  reasoning: settings.reasoningEffort !== "off",
  input: ["text"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: getAiAgentContextWindow(settings.model),
  maxTokens: settings.maxTokens,
  compat: {
    supportsUsageInStreaming: false,
    maxTokensField: "max_tokens",
    thinkingFormat: "openai",
  },
});

export const getAiAgentKubectlTools = (
  settings: AiAgentSettings,
  permissionMode: AiAgentPermissionMode,
): Tool[] | undefined => {
  if (!settings.enableKubectlTools) {
    return undefined;
  }

  return permissionMode === "read-write" ? [...kubectlAiAgentTools, ...kubectlAiAgentWriteTools] : kubectlAiAgentTools;
};

export const createAiAgentSystemPrompt = (clusterId: ClusterId | undefined, permissionMode: AiAgentPermissionMode) => {
  const clusterContext = clusterId ? `Active cluster ID: ${clusterId}.` : "No active cluster connected.";
  const permissionContext =
    permissionMode === "read-write"
      ? "You are in read-write mode. Write kubectl operations may be available through provided tools, but prefer safe, explicit actions and inspect before mutating."
      : "You are in read-only mode. You may only inspect cluster resources; never attempt any mutating operations.";
  const toolContext =
    "MCP tools loaded from user configuration use names that start with mcp__. When the user asks whether MCP is available, what tools are available, or asks you to list tools, rely on the actual tool list provided in this run. If any tool name starts with mcp__, MCP tools are available in this run.";

  return `You are an AI Agent inside Freelens, a Kubernetes IDE. ${clusterContext} ${permissionContext} ${toolContext} Be concise and practical. Use the available tools when they help. When Kubernetes debugging is requested, use the provided kubectl tools against the active cluster, inspect evidence first, then explain findings and next safe actions. Never suggest destructive kubectl actions unless the user explicitly asks.`;
};

export const createAiAgentChatContext = (
  request: AiAgentSendRequest,
  rawSettings: AiAgentSettings | undefined,
  clusterId: ClusterId | undefined,
  tools?: Tool[],
): Context => {
  const settings = normalizeAiAgentSettings(rawSettings);
  const permissionMode = request.permissionMode ?? "read-only";
  const model = createAiAgentChatModel(settings);

  return {
    systemPrompt: createAiAgentSystemPrompt(clusterId, permissionMode),
    messages: toAiAgentLlmMessages(request.messages, {
      api: model.api,
      provider: model.provider,
      model: model.id,
    }),
    tools: tools ?? getAiAgentKubectlTools(settings, permissionMode),
  };
};
