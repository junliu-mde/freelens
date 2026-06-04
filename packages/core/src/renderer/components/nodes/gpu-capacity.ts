/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { Node, Pod } from "@freelensapp/kube-object";

export const GPU_RESOURCE_KEY = "nvidia.com/gpu";

// Parse a Kubernetes GPU quantity. Returns undefined only when the value is absent or unparseable;
// an explicit "0" is preserved so a node that advertises GPUs which are all currently unavailable
// is not mistaken for "no value" and silently falls back to a different (stale) source.
const parseGpuQuantity = (value: string | undefined) => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
};

export const isNodeReady = (node: Pick<Node, "getConditions">) =>
  node.getConditions().some((condition) => condition.type === "Ready" && condition.status === "True");

// The node's allocatable GPU count (what the scheduler can actually place workloads on).
export const getNodeGpuAllocatableCapacity = (node: Pick<Node, "getConditions" | "status">) => {
  if (!isNodeReady(node)) {
    return undefined;
  }

  return parseGpuQuantity(node.status?.allocatable?.[GPU_RESOURCE_KEY]);
};

// The node's total GPU count from its capacity (may exceed allocatable when some GPUs are unhealthy).
export const getNodeGpuTotalCapacity = (node: Pick<Node, "getConditions" | "status">) => {
  if (!isNodeReady(node)) {
    return undefined;
  }

  return parseGpuQuantity(node.status?.capacity?.[GPU_RESOURCE_KEY]);
};

export const getNodeGpuCapacity = (node: Pick<Node, "getConditions" | "status">) =>
  getNodeGpuAllocatableCapacity(node) ?? getNodeGpuTotalCapacity(node);

export const canScheduleGpuWorkloadsOnNode = (node: Pick<Node, "getConditions" | "isUnschedulable" | "status">) => {
  const capacity = getNodeGpuCapacity(node);

  return !node.isUnschedulable() && capacity !== undefined && capacity > 0;
};

// Sum the GPU requests across a pod's containers. Shared by the node list, pod list, and cluster
// overview so the GPU resource key and the request-summation rule live in exactly one place.
export const getPodGpuRequests = (pod: Pick<Pod, "getContainers">): number => {
  let total = 0;

  for (const container of pod.getContainers()) {
    const gpuRequest = container.resources?.requests?.[GPU_RESOURCE_KEY];

    if (gpuRequest) {
      total += parseInt(gpuRequest, 10) || 0;
    }
  }

  return total;
};

// Total GPU requests of running pods, grouped by node name.
export const computeGpuAllocatedByNode = (pods: Pod[]): Map<string, number> => {
  const result = new Map<string, number>();

  for (const pod of pods) {
    if (pod.getStatusPhase() !== "Running") {
      continue;
    }

    const nodeName = pod.getNodeName();

    if (!nodeName) {
      continue;
    }

    const requests = getPodGpuRequests(pod);

    if (requests > 0) {
      result.set(nodeName, (result.get(nodeName) ?? 0) + requests);
    }
  }

  return result;
};
