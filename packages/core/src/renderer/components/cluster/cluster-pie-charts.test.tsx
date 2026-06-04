/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import { computed, observable } from "mobx";
import React from "react";
import { getDiForUnitTesting } from "../../getDiForUnitTesting";
import activeThemeInjectable from "../../themes/active.injectable";
import { renderFor } from "../test-utils/renderFor";
import { GPU_RESOURCE_KEY } from "../nodes/gpu-capacity";
import clusterOverviewMetricsInjectable from "./cluster-metrics.injectable";
import { ClusterPieCharts, NonInjectedClusterPieCharts } from "./cluster-pie-charts";
import selectedMetricsTimeRangeInjectable from "./overview/selected-metrics-time-range.injectable";
import selectedNodeRoleForMetricsInjectable from "./overview/selected-node-role-for-metrics.injectable";

import type { Node } from "@freelensapp/kube-object";

import type { MetricData } from "../../../common/k8s-api/endpoints/metrics.api";
import type { ClusterMetricData } from "../../../common/k8s-api/endpoints/metrics.api/request-cluster-metrics-by-node-names.injectable";

jest.mock("../chart", () => ({
  PieChart: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div>
      {title}
      {children}
    </div>
  ),
}));

jest.mock("@freelensapp/spinner", () => ({
  Spinner: () => <div data-testid="spinner" />,
}));

function metricWithValue(value: string): MetricData {
  return {
    status: "",
    data: {
      resultType: "",
      result: [
        {
          metric: {},
          values: [[1, value]],
        },
      ],
    },
  };
}

const createMetric = (value: number): MetricData => ({
  status: "success",
  data: {
    resultType: "matrix",
    result: [
      {
        metric: {},
        values: [[1, String(value)]],
      },
    ],
  },
});

describe("ClusterPieCharts", () => {
  it("does not render stale pie charts on first mount while a reused singleton is pending", () => {
    const di = getDiForUnitTesting();
    const render = renderFor(di);

    di.override(activeThemeInjectable, () =>
      computed(
        () =>
          ({
            colors: {
              pieChartDefaultColor: "#123456",
            },
          }) as never,
      ),
    );
    di.override(
      selectedMetricsTimeRangeInjectable,
      () =>
        ({
          value: computed(() => ({ duration: null, customStart: 300, customEnd: 400 })),
        }) as never,
    );
    di.override(
      clusterOverviewMetricsInjectable,
      () =>
        ({
          pending: computed(() => true),
          value: computed(() => ({
            cpuUsage: metricWithValue("1"),
            cpuRequests: metricWithValue("2"),
            cpuAllocatableCapacity: metricWithValue("3"),
            cpuCapacity: metricWithValue("4"),
            memoryUsage: metricWithValue("5"),
            memoryRequests: metricWithValue("6"),
            memoryAllocatableCapacity: metricWithValue("7"),
            memoryCapacity: metricWithValue("8"),
            podUsage: metricWithValue("9"),
            podAllocatableCapacity: metricWithValue("10"),
            podCapacity: metricWithValue("11"),
          })),
        }) as never,
    );
    di.override(selectedNodeRoleForMetricsInjectable, () => ({
      value: computed(() => "worker" as const),
      set: jest.fn(),
      nodes: computed(() => [{ getName: () => "worker-1" }] as never),
      hasMasterNodes: computed(() => true),
      hasWorkerNodes: computed(() => true),
    }));

    render(<ClusterPieCharts />);

    expect(screen.queryByText("CPU")).not.toBeInTheDocument();
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
  });

  it("does not keep rendering stale values during a pending range transition", () => {
    const di = getDiForUnitTesting();
    const render = renderFor(di);
    const timeRange = observable.box({ duration: null, customStart: 100, customEnd: 200 });
    const pending = observable.box(false);
    const metricsValue = observable.box({
      cpuUsage: metricWithValue("1"),
      cpuRequests: metricWithValue("2"),
      cpuAllocatableCapacity: metricWithValue("3"),
      cpuCapacity: metricWithValue("4"),
      memoryUsage: metricWithValue("5"),
      memoryRequests: metricWithValue("6"),
      memoryAllocatableCapacity: metricWithValue("7"),
      memoryCapacity: metricWithValue("8"),
      podUsage: metricWithValue("9"),
      podAllocatableCapacity: metricWithValue("10"),
      podCapacity: metricWithValue("11"),
    });

    di.override(activeThemeInjectable, () =>
      computed(
        () =>
          ({
            colors: {
              pieChartDefaultColor: "#123456",
            },
          }) as never,
      ),
    );
    di.override(
      selectedMetricsTimeRangeInjectable,
      () =>
        ({
          value: computed(() => timeRange.get()),
        }) as never,
    );
    di.override(
      clusterOverviewMetricsInjectable,
      () =>
        ({
          pending: computed(() => pending.get()),
          value: computed(() => metricsValue.get()),
        }) as never,
    );
    di.override(selectedNodeRoleForMetricsInjectable, () => ({
      value: computed(() => "worker" as const),
      set: jest.fn(),
      nodes: computed(() => [{ getName: () => "worker-1" }] as never),
      hasMasterNodes: computed(() => true),
      hasWorkerNodes: computed(() => true),
    }));

    render(<ClusterPieCharts />);

    expect(screen.getAllByText("CPU")).toHaveLength(1);

    act(() => {
      pending.set(true);
      timeRange.set({ duration: null, customStart: 300, customEnd: 400 });
    });

    expect(screen.queryByText("CPU")).not.toBeInTheDocument();
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
  });

  it("renders gpu data when cluster gpu metrics are missing", () => {
    const node = {
      getConditions: () => [{ type: "Ready", status: "True" }],
      getName: () => "gpu-node-1",
      isUnschedulable: () => false,
      status: {
        allocatable: {
          [GPU_RESOURCE_KEY]: "8",
        },
      },
    } as unknown as Node;
    const clusterMetrics = {
      memoryUsage: createMetric(4),
      memoryRequests: createMetric(3),
      memoryLimits: createMetric(5),
      memoryCapacity: createMetric(10),
      memoryAllocatableCapacity: createMetric(8),
      cpuUsage: createMetric(2),
      cpuRequests: createMetric(1),
      cpuLimits: createMetric(3),
      cpuCapacity: createMetric(4),
      cpuAllocatableCapacity: createMetric(4),
      podUsage: createMetric(20),
      podCapacity: createMetric(100),
      podAllocatableCapacity: createMetric(80),
      fsSize: createMetric(100),
      fsUsage: createMetric(40),
      gpuCapacity: undefined,
      gpuAllocatableCapacity: undefined,
      gpuRequests: undefined,
    } as unknown as ClusterMetricData;

    render(
      <NonInjectedClusterPieCharts
        allNodeMetrics={{ value: { get: () => undefined } } as any}
        selectedNodeRoleForMetrics={{ nodes: { get: () => [node] } } as any}
        clusterOverviewMetrics={{
          pending: { get: () => false },
          value: { get: () => clusterMetrics },
        } as any}
        activeTheme={{ get: () => ({ colors: { pieChartDefaultColor: "#1f1f1f" } }) } as any}
        selectedMetricsTimeRange={{
          value: { get: () => ({ duration: null, customStart: 100, customEnd: 200 }) },
        } as any}
        podStore={{ items: [] } as any}
      />,
    );

    expect(screen.getByText("GPU")).toBeInTheDocument();
    expect(screen.getByText("Free nodes: 1")).toBeInTheDocument();
  });
});
