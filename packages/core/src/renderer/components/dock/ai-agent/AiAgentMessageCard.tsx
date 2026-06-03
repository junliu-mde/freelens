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
}: AiAgentMessageCardProps) => (
  <article className={`AiAgentMessageCard ${message.kind}`}>
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
        <div className="message-time">{formatTimestamp(message.createdAt)}</div>
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

      {message.showStreamingPlaceholder ? <div className="streaming-placeholder">waiting for output...</div> : null}
    </div>
  </article>
);
