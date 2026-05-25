/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observable, reaction } from "mobx";
import {
  type AiAgentMessage,
  deriveAiAgentSessionTitle,
  finalizeAiAgentMessagesForSave,
} from "../../../../features/ai-agent/common/transcript";

import type { AiAgentPermissionMode } from "../../../../features/ai-agent/common/channels";
import type { CreateStorage } from "../../../utils/create-storage/create-storage.injectable";

export interface AiAgentSession {
  id: string;
  title: string;
  titleSource?: "auto" | "manual";
  messages: AiAgentMessage[];
  clusterId?: string;
  permissionMode?: AiAgentPermissionMode;
  createdAt: number;
  updatedAt: number;
}

interface AiAgentSessionsStorage {
  sessions: Record<string, AiAgentSession>;
}

const normalizeSession = (id: string, session: Partial<AiAgentSession>): AiAgentSession => {
  const messages = finalizeAiAgentMessagesForSave(session.messages ?? []);
  const now = Date.now();
  const updatedAt = session.updatedAt ?? session.createdAt ?? now;

  return {
    id,
    title: session.title?.trim() || deriveAiAgentSessionTitle(messages),
    titleSource: session.titleSource === "manual" ? "manual" : "auto",
    messages,
    clusterId: session.clusterId,
    permissionMode: session.permissionMode,
    createdAt: session.createdAt ?? updatedAt,
    updatedAt,
  };
};

export class AiAgentSessionsRepository {
  private readonly sessions = observable.map<string, AiAgentSession>();
  private readonly storage;

  constructor(createStorage: CreateStorage) {
    this.storage = createStorage<AiAgentSessionsStorage>("ai_agent_sessions", { sessions: {} });

    for (const [id, session] of Object.entries(this.storage.get().sessions)) {
      this.sessions.set(id, normalizeSession(id, session));
    }

    reaction(
      () => this.toJSON(),
      (sessions) => {
        this.storage.set({ sessions });
      },
    );
  }

  save(sessionId: string, messages: AiAgentMessage[], clusterId?: string, permissionMode?: AiAgentPermissionMode) {
    if (!messages.length) {
      return;
    }

    const existing = this.sessions.get(sessionId);
    const now = Date.now();
    const derivedTitle = deriveAiAgentSessionTitle(messages);

    const nextTitle = existing?.titleSource === "manual" && existing.title?.trim() ? existing.title : derivedTitle;

    this.sessions.set(sessionId, {
      id: sessionId,
      title: nextTitle,
      titleSource: existing?.titleSource ?? "auto",
      messages: finalizeAiAgentMessagesForSave(messages),
      clusterId,
      permissionMode: permissionMode ?? existing?.permissionMode,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  get(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  listForCluster(clusterId?: string) {
    const sessions = Array.from(this.sessions.values());

    if (!clusterId) {
      return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    return sessions
      .filter((session) => !session.clusterId || session.clusterId === clusterId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  delete(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  rename(sessionId: string, title: string) {
    const existing = this.sessions.get(sessionId);

    if (!existing) {
      return;
    }

    this.sessions.set(sessionId, {
      ...existing,
      title: title.trim() || existing.title?.trim() || deriveAiAgentSessionTitle(existing.messages),
      titleSource: "manual",
      updatedAt: Date.now(),
    });
  }

  private toJSON(): Record<string, AiAgentSession> {
    return Object.fromEntries(this.sessions);
  }
}
