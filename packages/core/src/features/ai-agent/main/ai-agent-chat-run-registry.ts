/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

const getRunKey = (tabId: string, runId: string) => `${tabId}:${runId}`;

export class AiAgentChatRunRegistry {
  private readonly activeRuns = new Map<string, AbortController>();

  create(tabId: string, runId: string) {
    const controller = new AbortController();

    this.activeRuns.set(getRunKey(tabId, runId), controller);

    return controller;
  }

  delete(tabId: string, runId: string) {
    this.activeRuns.delete(getRunKey(tabId, runId));
  }

  abort(tabId: string, runId: string, reason = "AI Agent run was stopped.") {
    const controller = this.activeRuns.get(getRunKey(tabId, runId));

    if (controller && !controller.signal.aborted) {
      controller.abort(reason);
    }
  }
}
