/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { AiAgentTabStore } from "./store";
import { createMockStorage } from "./test-helpers";
import { NonInjectedAiAgentView } from "./view";

import type { UserEvent } from "@testing-library/user-event";

jest.mock("@freelensapp/icon", () => ({
  Icon: ({ material }: { material?: string }) => <span>{material}</span>,
}));

describe("<AiAgentView />", () => {
  let user: UserEvent;
  let store: AiAgentTabStore;
  let abortAiAgentMessage: jest.Mock;
  let uuidCount: number;
  let setSelectionRangeMock: jest.Mock;

  beforeEach(() => {
    user = userEvent.setup();
    store = new AiAgentTabStore({
      createStorage: createMockStorage(),
    });
    abortAiAgentMessage = jest.fn();
    Element.prototype.scrollIntoView = jest.fn();
    setSelectionRangeMock = jest.fn();
    HTMLTextAreaElement.prototype.setSelectionRange = setSelectionRangeMock;
    uuidCount = 0;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        ...globalThis.crypto,
        randomUUID: jest.fn(() => `uuid-${++uuidCount}`),
      },
    });
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);

      return 0;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("switches to read-write immediately from the header toggle", async () => {
    render(
      <NonInjectedAiAgentView
        abortAiAgentMessage={abortAiAgentMessage}
        aiAgentTabStore={store}
        hostedCluster={{ id: "cluster-1", name: { get: () => "cluster-1" } }}
        sendAiAgentMessage={jest.fn(() => Promise.resolve())}
        showErrorNotification={jest.fn()}
        showSuccessNotification={jest.fn()}
        tabId="tab-1"
        userPreferencesState={{ aiAgent: {} } as any}
      />,
    );

    await user.click(screen.getByRole("button", { name: "mode read-only" }));

    expect(store.initTab("tab-1").permissionMode).toBe("read-write");
  });

  it("keeps Shift+Tab as a shortcut for permission switching", async () => {
    render(
      <NonInjectedAiAgentView
        abortAiAgentMessage={abortAiAgentMessage}
        aiAgentTabStore={store}
        hostedCluster={{ id: "cluster-1", name: { get: () => "cluster-1" } }}
        sendAiAgentMessage={jest.fn(() => Promise.resolve())}
        showErrorNotification={jest.fn()}
        showSuccessNotification={jest.fn()}
        tabId="tab-shift-tab"
        userPreferencesState={{ aiAgent: {} } as any}
      />,
    );

    await user.click(screen.getByPlaceholderText("ask the cluster"));
    await user.keyboard("{Shift>}{Tab}{/Shift}");

    expect(store.initTab("tab-shift-tab").permissionMode).toBe("read-write");
  });

  it("switches the composer action to stop while streaming and aborts the run", async () => {
    store.initTab("tab-2");
    store.startAssistantMessage("tab-2", "run-1");

    render(
      <NonInjectedAiAgentView
        abortAiAgentMessage={abortAiAgentMessage}
        aiAgentTabStore={store}
        hostedCluster={{ id: "cluster-1", name: { get: () => "cluster-1" } }}
        sendAiAgentMessage={jest.fn(() => Promise.resolve())}
        showErrorNotification={jest.fn()}
        showSuccessNotification={jest.fn()}
        tabId="tab-2"
        userPreferencesState={{ aiAgent: {} } as any}
      />,
    );

    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(abortAiAgentMessage).toHaveBeenCalledWith("tab-2", "run-1");
    expect(store.initTab("tab-2").status).toBe("aborted");
  });

  it("does not keep moving the cursor to the start while the user is drafting", () => {
    store.setData("tab-typing", {
      inputDraft: "seed",
      messages: [],
      permissionMode: "read-only",
      sessionId: "session-typing",
    } as any);

    render(
      <NonInjectedAiAgentView
        abortAiAgentMessage={abortAiAgentMessage}
        aiAgentTabStore={store}
        hostedCluster={{ id: "cluster-1", name: { get: () => "cluster-1" } }}
        sendAiAgentMessage={jest.fn(() => Promise.resolve())}
        showErrorNotification={jest.fn()}
        showSuccessNotification={jest.fn()}
        tabId="tab-typing"
        userPreferencesState={{ aiAgent: {} } as any}
      />,
    );

    expect(setSelectionRangeMock).toHaveBeenCalledWith(4, 4);
    setSelectionRangeMock.mockClear();

    act(() => {
      store.setInputDraft("tab-typing", "seedx");
    });

    expect(setSelectionRangeMock).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("ask the cluster")).toHaveValue("seedx");
  });

  it("does not restore draft focus while the first character is being typed into a fresh session", () => {
    render(
      <NonInjectedAiAgentView
        abortAiAgentMessage={abortAiAgentMessage}
        aiAgentTabStore={store}
        hostedCluster={{ id: "cluster-1", name: { get: () => "cluster-1" } }}
        sendAiAgentMessage={jest.fn(() => Promise.resolve())}
        showErrorNotification={jest.fn()}
        showSuccessNotification={jest.fn()}
        tabId="tab-fresh"
        userPreferencesState={{ aiAgent: {} } as any}
      />,
    );

    setSelectionRangeMock.mockClear();

    act(() => {
      store.setInputDraft("tab-fresh", "继");
    });

    expect(store.initTab("tab-fresh").inputDraft).toBe("继");
    expect(setSelectionRangeMock).not.toHaveBeenCalled();
  });

  it("creates a new session from the header action and returns focus to the composer", async () => {
    store.initTab("tab-new-session");
    store.appendUserMessage("tab-new-session", "why did node 008 fail again?");

    render(
      <NonInjectedAiAgentView
        abortAiAgentMessage={abortAiAgentMessage}
        aiAgentTabStore={store}
        hostedCluster={{ id: "cluster-1", name: { get: () => "cluster-1" } }}
        sendAiAgentMessage={jest.fn(() => Promise.resolve())}
        showErrorNotification={jest.fn()}
        showSuccessNotification={jest.fn()}
        tabId="tab-new-session"
        userPreferencesState={{ aiAgent: {} } as any}
      />,
    );

    await user.click(screen.getByRole("button", { name: /\+ new/i }));

    expect(store.initTab("tab-new-session").messages).toHaveLength(0);
    expect(screen.getByText("$ no transcript yet")).toBeInTheDocument();

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText("ask the cluster"));
    });
  });
});
