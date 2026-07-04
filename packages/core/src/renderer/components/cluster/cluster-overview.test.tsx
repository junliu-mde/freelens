/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "@testing-library/jest-dom";
import { act, waitFor } from "@testing-library/react";
import { computed } from "mobx";
import React from "react";
import { getDiForUnitTesting } from "../../getDiForUnitTesting";
import { renderFor } from "../test-utils/renderFor";
import enabledMetricsInjectable from "../../api/catalog/entity/metrics-enabled.injectable";
import { computedInjectManyInjectable } from "@ogre-tools/injectable-extension-for-mobx";
import subscribeStoresInjectable from "../../kube-watch-api/subscribe-stores.injectable";
import eventStoreInjectable from "../events/store.injectable";
import nodeStoreInjectable from "../nodes/store.injectable";
import podStoreInjectable from "../workloads-pods/store.injectable";
import { ClusterOverview } from "./cluster-overview";

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

  it("subscribes to pod, event, and node stores together on mount", () => {
    const di = getDiForUnitTesting();
    const render = renderFor(di);

    const subscribeStores = jest.fn(() => jest.fn());
    const podStore = { isLoaded: true, loadAll: jest.fn(() => Promise.resolve()) } as any;
    const nodeStore = { isLoaded: true, loadAll: jest.fn(() => Promise.resolve()) } as any;
    const eventStore = { isLoaded: true } as any;

    di.override(subscribeStoresInjectable, () => subscribeStores);
    di.override(podStoreInjectable, () => podStore);
    di.override(nodeStoreInjectable, () => nodeStore);
    di.override(eventStoreInjectable, () => eventStore);
    di.override(enabledMetricsInjectable, () => computed(() => false));
    di.override(computedInjectManyInjectable, () => () => computed(() => []) as never);

    render(<ClusterOverview />);

    expect(subscribeStores).toHaveBeenCalledWith([podStore, eventStore, nodeStore]);
  });

  it("refreshes gpu sources (node and pod stores) on the interval", async () => {
    const di = getDiForUnitTesting();
    const render = renderFor(di);

    const subscribeStores = jest.fn(() => jest.fn());
    const podStore = {
      isLoaded: true,
      loadAll: jest.fn(() => Promise.resolve()),
    } as any;
    const nodeStore = {
      isLoaded: true,
      loadAll: jest.fn(() => Promise.resolve()),
    } as any;
    const eventStore = { isLoaded: true } as any;

    di.override(subscribeStoresInjectable, () => subscribeStores);
    di.override(podStoreInjectable, () => podStore);
    di.override(nodeStoreInjectable, () => nodeStore);
    di.override(eventStoreInjectable, () => eventStore);
    di.override(enabledMetricsInjectable, () => computed(() => false));
    di.override(computedInjectManyInjectable, () => () => computed(() => []) as never);

    render(<ClusterOverview />);

    // Initial refresh fires on mount (interval.start(true)).
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
