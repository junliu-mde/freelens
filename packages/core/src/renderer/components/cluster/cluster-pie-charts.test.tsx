/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";
import { GPU_RESOURCE_KEY } from "../nodes/gpu-capacity";
import { NonInjectedClusterPieCharts } from "./cluster-pie-charts";

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

describe("<ClusterPieCharts />", () => {
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
        requestAllNodeMetrics={jest.fn().mockResolvedValue(undefined)}
        selectedNodeRoleForMetrics={{ nodes: { get: () => [node] } } as any}
        clusterOverviewMetrics={{ value: { get: () => clusterMetrics } } as any}
        activeTheme={{ get: () => ({ colors: { pieChartDefaultColor: "#1f1f1f" } }) } as any}
        podStore={{ items: [] } as any}
      />,
    );

    expect(screen.getByText("GPU")).toBeInTheDocument();
    expect(screen.getByText("Free nodes: 1")).toBeInTheDocument();
  });
});
