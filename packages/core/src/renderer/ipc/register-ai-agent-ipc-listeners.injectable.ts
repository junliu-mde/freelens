/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { aiAgentStreamEventChannel } from "../../features/ai-agent/common/channels";
import hostedClusterIdInjectable from "../cluster-frame-context/hosted-cluster-id.injectable";
import aiAgentTabStoreInjectable from "../components/dock/ai-agent/store.injectable";
import ipcRendererInjectable from "../utils/channel/ipc-renderer.injectable";

import type { AiAgentStreamEvent } from "../../features/ai-agent/common/channels";
import type { AiAgentTabStore } from "../components/dock/ai-agent/store";

const registeredFrameIds = new Set<string>();

const applyStreamEvent = (store: AiAgentTabStore, event: AiAgentStreamEvent) => {
  switch (event.type) {
    case "run-start":
      break;
    case "text-delta":
      store.appendTextDelta(event.tabId, event.runId, event.delta);
      break;
    case "thinking-start":
      store.startThinking(event.tabId, event.runId);
      break;
    case "thinking-delta":
      store.appendThinkingDelta(event.tabId, event.runId, event.delta);
      break;
    case "thinking-end":
      store.finishThinking(event.tabId, event.runId);
      break;
    case "tool-call-start":
      store.startToolCall(event.tabId, event.runId, event.toolCallId, event.name);
      break;
    case "tool-call-delta":
      store.appendToolCallDelta(event.tabId, event.runId, event.delta);
      break;
    case "tool-call-end":
      store.finishToolCall(event.tabId, event.runId, event.toolCallId, event.name, event.argumentsText);
      break;
    case "history-compacted":
      store.replaceConversationHistory(event.tabId, event.runId, event.messages);
      break;
    case "tool-result":
      store.appendToolResult(event.tabId, event.runId, event.toolCallId, event.content, event.isError, event.details);
      break;
    case "run-done":
      store.finishRun(event.tabId, event.runId, "done");
      break;
    case "run-error":
      store.appendError(event.tabId, event.runId, event.error);
      store.finishRun(event.tabId, event.runId, "error");
      break;
  }
};

const registerAiAgentIpcListenersInjectable = getInjectable({
  id: "register-ai-agent-ipc-listeners",

  instantiate: (di) => {
    const aiAgentTabStore = di.inject(aiAgentTabStoreInjectable);
    const ipcRenderer = di.inject(ipcRendererInjectable);
    const hostedClusterId = di.inject(hostedClusterIdInjectable);

    return (frameId = "root") => {
      if (registeredFrameIds.has(frameId)) {
        return;
      }

      registeredFrameIds.add(frameId);
      ipcRenderer.on(aiAgentStreamEventChannel, (_event, streamEvent: AiAgentStreamEvent) => {
        // Only apply stream events for tabs that belong to this cluster frame.
        // If the tab has no clusterId yet, apply the event (it will be set on first send).
        const tabData = aiAgentTabStore.getData(streamEvent.tabId);

        if (tabData && tabData.clusterId && tabData.clusterId !== hostedClusterId) {
          return;
        }

        applyStreamEvent(aiAgentTabStore, streamEvent);
      });
    };
  },
});

export default registerAiAgentIpcListenersInjectable;
