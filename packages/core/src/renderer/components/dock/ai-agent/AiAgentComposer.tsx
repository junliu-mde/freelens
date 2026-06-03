/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import React from "react";
import { formatAiAgentRunState } from "./view-model";

import type { AiAgentPermissionMode } from "../../../../features/ai-agent/common/channels";
import type { AiAgentTabStatus } from "./store";
import type { AiAgentContextIndicatorViewModel } from "./view-model";

interface AiAgentComposerProps {
  clusterDisplayName?: string;
  contextIndicator: AiAgentContextIndicatorViewModel;
  inputDraft: string;
  onChange: (value: string) => void;
  onCompositionEnd?: (value: string) => void;
  onCompositionStart?: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onRequestFocus: (cursor?: "end" | "preserve") => void;
  onSend: () => void;
  onStop: () => void;
  onTogglePermissionMode: () => void;
  permissionMode: AiAgentPermissionMode;
  status: AiAgentTabStatus;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

export const AiAgentComposer = ({
  clusterDisplayName,
  contextIndicator,
  inputDraft,
  onChange,
  onCompositionEnd,
  onCompositionStart,
  onKeyDown,
  onRequestFocus,
  onSend,
  onStop,
  onTogglePermissionMode,
  permissionMode,
  status,
  textareaRef,
}: AiAgentComposerProps) => {
  const isBusy = status === "streaming" || status === "waiting-for-tool";
  const contextPercent = Math.max(1, contextIndicator.progress);
  const clusterLabel = clusterDisplayName?.trim() || "detached";
  const identityLabel = clusterLabel.includes("@") ? clusterLabel : `agent@${clusterLabel}`;
  const minTextareaHeight = 20;
  const shouldFocusComposer = (target: EventTarget | null) =>
    target instanceof HTMLElement && !target.closest("button, textarea");
  const focusTextareaTarget = (textarea: HTMLTextAreaElement) => {
    window.focus();

    if (document.activeElement !== textarea) {
      textarea.focus();
    }

    const end = textarea.value.length;

    textarea.setSelectionRange(end, end);
  };
  const updateDraftWithSelection = (
    textarea: HTMLTextAreaElement,
    nextText: string,
    selectionStart: number,
    selectionEnd = selectionStart,
  ) => {
    onChange(nextText);
    window.requestAnimationFrame(() => {
      focusTextareaTarget(textarea);
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  };
  const replaceSelection = (textarea: HTMLTextAreaElement, replacement: string) => {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const nextText = `${textarea.value.slice(0, start)}${replacement}${textarea.value.slice(end)}`;
    const nextCursor = start + replacement.length;

    updateDraftWithSelection(textarea, nextText, nextCursor);
  };

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(220, Math.max(textarea.scrollHeight, minTextareaHeight))}px`;
  }, [inputDraft, textareaRef]);

  return (
    <section className="AiAgentComposer">
      <div className="composer-shell">
        <div
          className={`composer-input-shell ${permissionMode}`}
          onClick={(event) => {
            if (!shouldFocusComposer(event.target)) {
              return;
            }

            onRequestFocus();
          }}
        >
          <div className="composer-input-row">
            <textarea
              autoFocus
              ref={textareaRef}
              rows={1}
              value={inputDraft}
              onChange={(event) => onChange(event.currentTarget.value)}
              onMouseDown={(event) => {
                if (document.activeElement === event.currentTarget) {
                  return;
                }

                window.focus();
                event.currentTarget.focus();
              }}
              onCompositionEnd={(event) => {
                onCompositionEnd?.(event.currentTarget.value);
              }}
              onCompositionStart={onCompositionStart}
              onKeyDown={onKeyDown}
              onPaste={(event) => {
                event.preventDefault();
                replaceSelection(event.currentTarget, event.clipboardData.getData("text"));
              }}
              placeholder="ask the cluster"
              spellCheck={false}
            />
            <button
              type="button"
              className={`composer-send-btn ${isBusy ? "stop" : "send"}`}
              onClick={isBusy ? onStop : onSend}
              disabled={!isBusy && !inputDraft.trim()}
              aria-label={isBusy ? "Stop" : "Send"}
            >
              {isBusy ? (
                <svg viewBox="0 0 24 24" className="btn-icon" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="1.5" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  className="btn-icon"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
              <span className="btn-text">{isBusy ? "Stop" : "Send"}</span>
            </button>
          </div>
        </div>

        <div className="composer-footer">
          <div className="powerline-bar composer-status-badges">
            <div className="powerline-segment identity" title="Identity">
              <span className="badge-text">{identityLabel}</span>
            </div>
            <button
              type="button"
              className={`powerline-segment mode ${permissionMode === "read-only" ? "readonly" : "readwrite"}`}
              onClick={onTogglePermissionMode}
              aria-label={`mode ${permissionMode}`}
            >
              <span className="badge-text">{permissionMode}</span>
            </button>
            <div className={`powerline-segment run ${status}`}>
              <span className="badge-text">{formatAiAgentRunState(status)}</span>
            </div>
            <div
              className={`powerline-segment context ${contextIndicator.tone}`}
              style={{ "--ai-context-progress": `${contextPercent}%` } as React.CSSProperties}
            >
              <div className="context-progress-bar" />
              <span className="badge-text">{`${contextPercent}% ctx`}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
