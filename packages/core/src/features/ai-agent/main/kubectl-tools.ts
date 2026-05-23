/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Type } from "@earendil-works/pi-ai";

import type { Tool } from "@earendil-works/pi-ai";

export const kubectlAiAgentTools: Tool[] = [
  {
    name: "kubectl_get",
    description:
      "Run a read-only kubectl get command against the active Freelens cluster. Use this to inspect Kubernetes resources while debugging.",
    parameters: Type.Object({
      resource: Type.String({ description: "Resource type, for example pods, deployments, services, nodes, events" }),
      namespace: Type.Optional(
        Type.String({ description: "Namespace. Omit for cluster-scoped resources or all namespaces." }),
      ),
      name: Type.Optional(Type.String({ description: "Specific resource name" })),
      output: Type.Optional(
        Type.Union([Type.Literal("wide"), Type.Literal("yaml"), Type.Literal("json")], {
          description: "Output format",
        }),
      ),
      selector: Type.Optional(Type.String({ description: "Label selector, for example app=nginx" })),
      allNamespaces: Type.Optional(Type.Boolean({ description: "Use --all-namespaces" })),
    }),
  },
  {
    name: "kubectl_describe",
    description: "Run kubectl describe for a Kubernetes resource in the active Freelens cluster.",
    parameters: Type.Object({
      resource: Type.String({ description: "Resource type, for example pod, deployment, service, node" }),
      name: Type.String({ description: "Resource name" }),
      namespace: Type.Optional(Type.String({ description: "Namespace. Omit for cluster-scoped resources." })),
    }),
  },
  {
    name: "kubectl_logs",
    description: "Fetch pod logs from the active Freelens cluster. This is read-only and limited to recent lines.",
    parameters: Type.Object({
      pod: Type.String({ description: "Pod name" }),
      namespace: Type.Optional(Type.String({ description: "Pod namespace" })),
      container: Type.Optional(Type.String({ description: "Container name" })),
      tailLines: Type.Optional(Type.Number({ description: "Number of log lines to return, max 500" })),
      previous: Type.Optional(Type.Boolean({ description: "Read previous crashed container logs" })),
    }),
  },
  {
    name: "kubectl_top",
    description: "Run kubectl top for read-only resource usage in the active Freelens cluster.",
    parameters: Type.Object({
      resource: Type.Union([Type.Literal("pods"), Type.Literal("nodes")], { description: "Resource type" }),
      namespace: Type.Optional(Type.String({ description: "Namespace for pods" })),
      allNamespaces: Type.Optional(Type.Boolean({ description: "Use --all-namespaces for pods" })),
    }),
  },
];
