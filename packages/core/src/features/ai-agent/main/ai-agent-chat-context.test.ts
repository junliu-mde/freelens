/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observable } from "mobx";
import { Cluster } from "../../../common/cluster/cluster";
import { ClusterMetadataKey } from "../../../common/cluster-types";
import {
  createAiAgentSystemPrompt,
  formatAiAgentClusterContext,
  resolveAiAgentClusterContext,
} from "./ai-agent-chat-context";

describe("ai-agent cluster context", () => {
  it("formats kubeconfig context and display name for the system prompt", () => {
    const cluster = new Cluster({
      id: "cluster-uuid",
      kubeConfigPath: "/tmp/kubeconfig",
      contextName: "hpc-3",
      preferences: {
        clusterName: "admin@hpc-3",
      },
    });

    expect(formatAiAgentClusterContext(resolveAiAgentClusterContext("cluster-uuid", () => cluster))).toBe(
      'Active Kubernetes cluster: display name "admin@hpc-3", kubeconfig context "hpc-3", internal cluster ID cluster-uuid.',
    );
  });

  it("includes distribution and version when known", () => {
    const cluster = new Cluster({
      id: "cluster-uuid",
      kubeConfigPath: "/tmp/kubeconfig",
      contextName: "hpc-3",
    });

    cluster.updateModel({
      kubeConfigPath: "/tmp/kubeconfig",
      contextName: "hpc-3",
      metadata: {
        [ClusterMetadataKey.VERSION]: "1.29.0",
        [ClusterMetadataKey.DISTRIBUTION]: "eks",
      },
    });

    expect(formatAiAgentClusterContext(resolveAiAgentClusterContext("cluster-uuid", () => cluster))).toBe(
      'Active Kubernetes cluster: display name "hpc-3", kubeconfig context "hpc-3", distribution eks, version 1.29.0, internal cluster ID cluster-uuid.',
    );
  });

  it("injects kubectx details into the system prompt", () => {
    const cluster = observable(
      new Cluster({
        id: "cluster-uuid",
        kubeConfigPath: "/tmp/kubeconfig",
        contextName: "hpc-3",
        preferences: {
          clusterName: "admin@hpc-3",
        },
      }),
    );

    const prompt = createAiAgentSystemPrompt(
      resolveAiAgentClusterContext("cluster-uuid", () => cluster),
      "read-only",
    );

    expect(prompt).toContain('kubeconfig context "hpc-3"');
    expect(prompt).toContain('display name "admin@hpc-3"');
  });
});
