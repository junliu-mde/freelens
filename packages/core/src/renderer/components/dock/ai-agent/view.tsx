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
import hostedClusterIdInjectable from "../../../cluster-frame-context/hosted-cluster-id.injectable";
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
  hostedClusterId: string | undefined;
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

  componentDidMount() {
    this.props.aiAgentTabStore.initTab(this.props.tabId);
    this.scrollToBottom();
  }

  componentDidUpdate() {
    this.scrollToBottom();
  }

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
    if (event.key === "Enter" && !event.shiftKey) {
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
    const { aiAgentTabStore, hostedClusterId } = this.props;

    // Bind this tab to the current cluster on first use
    if (!this.data.clusterId && hostedClusterId) {
      aiAgentTabStore.setClusterId(this.props.tabId, hostedClusterId);
    }

    aiAgentTabStore.appendUserMessage(this.props.tabId, text);
    aiAgentTabStore.startAssistantMessage(this.props.tabId, runId);

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
  };

  private clear = () => {
    this.props.aiAgentTabStore.clear(this.props.tabId);
  };

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

        // Unpaired result: show standalone
        elements.push(
          <div key={`tr-${i}`} className={cssNames("tool-result-block", { error: part.isError })}>
            <pre>{part.content}</pre>
          </div>,
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

    return (
      <div className="AiAgent flex column">
        <div className="AiAgentToolbar flex gaps align-center">
          <Icon small material="terminal" />
          <span className="toolbar-title">AI Agent Terminal</span>
          {this.data.clusterId ? <span className="toolbar-cluster">{this.data.clusterId.slice(0, 8)}</span> : null}
          <span className="toolbar-status">{this.isStreaming ? "running" : "ready"}</span>
          <div className="box grow" />
          {this.isStreaming ? <Icon material="stop_circle" tooltip="Stop" onClick={this.stop} /> : null}
          {messages.length > 0 ? <Icon material="delete_sweep" tooltip="Clear chat" onClick={this.clear} /> : null}
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

        <div className="AiAgentInput flex gaps align-center">
          <textarea
            value={inputDraft}
            onChange={this.onInputChange}
            onKeyDown={this.onKeyDown}
            placeholder="Type an instruction. Enter to run, Shift+Enter for newline."
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
    hostedClusterId: di.inject(hostedClusterIdInjectable),
    sendAiAgentMessage: di.inject(sendAiAgentMessageInjectable),
    ...props,
  }),
});
