/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "./ai-agent.scss";

import { Icon } from "@freelensapp/icon";
import { cssNames } from "@freelensapp/utilities";
import { withInjectables } from "@ogre-tools/injectable-react";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { marked } from "marked";
import { observer } from "mobx-react";
import React from "react";
import hostedClusterInjectable from "../../../cluster-frame-context/hosted-cluster.injectable";
import abortAiAgentMessageInjectable from "../../../ipc/abort-ai-agent-message.injectable";
import sendAiAgentMessageInjectable from "../../../ipc/send-ai-agent-message.injectable";
import aiAgentTabStoreInjectable from "./store.injectable";

import type { AiAgentMessage, AiAgentMessagePart, AiAgentTabStore } from "./store";
import type { AbortAiAgentMessage } from "../../../ipc/abort-ai-agent-message.injectable";
import type { SendAiAgentMessage } from "../../../ipc/send-ai-agent-message.injectable";
export interface AiAgentViewProps {
  tabId: string;
}

interface Dependencies {
  abortAiAgentMessage: AbortAiAgentMessage;
  aiAgentTabStore: AiAgentTabStore;
  hostedCluster: { id: string; name: { get(): string } } | undefined;
  sendAiAgentMessage: SendAiAgentMessage;
}

const getTextFromMessage = (message: AiAgentMessage) =>
  message.parts
    .filter((part): part is Extract<AiAgentMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");

const renderer = new marked.Renderer();

renderer.code = ({ text, lang }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : undefined;
  const highlighted = language ? hljs.highlight(text, { language }).value : hljs.highlightAuto(text).value;
  const languageClass = language ? ` language-${language}` : "";

  return `<pre class="agent-code"><code class="hljs${languageClass}">${highlighted}</code></pre>`;
};

marked.setOptions({
  breaks: true,
  gfm: true,
  renderer,
});

const renderMarkdown = (markdown: string) => ({
  __html: DOMPurify.sanitize(marked.parse(markdown) as string),
});

@observer
class NonInjectedAiAgentView extends React.Component<AiAgentViewProps & Dependencies> {
  private readonly messagesEndRef = React.createRef<HTMLDivElement>();
  private sessionMenuRef = React.createRef<HTMLDivElement>();
  private textareaRef = React.createRef<HTMLTextAreaElement>();

  state = { sessionMenuOpen: false };

  componentDidMount() {
    this.props.aiAgentTabStore.initTab(this.props.tabId);
    this.scrollToBottom();

    // Focus input and place cursor at the beginning when a draft is pre-filled (e.g. from "Ask AI")
    const { inputDraft, messages } = this.data;

    if (inputDraft && messages.length === 0 && this.textareaRef.current) {
      this.textareaRef.current.focus();
      this.textareaRef.current.setSelectionRange(0, 0);
    }
  }

  componentDidUpdate() {
    this.scrollToBottom();
  }

  componentWillUnmount() {
    document.removeEventListener("click", this.onDocumentClick);
  }

  private onDocumentClick = (evt: MouseEvent) => {
    if (this.sessionMenuRef.current && !this.sessionMenuRef.current.contains(evt.target as Node)) {
      this.setState({ sessionMenuOpen: false });
      document.removeEventListener("click", this.onDocumentClick);
    }
  };

  get data() {
    return this.props.aiAgentTabStore.initTab(this.props.tabId);
  }

  get isStreaming() {
    return this.data.status === "streaming";
  }

  private scrollToBottom() {
    this.messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  private onInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    this.props.aiAgentTabStore.setInputDraft(this.props.tabId, event.currentTarget.value);
  };

  private onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Tab" && event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      this.props.aiAgentTabStore.togglePermissionMode(this.props.tabId);

      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      this.sendMessage();
    }
  };

  private sendMessage = () => {
    const text = this.data.inputDraft.trim();

    if (!text || this.isStreaming) {
      return;
    }

    const runId = crypto.randomUUID();
    const { aiAgentTabStore, hostedCluster } = this.props;
    const hostedClusterId = hostedCluster?.id;

    // Bind this tab to the current cluster on first use
    if (!this.data.clusterId && hostedClusterId) {
      aiAgentTabStore.setClusterId(this.props.tabId, hostedClusterId);
    }

    aiAgentTabStore.appendUserMessage(this.props.tabId, text);
    aiAgentTabStore.startAssistantMessage(this.props.tabId, runId);
    aiAgentTabStore.autoSaveSession(this.props.tabId);

    const messages = aiAgentTabStore
      .initTab(this.props.tabId)
      .messages.filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role,
        content: getTextFromMessage(message),
      }))
      .filter((message) => message.content.trim());

    this.props
      .sendAiAgentMessage({
        tabId: this.props.tabId,
        runId,
        messages,
        permissionMode: this.data.permissionMode,
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);

        aiAgentTabStore.appendError(this.props.tabId, runId, message);
        aiAgentTabStore.finishRun(this.props.tabId, runId, "error");
      });
  };

  private stop = () => {
    const { activeRunId } = this.data;

    if (!activeRunId) {
      return;
    }

    this.props.abortAiAgentMessage(this.props.tabId, activeRunId);
    this.props.aiAgentTabStore.finishRun(this.props.tabId, activeRunId, "aborted");
    this.props.aiAgentTabStore.autoSaveSession(this.props.tabId);
  };

  private newSession = () => {
    this.props.aiAgentTabStore.newSession(this.props.tabId);
  };

  private toggleSessionMenu = () => {
    const isOpen = !this.state.sessionMenuOpen;

    this.setState({ sessionMenuOpen: isOpen });

    if (isOpen) {
      document.addEventListener("click", this.onDocumentClick);
    } else {
      document.removeEventListener("click", this.onDocumentClick);
    }
  };

  private switchSession = (sessionId: string) => {
    this.props.aiAgentTabStore.switchToSession(this.props.tabId, sessionId);
    this.setState({ sessionMenuOpen: false });
    document.removeEventListener("click", this.onDocumentClick);
  };

  private deleteSession = (evt: React.MouseEvent, sessionId: string) => {
    evt.stopPropagation();
    this.props.aiAgentTabStore.deleteSession(sessionId);
  };

  private getClusterDisplayName = (): string | undefined => this.props.hostedCluster?.name.get();

  private renderParts = (parts: AiAgentMessagePart[]) => {
    // First pass: collect tool results keyed by toolCallId
    const resultsByCallId = new Map<string, Extract<AiAgentMessagePart, { type: "tool_result" }>[]>();

    for (const part of parts) {
      if (part.type === "tool_result") {
        const existing = resultsByCallId.get(part.toolCallId) ?? [];

        existing.push(part);
        resultsByCallId.set(part.toolCallId, existing);
      }
    }

    const consumedResultIds = new Set<string>();
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < parts.length) {
      const part = parts[i];

      if (part.type === "text") {
        if (part.text) {
          elements.push(
            <div key={`t-${i}`} className="agent-markdown" dangerouslySetInnerHTML={renderMarkdown(part.text)} />,
          );
        }

        i += 1;
        continue;
      }

      if (part.type === "thinking") {
        elements.push(
          <details key={`th-${i}`} className="thinking-block">
            <summary>
              <span className="summary-prefix">◇</span>
              <span>thinking</span>
              <span className="summary-status">{part.done ? "done" : "streaming"}</span>
            </summary>
            <pre>{part.text}</pre>
          </details>,
        );
        i += 1;
        continue;
      }

      if (part.type === "tool_call") {
        const callPart = part;
        const resultParts = resultsByCallId.get(callPart.toolCallId) ?? [];

        consumedResultIds.add(callPart.toolCallId);

        const hasResult = resultParts.length > 0;
        const isError = resultParts.some((r) => r.isError);
        const resultContent = resultParts.map((r) => r.content).join("\n");
        const argumentsStr = (callPart.argumentsText || "").trim();
        const sameLineArgs = this.buildToolCallSummary(callPart.name, argumentsStr);

        elements.push(
          <details key={`tc-${i}`} className={cssNames("tool-flow-block")}>
            <summary>
              <span className="summary-prefix">❯</span>
              <code className="tool-flow-name">{sameLineArgs}</code>
            </summary>
            {hasResult ? (
              <pre className={cssNames("tool-flow-result", { error: isError })}>{resultContent}</pre>
            ) : callPart.done ? (
              <div className="tool-flow-waiting">Running…</div>
            ) : (
              <div className="tool-flow-waiting">Building…</div>
            )}
          </details>,
        );
        i += 1;
        continue;
      }

      if (part.type === "tool_result") {
        // Skip: already consumed by a tool_call above
        if (consumedResultIds.has(part.toolCallId)) {
          i += 1;
          continue;
        }

        elements.push(
          <details
            key={`tr-${i}`}
            className={cssNames("tool-flow-block", "tool-result-block", { error: part.isError })}
          >
            <summary>
              <span className="summary-prefix">❯</span>
              <code className="tool-flow-name">kubectl result</code>
            </summary>
            <pre className={cssNames("tool-flow-result", { error: part.isError })}>{part.content}</pre>
          </details>,
        );
        i += 1;
        continue;
      }

      if (part.type === "error") {
        elements.push(
          <div key={`e-${i}`} className="error-block">
            {part.message}
          </div>,
        );
        i += 1;
        continue;
      }

      i += 1;
    }

    return elements;
  };

  private buildToolCallSummary = (name: string, argsText: string) => {
    if (!argsText) {
      return name;
    }

    try {
      const args = JSON.parse(argsText);
      const parts: string[] = [];

      for (const [_key, val] of Object.entries(args)) {
        if (val !== undefined && val !== null && val !== "") {
          const str = String(val);

          parts.push(str.length > 60 ? `${str.slice(0, 57)}…` : str);
        }
      }

      return parts.length > 0 ? `${name}(${parts.join(" ")})` : name;
    } catch {
      return `${name}(${argsText})`;
    }
  };

  private getCurrentSessionTitle = (): string => {
    const { messages } = this.data;

    if (!messages.length) return "New session";

    const firstUser = messages.find((m) => m.role === "user");

    if (firstUser) {
      const text = firstUser.parts
        .filter((p): p is Extract<AiAgentMessagePart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join(" ")
        .trim();

      if (text) {
        return text.length > 30 ? `${text.slice(0, 27)}…` : text;
      }
    }

    return "New session";
  };

  private formatSessionTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;

    return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  private renderMessage = (message: AiAgentMessage) => {
    const isUser = message.role === "user";
    const text = getTextFromMessage(message);

    return (
      <div key={message.id} className={cssNames("AiAgentMessage", { user: isUser, assistant: !isUser })}>
        <div className="message-body">
          <div className="message-role">
            <span className="terminal-prompt">{isUser ? "❯" : "●"}</span>
            <span>{isUser ? "user" : "agent"}</span>
            <span className="message-status">{message.status}</span>
          </div>
          <div className="message-content">
            {this.renderParts(message.parts)}
            {!text && message.status === "streaming" ? <span className="streaming-placeholder">...</span> : null}
          </div>
        </div>
      </div>
    );
  };

  render() {
    const { inputDraft, messages } = this.data;
    const sessions = this.props.aiAgentTabStore.getSessionsForCluster(this.data.clusterId);
    const sessionTitle = this.getCurrentSessionTitle();
    const clusterDisplayName = this.getClusterDisplayName();

    return (
      <div className="AiAgent flex column">
        <div className="AiAgentToolbar flex gaps align-center">
          <Icon small material="terminal" />
          <span className="toolbar-title">{sessionTitle}</span>
          {clusterDisplayName ? <span className="toolbar-cluster">{clusterDisplayName}</span> : null}
          <span
            className={cssNames("toolbar-permission", { "read-write": this.data.permissionMode === "read-write" })}
            title="Shift+Tab to toggle permission mode"
          >
            {this.data.permissionMode === "read-write" ? "read-write" : "read-only"}
          </span>
          <span className="toolbar-status">{this.isStreaming ? "running" : "ready"}</span>
          <div className="box grow" />
          {this.isStreaming ? <Icon material="stop_circle" tooltip="Stop" onClick={this.stop} /> : null}
          <div className="session-switcher" ref={this.sessionMenuRef}>
            <Icon material="history" tooltip="Sessions" onClick={this.toggleSessionMenu} />
            {this.state.sessionMenuOpen ? (
              <div className="session-menu">
                <div className="session-menu-header">
                  <span>Sessions</span>
                  <Icon small material="add" tooltip="New session" onClick={this.newSession} />
                </div>
                <div className="session-menu-list">
                  {sessions.length === 0 ? (
                    <div className="session-menu-empty">No previous sessions</div>
                  ) : (
                    sessions.map((session) => (
                      <div
                        key={session.id}
                        className={cssNames("session-menu-item", { active: session.id === this.data.sessionId })}
                        onClick={() => this.switchSession(session.id)}
                      >
                        <div className="session-item-title">{session.title}</div>
                        <div className="session-item-meta">
                          {this.formatSessionTime(session.updatedAt)} ·{" "}
                          {session.messages.filter((m) => m.role === "user").length} turns
                        </div>
                        <Icon
                          small
                          material="close"
                          className="session-item-delete"
                          onClick={(evt) => this.deleteSession(evt, session.id)}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <Icon material="add_circle_outline" tooltip="New session" onClick={this.newSession} />
        </div>

        <div className="AiAgentMessages flex column box grow">
          {messages.length === 0 ? (
            <div className="empty-state flex column box grow align-center justify-center">
              <Icon material="smart_toy" size={48} />
              <p>Agent terminal ready</p>
              <p className="hint">Ask for Kubernetes diagnostics. Tool calls will run as collapsible steps.</p>
            </div>
          ) : null}
          {messages.map(this.renderMessage)}
          <div ref={this.messagesEndRef} />
        </div>

        <div
          className={cssNames("AiAgentInput", "flex", "gaps", "align-center", {
            "read-write": this.data.permissionMode === "read-write",
          })}
        >
          <textarea
            ref={this.textareaRef}
            value={inputDraft}
            onChange={this.onInputChange}
            onKeyDown={this.onKeyDown}
            placeholder="Type an instruction. Enter to run, Shift+Enter for newline, Shift+Tab to toggle read-only/read-write."
            disabled={this.isStreaming}
          />
          <button type="button" onClick={this.sendMessage} disabled={!inputDraft.trim() || this.isStreaming}>
            Send
          </button>
        </div>
      </div>
    );
  }
}

export const AiAgentView = withInjectables<Dependencies, AiAgentViewProps>(NonInjectedAiAgentView, {
  getProps: (di, props) => ({
    abortAiAgentMessage: di.inject(abortAiAgentMessageInjectable),
    aiAgentTabStore: di.inject(aiAgentTabStoreInjectable),
    hostedCluster: di.inject(hostedClusterInjectable),
    sendAiAgentMessage: di.inject(sendAiAgentMessageInjectable),
    ...props,
  }),
});
