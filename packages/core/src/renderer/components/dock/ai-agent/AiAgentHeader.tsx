/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import React from "react";

interface AiAgentHeaderProps {
  onNewSession: () => void;
  onOpenSessions: () => void;
  sessionCount: number;
  sessionTitle: string;
}

export const AiAgentHeader = ({ onNewSession, onOpenSessions, sessionCount, sessionTitle }: AiAgentHeaderProps) => {
  return (
    <header className="AiAgentHeader">
      <div className="header-shell">
        <div className="header-toolbar">
          <div className="header-title-row">
            <span className="header-title-label">session</span>
            <span className="header-title" title={sessionTitle}>
              {sessionTitle}
            </span>
          </div>

          <div className="header-actions">
            <button type="button" className="header-command" onClick={onOpenSessions}>
              {`history ${sessionCount}`}
            </button>
            <span className="header-actions-sep">·</span>
            <button type="button" className="header-command new-session" onClick={onNewSession}>
              + new
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
