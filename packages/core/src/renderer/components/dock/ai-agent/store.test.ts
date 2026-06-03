/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { AiAgentTabStore } from "./store";
import { createMockStorage } from "./test-helpers";

describe("AiAgentTabStore", () => {
  const tabId = "tab-id";
  let uuidCount: number;

  beforeEach(() => {
    uuidCount = 0;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        ...globalThis.crypto,
        randomUUID: jest.fn(() => `uuid-${++uuidCount}`),
      },
    });
  });

  it("keeps the active streaming message after compaction history is replaced", () => {
    const store = new AiAgentTabStore({
      createStorage: createMockStorage(),
      ipcRenderer: { invoke: jest.fn() } as any,
    });

    store.initTab(tabId);
    store.appendUserMessage(tabId, "Inspect the failing pod");
    store.startAssistantMessage(tabId, "run-1");
    store.appendTextDelta(tabId, "run-1", "Working on it");
    store.setScrollState(tabId, { isNearBottom: false });

    store.replaceConversationHistory(tabId, "run-1", [
      {
        role: "user",
        createdAt: 1,
        parts: [{ type: "compaction_summary", summary: "## Goal\nInspect the failing pod", tokensBefore: 52_000 }],
      },
    ]);

    const data = store.initTab(tabId);

    expect(data.messages).toHaveLength(2);
    expect(data.messages[1]).toMatchObject({
      role: "assistant",
      runId: "run-1",
      status: "streaming",
    });
    expect(data.lastCompactionAt).toBeDefined();
    expect(data.lastCompactionSummaryPreview).toBe("## Goal");
  });

  it("keeps a manual session title after more messages are saved", () => {
    const store = new AiAgentTabStore({
      createStorage: createMockStorage(),
      ipcRenderer: { invoke: jest.fn() } as any,
    });

    store.initTab(tabId);

    store.appendUserMessage(tabId, "Inspect the daemonset");
    store.autoSaveSession(tabId);
    const activeSessionId = store.initTab(tabId).sessionId;
    store.renameSession(activeSessionId, "Daemonset follow-up");
    store.appendUserMessage(tabId, "Check the logs too");
    store.autoSaveSession(tabId);

    expect(store.getSession(activeSessionId)).toMatchObject({
      title: "Daemonset follow-up",
      titleSource: "manual",
    });
  });

  it("does not clear unread state when scroll updates omit that field", () => {
    const store = new AiAgentTabStore({
      createStorage: createMockStorage(),
      ipcRenderer: { invoke: jest.fn() } as any,
    });

    store.initTab(tabId);
    store.setScrollState(tabId, { hasUnreadBelow: true, isNearBottom: false });
    store.setScrollState(tabId, { isNearBottom: false });

    expect(store.initTab(tabId)).toMatchObject({
      hasUnreadBelow: true,
      isNearBottom: false,
    });
  });

  it("hydrates legacy tab data with missing UI-only fields", () => {
    const store = new AiAgentTabStore({
      createStorage: createMockStorage(),
      ipcRenderer: { invoke: jest.fn() } as any,
    });

    store.setData(tabId, {
      inputDraft: "",
      messages: [],
      sessionId: "legacy-session",
      permissionMode: "read-only",
    } as any);

    expect(store.initTab(tabId)).toMatchObject({
      status: "idle",
      isNearBottom: true,
      hasUnreadBelow: false,
      sessionSearch: "",
    });
  });
});
