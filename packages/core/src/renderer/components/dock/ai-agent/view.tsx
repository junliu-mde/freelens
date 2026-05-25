/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "./ai-agent.scss";

import { showErrorNotificationInjectable, showSuccessNotificationInjectable } from "@freelensapp/notifications";
import { withInjectables } from "@ogre-tools/injectable-react";
import { clipboard, shell } from "electron";
import { observer } from "mobx-react";
import React from "react";
import { normalizeAiAgentSettings } from "../../../../features/ai-agent/common/settings";
import userPreferencesStateInjectable from "../../../../features/user-preferences/common/state.injectable";
import hostedClusterInjectable from "../../../cluster-frame-context/hosted-cluster.injectable";
import abortAiAgentMessageInjectable from "../../../ipc/abort-ai-agent-message.injectable";
import sendAiAgentMessageInjectable from "../../../ipc/send-ai-agent-message.injectable";
import { AiAgentComposer } from "./AiAgentComposer";
import { AiAgentConversation } from "./AiAgentConversation";
import { AiAgentHeader } from "./AiAgentHeader";
import { AiAgentSessionMenu } from "./AiAgentSessionMenu";
import aiAgentTabStoreInjectable from "./store.injectable";
import {
  buildAiAgentContextIndicator,
  buildAiAgentConversationViewModel,
  buildAiAgentSessionList,
  buildAiAgentSessionTitle,
} from "./view-model";

import type { ShowNotification } from "@freelensapp/notifications";

import type { UserPreferencesState } from "../../../../features/user-preferences/common/state.injectable";
import type { AbortAiAgentMessage } from "../../../ipc/abort-ai-agent-message.injectable";
import type { SendAiAgentMessage } from "../../../ipc/send-ai-agent-message.injectable";
import type { AiAgentMessage, AiAgentTabStatus, AiAgentTabStore } from "./store";

export interface AiAgentViewProps {
  tabId: string;
}

interface Dependencies {
  abortAiAgentMessage: AbortAiAgentMessage;
  aiAgentTabStore: AiAgentTabStore;
  hostedCluster: { id: string; name: { get(): string } } | undefined;
  sendAiAgentMessage: SendAiAgentMessage;
  showErrorNotification: ShowNotification;
  showSuccessNotification: ShowNotification;
  userPreferencesState: UserPreferencesState;
}

const isActiveRun = (status: AiAgentTabStatus) => status === "streaming" || status === "waiting-for-tool";

const buildConversationVersion = (messages: AiAgentMessage[]) =>
  messages
    .map((message) => {
      const partsVersion = message.parts
        .map((part) => {
          switch (part.type) {
            case "text":
              return `t:${part.text.length}`;
            case "thinking":
              return `h:${part.text.length}:${part.done ? 1 : 0}`;
            case "tool_call":
              return `c:${part.toolCallId}:${part.argumentsText.length}:${part.done ? 1 : 0}`;
            case "tool_result":
              return `r:${part.toolCallId}:${part.content.length}:${part.isError ? 1 : 0}`;
            case "compaction_summary":
              return `s:${part.summary.length}:${part.tokensBefore}`;
            case "error":
              return `e:${part.message.length}`;
          }
        })
        .join("|");

      return `${message.id}:${message.status}:${partsVersion}`;
    })
    .join("||");

export const NonInjectedAiAgentView = observer((props: AiAgentViewProps & Dependencies) => {
  const {
    abortAiAgentMessage,
    aiAgentTabStore,
    hostedCluster,
    sendAiAgentMessage,
    showErrorNotification,
    showSuccessNotification,
    tabId,
    userPreferencesState,
  } = props;
  const data = aiAgentTabStore.initTab(tabId);
  const currentSession = aiAgentTabStore.getSession(data.sessionId);
  const clusterDisplayName = hostedCluster?.name.get();
  const sessions = aiAgentTabStore.getSessionsForCluster(data.clusterId);
  const sessionTitle = buildAiAgentSessionTitle(data, currentSession);
  const configuredModelId = normalizeAiAgentSettings(userPreferencesState?.aiAgent).model;
  const contextIndicator = buildAiAgentContextIndicator({
    ...data,
    configuredModelId,
  });
  const conversation = buildAiAgentConversationViewModel(data.messages);
  const sessionItems = buildAiAgentSessionList({
    activeSessionId: data.sessionId,
    clusterLabel: clusterDisplayName ?? "current cluster",
    search: data.sessionSearch,
    sessions,
  });
  const conversationVersion = buildConversationVersion(data.messages);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const restoredDraftFocusRef = React.useRef<string>();
  const latestRunRef = React.useRef<{ activeRunId?: string; status: AiAgentTabStatus }>({
    activeRunId: data.activeRunId,
    status: data.status,
  });
  const [isSessionMenuOpen, setIsSessionMenuOpen] = React.useState(false);
  const focusComposer = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;

      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }, []);

  latestRunRef.current = {
    activeRunId: data.activeRunId,
    status: data.status,
  };

  React.useLayoutEffect(() => {
    const restoreFocusKey = `${tabId}:${data.sessionId}`;

    if (!data.inputDraft || data.messages.length !== 0 || restoredDraftFocusRef.current === restoreFocusKey) {
      return;
    }

    restoredDraftFocusRef.current = restoreFocusKey;
    focusComposer();
  }, [data.sessionId, focusComposer, tabId]);

  React.useEffect(
    () => () => {
      const latestRun = latestRunRef.current;

      if (latestRun.activeRunId && isActiveRun(latestRun.status)) {
        abortAiAgentMessage(tabId, latestRun.activeRunId);
      }
    },
    [abortAiAgentMessage, tabId],
  );

  const togglePermissionMode = () => {
    aiAgentTabStore.togglePermissionMode(tabId);
  };

  const sendMessage = () => {
    const text = data.inputDraft.trim();

    if (!text || isActiveRun(data.status)) {
      return;
    }

    const runId = crypto.randomUUID();
    const hostedClusterId = hostedCluster?.id;

    if (!data.clusterId && hostedClusterId) {
      aiAgentTabStore.setClusterId(tabId, hostedClusterId);
    }

    aiAgentTabStore.appendUserMessage(tabId, text);
    aiAgentTabStore.startAssistantMessage(tabId, runId);
    aiAgentTabStore.autoSaveSession(tabId);

    sendAiAgentMessage({
      tabId,
      runId,
      messages: aiAgentTabStore.getConversationMessages(tabId),
      permissionMode: data.permissionMode,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);

      aiAgentTabStore.appendError(tabId, runId, message);
      aiAgentTabStore.finishRun(tabId, runId, "error");
    });
  };

  const stop = () => {
    if (!data.activeRunId) {
      return;
    }

    abortAiAgentMessage(tabId, data.activeRunId);
    aiAgentTabStore.finishRun(tabId, data.activeRunId, "aborted");
    aiAgentTabStore.autoSaveSession(tabId);
  };

  const startNewSession = () => {
    aiAgentTabStore.newSession(tabId);
    setIsSessionMenuOpen(false);
    focusComposer();
  };

  const setDraft = (value: string) => {
    aiAgentTabStore.setInputDraft(tabId, value);
    focusComposer();
  };

  const handleRetry = (toolName: string, command?: string) => {
    setDraft(
      command
        ? `Retry the failed ${toolName} step. Start from this command if it still fits:\n${command}`
        : `Retry the failed ${toolName} step and explain what changed.`,
    );
  };

  const handleContinue = (toolName: string) => {
    setDraft(`Continue after the ${toolName} step and explain the next best action.`);
  };

  const openFullOutput = (path: string) => {
    void shell.openPath(path).then((errorMessage) => {
      if (errorMessage) {
        showErrorNotification(`Failed to open tool output. ${errorMessage}`);
      }
    });
  };

  const copyPath = (path: string) => {
    clipboard.writeText(path);
    showSuccessNotification("Path copied to clipboard.");
  };

  const copySummary = (summary: string) => {
    clipboard.writeText(summary);
    showSuccessNotification("Compaction summary copied to clipboard.");
  };

  return (
    <div
      className="AiAgent"
      onKeyDownCapture={(event) => {
        if (event.key === "Tab" && event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          togglePermissionMode();
        }
      }}
    >
      <AiAgentHeader
        onNewSession={startNewSession}
        onOpenSessions={() => setIsSessionMenuOpen(true)}
        sessionCount={sessions.length}
        sessionTitle={sessionTitle}
      />

      <AiAgentSessionMenu
        onClose={() => setIsSessionMenuOpen(false)}
        onDelete={(sessionId) => aiAgentTabStore.deleteSession(tabId, sessionId)}
        onNewSession={startNewSession}
        onRename={(sessionId, title) => aiAgentTabStore.renameSession(sessionId, title)}
        onSearch={(value) => aiAgentTabStore.setSessionSearch(tabId, value)}
        onSwitch={(sessionId) => {
          aiAgentTabStore.switchToSession(tabId, sessionId);
          setIsSessionMenuOpen(false);
        }}
        open={isSessionMenuOpen}
        search={data.sessionSearch}
        sessions={sessionItems}
      />

      <AiAgentConversation
        conversationVersion={conversationVersion}
        hasUnreadBelow={data.hasUnreadBelow}
        isNearBottom={data.isNearBottom}
        lastCompactionAt={data.lastCompactionAt}
        lastCompactionSummaryPreview={data.lastCompactionSummaryPreview}
        messages={conversation}
        onContinue={handleContinue}
        onCopyPath={copyPath}
        onCopySummary={copySummary}
        onOpenFullOutput={openFullOutput}
        onRetry={handleRetry}
        onScrollStateChange={(state) => aiAgentTabStore.setScrollState(tabId, state)}
      />

      <AiAgentComposer
        clusterDisplayName={clusterDisplayName}
        contextIndicator={contextIndicator}
        inputDraft={data.inputDraft}
        onChange={(value) => aiAgentTabStore.setInputDraft(tabId, value)}
        onRequestFocus={focusComposer}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            sendMessage();
          }
        }}
        onSend={sendMessage}
        onStop={stop}
        onTogglePermissionMode={togglePermissionMode}
        permissionMode={data.permissionMode}
        status={data.status}
        textareaRef={textareaRef}
      />
    </div>
  );
});

export const AiAgentView = withInjectables<Dependencies, AiAgentViewProps>(NonInjectedAiAgentView, {
  getProps: (di, props) => ({
    abortAiAgentMessage: di.inject(abortAiAgentMessageInjectable),
    aiAgentTabStore: di.inject(aiAgentTabStoreInjectable),
    hostedCluster: di.inject(hostedClusterInjectable),
    sendAiAgentMessage: di.inject(sendAiAgentMessageInjectable),
    showErrorNotification: di.inject(showErrorNotificationInjectable),
    showSuccessNotification: di.inject(showSuccessNotificationInjectable),
    userPreferencesState: di.inject(userPreferencesStateInjectable),
    ...props,
  }),
});
