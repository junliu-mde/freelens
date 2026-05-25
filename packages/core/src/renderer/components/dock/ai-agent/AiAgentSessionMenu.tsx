/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import React from "react";

import type { AiAgentSessionListItemViewModel } from "./view-model";

interface AiAgentSessionMenuProps {
  onClose: () => void;
  onDelete: (sessionId: string) => void;
  onNewSession: () => void;
  onRename: (sessionId: string, title: string) => void;
  onSearch: (value: string) => void;
  onSwitch: (sessionId: string) => void;
  open: boolean;
  search: string;
  sessions: AiAgentSessionListItemViewModel[];
}

export const AiAgentSessionMenu = ({
  onClose,
  onDelete,
  onNewSession,
  onRename,
  onSearch,
  onSwitch,
  open,
  search,
  sessions,
}: AiAgentSessionMenuProps) => {
  const [editingSessionId, setEditingSessionId] = React.useState<string>();
  const [renameDraft, setRenameDraft] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setEditingSessionId(undefined);
      setRenameDraft("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="AiAgentSessionOverlay">
      <button type="button" className="session-overlay-backdrop" onClick={onClose} aria-label="Close session drawer" />
      <aside className="AiAgentSessionMenu">
        <div className="session-menu-header">
          <div className="session-menu-title">
            <span className="session-menu-title-text">history</span>
            <span className="session-menu-title-count">{`${sessions.length} sessions`}</span>
          </div>
          <button type="button" className="header-command" onClick={onClose} aria-label="Close session drawer">
            close
          </button>
        </div>

        <div className="session-menu-actions">
          <input
            type="search"
            value={search}
            placeholder="Search sessions"
            onChange={(event) => onSearch(event.currentTarget.value)}
          />
          <button type="button" className="ghost-action" onClick={onNewSession}>
            New session
          </button>
        </div>

        <div className="session-menu-list">
          {sessions.length === 0 ? <div className="session-menu-empty">No sessions match this view yet.</div> : null}

          {sessions.map((session) => {
            const isEditing = editingSessionId === session.id;

            return (
              <div key={session.id} className={`session-item ${session.active ? "active" : ""}`}>
                <button type="button" className="session-item-main" onClick={() => onSwitch(session.id)}>
                  <div className="session-item-title-row">
                    <span className="session-item-title">{session.title}</span>
                    <span className="session-item-cluster">{session.clusterLabel}</span>
                  </div>
                  <div className="session-item-meta">
                    <span>{session.turnCount} turns</span>
                    <span>{formatSessionTime(session.updatedAt)}</span>
                  </div>
                </button>

                <div className="session-item-actions">
                  <button
                    type="button"
                    className="ghost-action"
                    onClick={() => {
                      setEditingSessionId(session.id);
                      setRenameDraft(session.title);
                    }}
                  >
                    Rename
                  </button>
                  <button type="button" className="ghost-action danger" onClick={() => onDelete(session.id)}>
                    Delete
                  </button>
                </div>

                {isEditing ? (
                  <form
                    className="session-rename-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onRename(session.id, renameDraft);
                      setEditingSessionId(undefined);
                      setRenameDraft("");
                    }}
                  >
                    <input
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.currentTarget.value)}
                      autoFocus
                    />
                    <div className="session-rename-actions">
                      <button type="submit" className="ghost-action">
                        Save
                      </button>
                      <button
                        type="button"
                        className="ghost-action"
                        onClick={() => {
                          setEditingSessionId(undefined);
                          setRenameDraft("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
};

const formatSessionTime = (timestamp: number) => {
  const diff = Date.now() - timestamp;

  if (diff < 60_000) {
    return "just now";
  }

  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m ago`;
  }

  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }

  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
