/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { AiAgentChatSession } from "./ai-agent-chat-session";

import type { ClusterId } from "../../../common/cluster-types";
import type { AiAgentSendRequest, AiAgentStreamEvent } from "../common/channels";
import type { AiAgentSettings } from "../common/settings";
import type { CreateAiAgentMcpToolSupport } from "./ai-agent-mcp-tool-support.injectable";
import type { ExecuteAiAgentKubectlTool } from "./execute-ai-agent-kubectl-tool.injectable";

export const runAiAgentChat = async (
  request: AiAgentSendRequest,
  rawSettings: AiAgentSettings | undefined,
  clusterId: ClusterId | undefined,
  executeKubectlTool: ExecuteAiAgentKubectlTool,
  emit: (event: AiAgentStreamEvent) => void,
  signal: AbortSignal,
  createMcpToolSupport?: CreateAiAgentMcpToolSupport,
): Promise<void> =>
  new AiAgentChatSession({
    request,
    rawSettings,
    clusterId,
    executeKubectlTool,
    emit,
    signal,
    createMcpToolSupport,
  }).run();
