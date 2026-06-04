/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { podListLayoutColumnInjectionToken } from "@freelensapp/list-layout";
import { getInjectable } from "@ogre-tools/injectable";
import React from "react";
import { getPodGpuRequests } from "../../nodes/gpu-capacity";
import { COLUMN_PRIORITY } from "./column-priority";

import type { Pod } from "@freelensapp/kube-object";

const columnId = "gpuRequests";

export const podsGpuColumnInjectable = getInjectable({
  id: "pods-gpu-column",
  instantiate: () => ({
    id: columnId,
    kind: "Pod",
    apiVersion: "v1",
    priority: COLUMN_PRIORITY.GPU,
    content: (pod: Pod) => {
      const total = getPodGpuRequests(pod);

      return <span>{total > 0 ? total : "-"}</span>;
    },
    header: { title: "GPU", className: "gpu", sortBy: columnId, id: columnId },
    sortingCallBack: (pod: Pod) => getPodGpuRequests(pod),
  }),
  injectionToken: podListLayoutColumnInjectionToken,
});
