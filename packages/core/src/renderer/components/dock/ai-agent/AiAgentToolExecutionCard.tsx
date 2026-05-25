/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import React from "react";
import { formatAiAgentDuration } from "./view-model";

import type { AiAgentToolExecutionBlock } from "./view-model";

interface AiAgentToolExecutionCardProps {
  block: AiAgentToolExecutionBlock;
  onContinue: (toolName: string) => void;
  onCopyPath: (path: string) => void;
  onOpenFullOutput: (path: string) => void;
  onRetry: (toolName: string, command?: string) => void;
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

export const AiAgentToolExecutionCard = ({
  block,
  onContinue,
  onCopyPath,
  onOpenFullOutput,
  onRetry,
}: AiAgentToolExecutionCardProps) => {
  const [expanded, setExpanded] = React.useState(false);
  const showExpand = isLongOutput(block.output);
  const truncationText = getTruncationText(block);
  const duration = formatAiAgentDuration(block.durationMs);
  const fullOutputPath = block.details?.fullOutputPath;
  const isStreaming = block.stage === "building" || block.stage === "running";

  const commandOrSummary = block.command || block.parameterSummary || "";

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
          {block.output ? (
            <div className={`tool-card-output-shell ${showExpand && !expanded ? "collapsed" : ""}`}>
              <pre className={`tool-card-output ${block.isError ? "error" : ""}`}>{block.output}</pre>
            </div>
          ) : (
            <div className="tool-card-empty">{isStreaming ? "Waiting for output..." : "No output yet."}</div>
          )}

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
        </div>
      </div>
    </div>
  );
};
