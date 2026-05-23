/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { onLoadOfApplicationInjectionToken } from "@freelensapp/application";
import { loggerInjectionToken } from "@freelensapp/logger";
import { getInjectable } from "@ogre-tools/injectable";
import { ipcMainHandle, ipcMainOn } from "../../../common/ipc";
import { aiAgentAbortChannel, aiAgentSendChannel, aiAgentStreamEventChannel } from "../common/channels";
import { aiAgentClusterIdHeader } from "../common/headers";
import userPreferencesStateInjectable from "../../user-preferences/common/state.injectable";
import executeAiAgentKubectlToolInjectable from "./execute-ai-agent-kubectl-tool.injectable";
import { runAiAgentChat } from "./run-ai-agent-chat";

import type { Logger } from "@freelensapp/logger";
import type { ClusterId } from "../../../common/cluster-types";
import type { AiAgentSendRequest, AiAgentStreamEvent } from "../common/channels";
import type { UserPreferencesState } from "../../user-preferences/common/state.injectable";
import type { ExecuteAiAgentKubectlTool } from "./execute-ai-agent-kubectl-tool.injectable";

const activeRuns = new Map<string, AbortController>();

const getRunKey = (tabId: string, runId: string) => `${tabId}:${runId}`;

const sendToInvokingFrame = (
  event: Electron.IpcMainInvokeEvent,
  channel: string,
  streamEvent: AiAgentStreamEvent,
  logger: Logger,
) => {
  const targetFrame = event.senderFrame;

  if (targetFrame && !targetFrame.isDestroyed()) {
    targetFrame.send(channel, streamEvent);

    return;
  }

  logger.warn("[AI-AGENT] sender frame is not available, falling back to webContents.send");
  event.sender.send(channel, streamEvent);
};

const getRequestClusterId = (request: AiAgentSendRequest): ClusterId | undefined => {
  const value = request.metadata?.[aiAgentClusterIdHeader];

  return typeof value === "string" && value ? (value as ClusterId) : undefined;
};

const setupAiAgentIpcHandlers = (
  logger: Logger,
  userPreferencesState: UserPreferencesState,
  executeKubectlTool: ExecuteAiAgentKubectlTool,
) => {
  ipcMainHandle(aiAgentSendChannel, async (event, request: AiAgentSendRequest) => {
    const controller = new AbortController();
    const runKey = getRunKey(request.tabId, request.runId);

    activeRuns.set(runKey, controller);

    const emit = (streamEvent: AiAgentStreamEvent) => {
      sendToInvokingFrame(event, aiAgentStreamEventChannel, streamEvent, logger);
    };

    try {
      await runAiAgentChat(
        request,
        userPreferencesState.aiAgent,
        getRequestClusterId(request),
        executeKubectlTool,
        emit,
        controller.signal,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      logger.warn(`[AI-AGENT] stream failed: ${message}`);
      emit({ type: "run-error", tabId: request.tabId, runId: request.runId, error: message });
    } finally {
      activeRuns.delete(runKey);
    }

    return { ok: true };
  });

  ipcMainOn(aiAgentAbortChannel, (_event, tabId: string, runId: string) => {
    activeRuns.get(getRunKey(tabId, runId))?.abort();
  });
};

const setupAiAgentIpcHandlersInjectable = getInjectable({
  id: "setup-ai-agent-ipc-handlers",

  instantiate: (di) => ({
    run: () =>
      setupAiAgentIpcHandlers(
        di.inject(loggerInjectionToken),
        di.inject(userPreferencesStateInjectable),
        di.inject(executeAiAgentKubectlToolInjectable),
      ),
  }),

  injectionToken: onLoadOfApplicationInjectionToken,
  causesSideEffects: true,
});

export default setupAiAgentIpcHandlersInjectable;
