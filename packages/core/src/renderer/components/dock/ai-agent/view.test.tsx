/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "@testing-library/jest-dom";
import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { AiAgentTabStore } from "./store";
import { createMockStorage } from "./test-helpers";
import { NonInjectedAiAgentView } from "./view";

import type { UserEvent } from "@testing-library/user-event";

jest.mock("@freelensapp/icon", () => ({
  Icon: ({ material }: { material?: string }) => <span>{material}</span>,
}));

const createDockStore = (tabId: string) =>
  ({
    onTabChange: (callback: ({ tabId }: { tabId: string }) => void, options?: { fireImmediately?: boolean }) => {
      if (options?.fireImmediately) {
        callback({ tabId });
      }

      return () => {};
    },
  }) as any;

const originalSetSelectionRange = HTMLTextAreaElement.prototype.setSelectionRange;

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
      ipcRenderer: { invoke: jest.fn() } as any,
    });
    abortAiAgentMessage = jest.fn();
    Element.prototype.scrollIntoView = jest.fn();
    setSelectionRangeMock = jest.fn();
    HTMLTextAreaElement.prototype.setSelectionRange = function (
      start: number,
      end: number,
      direction?: "forward" | "backward" | "none",
    ) {
      setSelectionRangeMock(start, end, direction);

      return originalSetSelectionRange.call(this, start, end, direction);
    };
    uuidCount = 0;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        ...globalThis.crypto,
        randomUUID: jest.fn(() => `uuid-${++uuidCount}`),
      },
    });
    jest.spyOn(window, "focus").mockImplementation(() => {});
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);

      return 0;
    });
  });

  afterEach(() => {
    HTMLTextAreaElement.prototype.setSelectionRange = originalSetSelectionRange;
    jest.restoreAllMocks();
  });

  it("switches to read-write immediately from the header toggle", async () => {
    render(
      <NonInjectedAiAgentView
        abortAiAgentMessage={abortAiAgentMessage}
        aiAgentTabStore={store}
        dockStore={createDockStore("tab-1")}
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
        dockStore={createDockStore("tab-shift-tab")}
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
        dockStore={createDockStore("tab-2")}
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
        dockStore={createDockStore("tab-typing")}
        hostedCluster={{ id: "cluster-1", name: { get: () => "cluster-1" } }}
        sendAiAgentMessage={jest.fn(() => Promise.resolve())}
        showErrorNotification={jest.fn()}
        showSuccessNotification={jest.fn()}
        tabId="tab-typing"
        userPreferencesState={{ aiAgent: {} } as any}
      />,
    );

    expect(setSelectionRangeMock).toHaveBeenCalledWith(4, 4, undefined);
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
        dockStore={createDockStore("tab-fresh")}
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

  it("focuses the composer when a fresh session opens", async () => {
    render(
      <NonInjectedAiAgentView
        abortAiAgentMessage={abortAiAgentMessage}
        aiAgentTabStore={store}
        dockStore={createDockStore("tab-autofocus")}
        hostedCluster={{ id: "cluster-1", name: { get: () => "cluster-1" } }}
        sendAiAgentMessage={jest.fn(() => Promise.resolve())}
        showErrorNotification={jest.fn()}
        showSuccessNotification={jest.fn()}
        tabId="tab-autofocus"
        userPreferencesState={{ aiAgent: {} } as any}
      />,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText("ask the cluster"));
    });
  });

  it("keeps the textarea mouse down native so macOS typing can start after a click", () => {
    render(
      <NonInjectedAiAgentView
        abortAiAgentMessage={abortAiAgentMessage}
        aiAgentTabStore={store}
        dockStore={createDockStore("tab-native-click")}
        hostedCluster={{ id: "cluster-1", name: { get: () => "cluster-1" } }}
        sendAiAgentMessage={jest.fn(() => Promise.resolve())}
        showErrorNotification={jest.fn()}
        showSuccessNotification={jest.fn()}
        tabId="tab-native-click"
        userPreferencesState={{ aiAgent: {} } as any}
      />,
    );

    const textarea = screen.getByPlaceholderText("ask the cluster");
    const mouseDown = createEvent.mouseDown(textarea);

    fireEvent(textarea, mouseDown);

    expect(mouseDown.defaultPrevented).toBe(false);
  });

  it("moves DOM focus onto the textarea during mouse down", () => {
    render(
      <NonInjectedAiAgentView
        abortAiAgentMessage={abortAiAgentMessage}
        aiAgentTabStore={store}
        dockStore={createDockStore("tab-mousedown-focus")}
        hostedCluster={{ id: "cluster-1", name: { get: () => "cluster-1" } }}
        sendAiAgentMessage={jest.fn(() => Promise.resolve())}
        showErrorNotification={jest.fn()}
        showSuccessNotification={jest.fn()}
        tabId="tab-mousedown-focus"
        userPreferencesState={{ aiAgent: {} } as any}
      />,
    );

    const textarea = screen.getByPlaceholderText("ask the cluster");

    document.body.focus();
    fireEvent.mouseDown(textarea);

    expect(document.activeElement).toBe(textarea);
  });

  it("routes plain typing from the dock window back into the composer", () => {
    render(
      <div className="Dock">
        <button type="button" data-testid="dock-focus">
          dock focus
        </button>
        <NonInjectedAiAgentView
          abortAiAgentMessage={abortAiAgentMessage}
          aiAgentTabStore={store}
          dockStore={createDockStore("tab-window-keydown")}
          hostedCluster={{ id: "cluster-1", name: { get: () => "cluster-1" } }}
          sendAiAgentMessage={jest.fn(() => Promise.resolve())}
          showErrorNotification={jest.fn()}
          showSuccessNotification={jest.fn()}
          tabId="tab-window-keydown"
          userPreferencesState={{ aiAgent: {} } as any}
        />
      </div>,
    );

    const dockFocus = screen.getByTestId("dock-focus");

    dockFocus.focus();
    fireEvent.keyDown(dockFocus, { key: "d" });

    expect(document.activeElement).toBe(screen.getByPlaceholderText("ask the cluster"));
  });

  it("leaves textarea keydown to the native input path", () => {
    render(
      <div className="Dock">
        <NonInjectedAiAgentView
          abortAiAgentMessage={abortAiAgentMessage}
          aiAgentTabStore={store}
          dockStore={createDockStore("tab-textarea-keydown")}
          hostedCluster={{ id: "cluster-1", name: { get: () => "cluster-1" } }}
          sendAiAgentMessage={jest.fn(() => Promise.resolve())}
          showErrorNotification={jest.fn()}
          showSuccessNotification={jest.fn()}
          tabId="tab-textarea-keydown"
          userPreferencesState={{ aiAgent: {} } as any}
        />
      </div>,
    );

    const textarea = screen.getByPlaceholderText("ask the cluster");

    textarea.focus();
    fireEvent.keyDown(textarea, { key: "d" });

    expect(store.initTab("tab-textarea-keydown").inputDraft).toBe("");
  });

  it("returns focus to the composer after closing history", async () => {
    store.initTab("tab-history-focus");

    render(
      <NonInjectedAiAgentView
        abortAiAgentMessage={abortAiAgentMessage}
        aiAgentTabStore={store}
        dockStore={createDockStore("tab-history-focus")}
        hostedCluster={{ id: "cluster-1", name: { get: () => "cluster-1" } }}
        sendAiAgentMessage={jest.fn(() => Promise.resolve())}
        showErrorNotification={jest.fn()}
        showSuccessNotification={jest.fn()}
        tabId="tab-history-focus"
        userPreferencesState={{ aiAgent: {} } as any}
      />,
    );

    const composer = screen.getByPlaceholderText("ask the cluster");

    await user.click(screen.getByRole("button", { name: /history/i }));
    await user.click(screen.getAllByRole("button", { name: "Close session drawer" })[0]);

    await waitFor(() => {
      expect(document.activeElement).toBe(composer);
    });
  });

  it("creates a new session from the header action and returns focus to the composer", async () => {
    store.initTab("tab-new-session");
    store.appendUserMessage("tab-new-session", "why did node 008 fail again?");

    render(
      <NonInjectedAiAgentView
        abortAiAgentMessage={abortAiAgentMessage}
        aiAgentTabStore={store}
        dockStore={createDockStore("tab-new-session")}
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
