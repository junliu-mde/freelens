/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { asyncComputed } from "@ogre-tools/injectable-react";
import { now } from "mobx-utils";
import requestAllNodeMetricsInjectable from "../../../common/k8s-api/endpoints/metrics.api/request-metrics-for-all-nodes.injectable";

import type { NodeMetricData } from "../../../common/k8s-api/endpoints/metrics.api/request-metrics-for-all-nodes.injectable";

const everyMinute = 60 * 1000;

// Driven by the same mobx `now(everyMinute)` clock as `clusterOverviewMetricsInjectable`. mobx-utils
// `now` is backed by a single shared global ticker per interval, so every `now(60000)` observer is
// updated on the same tick boundary. Routing the GPU node-metrics fetch through this clock (instead
// of a component-local setInterval) phase-locks it with the cluster metrics, so the GPU pie chart no
// longer renders fresh node metrics against a stale cluster-metrics snapshot.
const allNodeMetricsInjectable = getInjectable({
  id: "all-node-metrics",
  instantiate: (di) => {
    const requestAllNodeMetrics = di.inject(requestAllNodeMetricsInjectable);

    return asyncComputed<NodeMetricData | undefined>({
      getValueFromObservedPromise: async () => {
        now(everyMinute);

        return requestAllNodeMetrics().catch(() => undefined);
      },
      betweenUpdates: "show-latest-value",
    });
  },
});

export default allNodeMetricsInjectable;
