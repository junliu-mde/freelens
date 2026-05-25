/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import React from "react";
import { renderAiAgentMarkdown } from "./render-markdown";

interface AiAgentCompactionCardProps {
  summary: string;
  tokensBefore: number;
  onCopySummary: (summary: string) => void;
}

export const AiAgentCompactionCard = ({ onCopySummary, summary, tokensBefore }: AiAgentCompactionCardProps) => (
  <div className="AiAgentCompactionCard">
    <div className="compaction-header">
      <div className="compaction-title">history compacted</div>
      <button type="button" className="ghost-action" onClick={() => onCopySummary(summary)}>
        Copy summary
      </button>
    </div>
    <div className="compaction-meta">{Math.max(1, Math.round(tokensBefore / 1_000))}k tokens before checkpoint</div>
    <div className="compaction-note">Older messages were summarized to keep the session running.</div>
    <div className="agent-markdown" dangerouslySetInnerHTML={renderAiAgentMarkdown(summary)} />
  </div>
);
