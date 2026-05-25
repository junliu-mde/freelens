/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "@testing-library/jest-dom";
import { act, render, waitFor } from "@testing-library/react";
import { observable } from "mobx";
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

  it("keeps gpu pod data on all namespaces instead of the selected namespace set", async () => {
    const allNamespaces = observable.array(["gpu-a", "gpu-b"]);
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
    const subscribeStores = jest.fn((stores: unknown[], opts?: { namespaces?: string[] }) => {
      if (stores.includes(podStore)) {
        void podStore.loadAll({ namespaces: opts?.namespaces });
      }

      return jest.fn();
    });

    render(
      <NonInjectedClusterOverview
        clusterFrameContext={{
          get allNamespaces() {
            return allNamespaces.slice();
          },
          get contextNamespaces() {
            return ["gpu-a"];
          },
          get hasSelectedAll() {
            return false;
          },
          isGlobalWatchEnabled: () => true,
          isLoadingAll: () => false,
        }}
        subscribeStores={subscribeStores}
        podStore={podStore}
        eventStore={eventStore}
        nodeStore={nodeStore}
        clusterMetricsAreVisible={{ get: () => false } as any}
        uiBlocks={{ get: () => [] } as any}
        clusterOverviewMetrics={{ value: { get: () => undefined } } as any}
      />,
    );

    await waitFor(() => {
      expect(subscribeStores).toHaveBeenCalledWith([podStore], { namespaces: ["gpu-a", "gpu-b"] });
    });

    await waitFor(() => {
      expect(podStore.loadAll).toHaveBeenCalledWith({ namespaces: ["gpu-a", "gpu-b"] });
    });

    act(() => {
      allNamespaces.replace(["gpu-a", "gpu-b", "gpu-c"]);
    });

    await waitFor(() => {
      expect(subscribeStores).toHaveBeenCalledWith([podStore], { namespaces: ["gpu-a", "gpu-b", "gpu-c"] });
    });

    await waitFor(() => {
      expect(podStore.loadAll).toHaveBeenCalledWith({ namespaces: ["gpu-a", "gpu-b", "gpu-c"] });
    });
  });
});
