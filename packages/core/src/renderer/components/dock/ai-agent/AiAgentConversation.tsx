/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import React from "react";
import { AiAgentMessageCard } from "./AiAgentMessageCard";

import type { AiAgentMessageCardViewModel } from "./view-model";

interface AiAgentConversationProps {
  conversationVersion: string;
  hasUnreadBelow: boolean;
  isNearBottom: boolean;
  lastCompactionAt?: number;
  lastCompactionSummaryPreview?: string;
  messages: AiAgentMessageCardViewModel[];
  tabId: string;
  onContinue: (toolName: string) => void;
  onCopyPath: (path: string) => void;
  onCopySummary: (summary: string) => void;
  onOpenFullOutput: (path: string) => void;
  onRetry: (toolName: string, command?: string) => void;
  onScrollStateChange: (state: { hasUnreadBelow?: boolean; isNearBottom?: boolean }) => void;
  onRewind?: (messageId: string) => void;
}

const nearBottomThreshold = 80;

export const AiAgentConversation = ({
  conversationVersion,
  hasUnreadBelow,
  isNearBottom,
  lastCompactionAt,
  lastCompactionSummaryPreview,
  messages,
  tabId,
  onContinue,
  onCopyPath,
  onCopySummary,
  onOpenFullOutput,
  onRetry,
  onScrollStateChange,
  onRewind,
}: AiAgentConversationProps) => {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const didMountRef = React.useRef(false);
  const nearBottomRef = React.useRef(isNearBottom);

  const scrollToLatest = (behavior: ScrollBehavior) => {
    endRef.current?.scrollIntoView({ behavior, block: "end" });
    nearBottomRef.current = true;
    onScrollStateChange({
      hasUnreadBelow: false,
      isNearBottom: true,
    });
  };

  const updateScrollState = () => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const nearBottom = distanceToBottom <= nearBottomThreshold;

    nearBottomRef.current = nearBottom;
    onScrollStateChange({
      isNearBottom: nearBottom,
      hasUnreadBelow: nearBottom ? false : undefined,
    });
  };

  React.useLayoutEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;

      if (nearBottomRef.current) {
        scrollToLatest("auto");
      }

      return;
    }

    if (nearBottomRef.current) {
      scrollToLatest("auto");

      return;
    }

    onScrollStateChange({ hasUnreadBelow: true });
  }, [conversationVersion]);

  const showCompactionHint = Boolean(
    messages.length > 0 &&
      lastCompactionAt &&
      Date.now() - lastCompactionAt < 8_000 &&
      !isNearBottom &&
      lastCompactionSummaryPreview,
  );

  return (
    <section className="AiAgentConversation">
      <div className="conversation-viewport" ref={viewportRef} onScroll={updateScrollState}>
        {messages.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">$ no transcript yet</p>
          </div>
        ) : (
          <div className="conversation-timeline">
            {messages.map((message) => (
              <AiAgentMessageCard
                key={message.id}
                tabId={tabId}
                message={message}
                onContinue={onContinue}
                onCopyPath={onCopyPath}
                onCopySummary={onCopySummary}
                onOpenFullOutput={onOpenFullOutput}
                onRetry={onRetry}
                onRewind={onRewind}
              />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {showCompactionHint ? (
        <button type="button" className="conversation-floating-note" onClick={() => scrollToLatest("smooth")}>
          History compacted.{" "}
          <svg
            viewBox="0 0 24 24"
            className="jump-icon"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </svg>{" "}
          Jump to latest
        </button>
      ) : null}

      {messages.length > 0 && hasUnreadBelow ? (
        <button type="button" className="conversation-jump-button" onClick={() => scrollToLatest("smooth")}>
          New output.{" "}
          <svg
            viewBox="0 0 24 24"
            className="jump-icon"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </svg>{" "}
          Jump to latest
        </button>
      ) : null}
    </section>
  );
};
