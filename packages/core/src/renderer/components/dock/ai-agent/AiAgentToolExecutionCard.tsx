/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { withInjectables } from "@ogre-tools/injectable-react";
import React from "react";
import aiAgentTabStoreInjectable from "./store.injectable";
import { formatAiAgentDuration } from "./view-model";

import type { AiAgentTabStore } from "./store";
import type { AiAgentToolExecutionBlock } from "./view-model";

interface AiAgentToolExecutionCardProps {
  block: AiAgentToolExecutionBlock;
  tabId: string;
  onContinue: (toolName: string) => void;
  onCopyPath: (path: string) => void;
  onOpenFullOutput: (path: string) => void;
  onRetry: (toolName: string, command?: string) => void;
}

interface Dependencies {
  aiAgentTabStore: AiAgentTabStore;
}

const getTruncationText = (block: AiAgentToolExecutionBlock) => {
  if (!block.details?.truncation?.truncated) {
    return undefined;
  }

  const { truncation } = block.details;

  return truncation.truncatedBy === "lines"
    ? `Showing ${truncation.outputLines}/${truncation.totalLines} lines`
    : `Showing ${Math.round(truncation.outputBytes / 1024)}KB of ${Math.round(truncation.totalBytes / 1024)}KB`;
};

const isLongOutput = (value: string | undefined) => {
  if (!value) {
    return false;
  }

  return value.length > 500 || value.split("\n").length > 12;
};

export const NonInjectedAiAgentToolExecutionCard = ({
  block,
  tabId,
  onContinue,
  onCopyPath,
  onOpenFullOutput,
  onRetry,
  aiAgentTabStore,
}: AiAgentToolExecutionCardProps & Dependencies) => {
  const [expanded, setExpanded] = React.useState(false);
  const [answers, setAnswers] = React.useState<Record<string, { selectedOptions: string[]; customInput?: string }>>({});

  const showExpand = isLongOutput(block.output);
  const truncationText = getTruncationText(block);
  const duration = formatAiAgentDuration(block.durationMs);
  const fullOutputPath = block.details?.fullOutputPath;
  const isStreaming = block.stage === "building" || block.stage === "running";

  const commandOrSummary = block.command || block.parameterSummary || "";

  const isAsk = block.name === "ask";
  const isPending = block.stage === "running" || block.stage === "building";

  let questions: any[] = [];
  if (isAsk) {
    try {
      const args = JSON.parse(block.argumentsText);
      questions = args.questions || [];
    } catch {
      // ignore
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const results = questions.map((q: any) => ({
      id: q.id,
      question: q.question,
      selectedOptions: answers[q.id]?.selectedOptions ?? [],
      customInput: answers[q.id]?.customInput || "",
      multi: !!q.multi,
    }));
    aiAgentTabStore.submitAskResponse(tabId, block.runId ?? "", block.toolCallId, results);
  };

  // 渲染交互的 Ask 表单
  const renderAskForm = () => {
    return (
      <div className="ask-question-form">
        {questions.map((q: any) => {
          const hasOptions = q.options && q.options.length > 0;
          return (
            <div key={q.id} className="ask-question-item">
              <div className="ask-question-text">{q.question}</div>
              {hasOptions ? (
                <div className="ask-options-list">
                  {q.options.map((opt: any, optIdx: number) => {
                    const isSelected = answers[q.id]?.selectedOptions?.includes(opt.label) || false;
                    return (
                      <label key={optIdx} className="ask-option-row">
                        <input
                          type={q.multi ? "checkbox" : "radio"}
                          name={q.id}
                          checked={isSelected}
                          onChange={() => {
                            const currentSelected = answers[q.id]?.selectedOptions || [];
                            let nextSelected: string[];
                            if (q.multi) {
                              if (isSelected) {
                                nextSelected = currentSelected.filter((v) => v !== opt.label);
                              } else {
                                nextSelected = [...currentSelected, opt.label];
                              }
                            } else {
                              nextSelected = [opt.label];
                            }
                            setAnswers({
                              ...answers,
                              [q.id]: {
                                ...answers[q.id],
                                selectedOptions: nextSelected,
                              },
                            });
                          }}
                        />
                        <span className="ask-option-text">
                          {opt.label}
                          {q.recommended === optIdx ? <span className="recommended-badge">(Recommended)</span> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
              <div className="ask-custom-input-wrapper">
                <input
                  type="text"
                  className="ask-custom-input-field"
                  placeholder={hasOptions ? "Or enter custom input..." : "Type your answer..."}
                  value={answers[q.id]?.customInput ?? ""}
                  onChange={(e) => {
                    setAnswers({
                      ...answers,
                      [q.id]: {
                        ...answers[q.id],
                        customInput: e.target.value,
                      },
                    });
                  }}
                />
              </div>
            </div>
          );
        })}
        <button type="button" onClick={handleSubmit} className="ask-submit-btn">
          Submit Response
        </button>
      </div>
    );
  };

  // 渲染只读的 Ask 结果
  const renderAskReadonly = () => {
    const results = (block.details as any)?.results;
    if (results && results.length > 0) {
      return (
        <div className="ask-readonly-results">
          {results.map((res: any, idx: number) => {
            const hasAnswers = (res.selectedOptions && res.selectedOptions.length > 0) || res.customInput;
            return (
              <div key={idx} className="ask-readonly-item">
                <span className="ask-readonly-question">{res.question}</span>
                <div className="ask-readonly-answers">
                  {res.selectedOptions?.map((opt: string, optIdx: number) => (
                    <span key={optIdx} className="ask-readonly-badge option">
                      {opt}
                    </span>
                  ))}
                  {res.customInput ? <span className="ask-readonly-badge custom">"{res.customInput}"</span> : null}
                  {!hasAnswers ? (
                    <span
                      className="ask-readonly-badge custom"
                      style={{ color: "var(--ai-text-faint)", background: "transparent", borderStyle: "dashed" }}
                    >
                      No answer
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      );
    }
    return <pre className="tool-card-output">{block.output}</pre>;
  };

  return (
    <div className={`AiAgentToolExecutionCard ${block.stage} ${block.isError ? "is-error" : ""}`}>
      <div className="tool-header-row">
        <span className={`status-dot ${block.stage}`} />
        <span className="tool-name-label">{block.name}</span>
        {commandOrSummary ? <span className="tool-command-text">({commandOrSummary})</span> : null}
        {duration ? <span className="tool-duration"> · {duration}</span> : null}
        {truncationText ? <span className="tool-truncation-meta"> · {truncationText}</span> : null}
      </div>

      <div className="tool-output-indent-container">
        <span className="indent-connector">└</span>
        <div className="tool-output-content-box">
          {isAsk ? (
            isPending ? (
              renderAskForm()
            ) : (
              renderAskReadonly()
            )
          ) : block.output ? (
            <div className={`tool-card-output-shell ${showExpand && !expanded ? "collapsed" : ""}`}>
              <pre className={`tool-card-output ${block.isError ? "error" : ""}`}>{block.output}</pre>
            </div>
          ) : (
            <div className="tool-card-empty">{isStreaming ? "Waiting for output..." : "No output yet."}</div>
          )}

          {!isAsk && (
            <div className="tool-card-actions">
              {showExpand ? (
                <button type="button" className="ghost-action" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? "Collapse output" : "Expand output"}
                </button>
              ) : null}
              {fullOutputPath ? (
                <button type="button" className="ghost-action" onClick={() => onOpenFullOutput(fullOutputPath)}>
                  Open full output
                </button>
              ) : null}
              {fullOutputPath ? (
                <button type="button" className="ghost-action" onClick={() => onCopyPath(fullOutputPath)}>
                  Copy path
                </button>
              ) : null}
              {block.isError ? (
                <button type="button" className="ghost-action" onClick={() => onRetry(block.name, block.command)}>
                  Retry
                </button>
              ) : null}
              {block.isError ? (
                <button type="button" className="ghost-action" onClick={() => onContinue(block.name)}>
                  Continue
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const AiAgentToolExecutionCard = withInjectables<Dependencies, AiAgentToolExecutionCardProps>(
  NonInjectedAiAgentToolExecutionCard,
  {
    getProps: (di, props) => ({
      aiAgentTabStore: di.inject(aiAgentTabStoreInjectable),
      ...props,
    }),
  },
);
