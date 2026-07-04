/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import React from "react";
import { AiAgentCompactionCard } from "./AiAgentCompactionCard";
import { AiAgentToolExecutionCard } from "./AiAgentToolExecutionCard";
import { renderAiAgentMarkdown } from "./render-markdown";

import type { AiAgentMessageCardViewModel } from "./view-model";

interface AiAgentMessageCardProps {
  message: AiAgentMessageCardViewModel;
  tabId: string;
  onContinue: (toolName: string) => void;
  onCopyPath: (path: string) => void;
  onCopySummary: (summary: string) => void;
  onOpenFullOutput: (path: string) => void;
  onRetry: (toolName: string, command?: string) => void;
  onRewind?: (messageId: string) => void;
}

const formatTimestamp = (value: number) =>
  new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

export const AiAgentMessageCard = ({
  message,
  tabId,
  onContinue,
  onCopyPath,
  onCopySummary,
  onOpenFullOutput,
  onRetry,
  onRewind,
}: AiAgentMessageCardProps) => {
  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, textarea")) {
      return;
    }

    if (message.kind === "user" && onRewind) {
      onRewind(message.id);
    }
  };

  return (
    <article
      className={`AiAgentMessageCard ${message.kind}`}
      onClick={message.kind === "user" ? handleCardClick : undefined}
      style={message.kind === "user" ? { cursor: "pointer" } : undefined}
    >
      <div className="message-gutter">
        <div className="message-node" />
        <div className="message-rail" />
      </div>
      <div className="message-shell">
        <div className="message-meta">
          <div className="message-label-row">
            <span className="message-label">{message.label}</span>
            <span className="message-status">{message.status}</span>
          </div>
          <div className="message-time-and-actions">
            {message.kind === "user" && onRewind ? (
              <button
                type="button"
                className="rewind-action-btn"
                title="Rewind conversation to this message"
                onClick={(e) => {
                  e.stopPropagation();
                  onRewind(message.id);
                }}
              >
                Rewind
              </button>
            ) : null}
            <div className="message-time">{formatTimestamp(message.createdAt)}</div>
          </div>
        </div>

        {message.blocks.map((block) => {
          switch (block.type) {
            case "text":
              return (
                <div key={block.id} className="message-answer">
                  <div className="agent-markdown" dangerouslySetInnerHTML={renderAiAgentMarkdown(block.text)} />
                </div>
              );
            case "thinking":
              return (
                <div key={block.id} className="message-execution">
                  <details className="AiAgentThinkingBlock">
                    <summary>
                      <span className="thinking-summary-label">thinking</span>
                      <span className="thinking-summary-state">{block.done ? "done" : "streaming"}</span>
                    </summary>
                    <pre>{block.text || "No visible reasoning yet."}</pre>
                  </details>
                </div>
              );
            case "tool":
              return (
                <div key={block.id} className="message-execution">
                  <AiAgentToolExecutionCard
                    block={block}
                    tabId={tabId}
                    onContinue={onContinue}
                    onCopyPath={onCopyPath}
                    onOpenFullOutput={onOpenFullOutput}
                    onRetry={onRetry}
                  />
                </div>
              );
            case "error":
              return (
                <div key={block.id} className="message-execution">
                  <div className="AiAgentErrorBlock">{block.message}</div>
                </div>
              );
            case "compact":
              return (
                <div key={block.id} className="message-execution">
                  <AiAgentCompactionCard
                    summary={block.summary}
                    tokensBefore={block.tokensBefore}
                    onCopySummary={onCopySummary}
                  />
                </div>
              );
          }
        })}

        {message.showStreamingPlaceholder ? (
          <div className="streaming-placeholder">{message.streamingPlaceholderText}</div>
        ) : null}
      </div>
    </article>
  );
};
