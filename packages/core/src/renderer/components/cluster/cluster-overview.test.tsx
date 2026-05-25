/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "@testing-library/jest-dom";
import { act, render, waitFor } from "@testing-library/react";
import React from "react";
import { NonInjectedClusterOverview } from "./cluster-overview";

jest.mock("./cluster-issues", () => ({
  ClusterIssues: ({ className }: { className?: string }) => <div className={className}>cluster issues</div>,
}));

jest.mock("../layout/tab-layout", () => ({
  TabLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("<ClusterOverview />", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("subscribes to pod, event, and node stores together", () => {
    const podStore = {
      isLoaded: true,
      loadAll: jest.fn(() => Promise.resolve()),
    } as any;
    const nodeStore = {
      isLoaded: true,
      loadAll: jest.fn(() => Promise.resolve()),
    } as any;
    const eventStore = {
      isLoaded: true,
    } as any;
    const subscribeStores = jest.fn(() => jest.fn());

    render(
      <NonInjectedClusterOverview
        subscribeStores={subscribeStores}
        podStore={podStore}
        eventStore={eventStore}
        nodeStore={nodeStore}
        clusterMetricsAreVisible={{ get: () => false } as any}
        uiBlocks={{ get: () => [] } as any}
      />,
    );

    expect(subscribeStores).toHaveBeenCalledWith([podStore, eventStore, nodeStore]);
  });

  it("refreshes gpu sources (node and pod stores) on the interval", async () => {
    const podStore = {
      isLoaded: true,
      loadAll: jest.fn(() => Promise.resolve()),
    } as any;
    const nodeStore = {
      isLoaded: true,
      loadAll: jest.fn(() => Promise.resolve()),
    } as any;
    const eventStore = {
      isLoaded: true,
    } as any;
    const subscribeStores = jest.fn(() => jest.fn());

    render(
      <NonInjectedClusterOverview
        subscribeStores={subscribeStores}
        podStore={podStore}
        eventStore={eventStore}
        nodeStore={nodeStore}
        clusterMetricsAreVisible={{ get: () => false } as any}
        uiBlocks={{ get: () => [] } as any}
      />,
    );

    // Initial refresh fires on mount (start(true)).
    await waitFor(() => {
      expect(nodeStore.loadAll).toHaveBeenCalledWith({});
      expect(podStore.loadAll).toHaveBeenCalledWith({});
    });

    nodeStore.loadAll.mockClear();
    podStore.loadAll.mockClear();

    // Next 60s tick triggers another refresh.
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    await waitFor(() => {
      expect(nodeStore.loadAll).toHaveBeenCalledWith({});
      expect(podStore.loadAll).toHaveBeenCalledWith({});
    });
  });
});
