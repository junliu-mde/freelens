/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Type } from "@earendil-works/pi-ai";

import type { Tool, ToolCall } from "@earendil-works/pi-ai";

export type AiAgentKubectlToolName =
  | "kubectl_get"
  | "kubectl_describe"
  | "kubectl_logs"
  | "kubectl_top"
  | "kubectl_apply"
  | "kubectl_delete"
  | "kubectl_scale"
  | "kubectl_rollout_restart";

export interface AiAgentKubectlInvocation {
  args: string[];
  stdin?: string;
}

export interface AiAgentKubectlToolDefinition {
  tool: Tool;
  isWrite: boolean;
  buildInvocation: (toolCall: ToolCall) => AiAgentKubectlInvocation;
}

const allowedResourcePattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*(?:\/[a-z][a-z0-9.-]*)?$/i;
const dangerousManifestPatterns = [
  /cluster-admin/,
  /privileged:\s*true/,
  /hostPath:/,
  /hostPID:\s*true/,
  /hostNetwork:\s*true/,
  /hostIPC:\s*true/,
];

const stringifyArg = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const booleanArg = (value: unknown): boolean => value === true;

const numberArg = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const clampTailLines = (value: unknown) => Math.max(1, Math.min(500, Math.floor(numberArg(value) ?? 100)));

const validateSafeResource = (resource: string) => {
  if (!allowedResourcePattern.test(resource)) {
    throw new Error(`Unsafe resource name: ${resource}`);
  }
};

const validateSafeManifest = (manifest: string) => {
  for (const pattern of dangerousManifestPatterns) {
    if (pattern.test(manifest)) {
      throw new Error(
        `Manifest contains potentially dangerous pattern (${pattern.source}). ` +
          `Apply with explicit confirmation is required for privileged workloads.`,
      );
    }
  }
};

const addNamespaceArgs = (args: string[], namespace?: string, allNamespaces?: boolean) => {
  if (allNamespaces) {
    args.push("--all-namespaces");
  } else if (namespace) {
    args.push("--namespace", namespace);
  }
};

const toolDefinitions: Record<AiAgentKubectlToolName, AiAgentKubectlToolDefinition> = {
  kubectl_get: {
    isWrite: false,
    tool: {
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
    buildInvocation: (toolCall) => {
      const args = toolCall.arguments;
      const resource = stringifyArg(args.resource);

      if (!resource) {
        throw new Error("resource is required");
      }

      validateSafeResource(resource);

      const result = ["get", resource];
      const name = stringifyArg(args.name);

      if (name) {
        result.push(name);
      }

      addNamespaceArgs(result, stringifyArg(args.namespace), booleanArg(args.allNamespaces));

      const selector = stringifyArg(args.selector);

      if (selector) {
        result.push("--selector", selector);
      }

      const output = stringifyArg(args.output);

      if (output === "wide") {
        result.push("--output", "wide");
      } else if (output === "yaml" || output === "json") {
        result.push("--output", output);
      }

      return { args: result };
    },
  },

  kubectl_describe: {
    isWrite: false,
    tool: {
      name: "kubectl_describe",
      description: "Run kubectl describe for a Kubernetes resource in the active Freelens cluster.",
      parameters: Type.Object({
        resource: Type.String({ description: "Resource type, for example pod, deployment, service, node" }),
        name: Type.String({ description: "Resource name" }),
        namespace: Type.Optional(Type.String({ description: "Namespace. Omit for cluster-scoped resources." })),
      }),
    },
    buildInvocation: (toolCall) => {
      const args = toolCall.arguments;
      const resource = stringifyArg(args.resource);
      const name = stringifyArg(args.name);

      if (!resource || !name) {
        throw new Error("resource and name are required");
      }

      validateSafeResource(resource);

      const result = ["describe", resource, name];

      addNamespaceArgs(result, stringifyArg(args.namespace));

      return { args: result };
    },
  },

  kubectl_logs: {
    isWrite: false,
    tool: {
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
    buildInvocation: (toolCall) => {
      const args = toolCall.arguments;
      const pod = stringifyArg(args.pod);

      if (!pod) {
        throw new Error("pod is required");
      }

      const result = ["logs", pod, "--tail", String(clampTailLines(args.tailLines))];

      addNamespaceArgs(result, stringifyArg(args.namespace));

      const container = stringifyArg(args.container);

      if (container) {
        result.push("--container", container);
      }

      if (booleanArg(args.previous)) {
        result.push("--previous");
      }

      return { args: result };
    },
  },

  kubectl_top: {
    isWrite: false,
    tool: {
      name: "kubectl_top",
      description: "Run kubectl top for read-only resource usage in the active Freelens cluster.",
      parameters: Type.Object({
        resource: Type.Union([Type.Literal("pods"), Type.Literal("nodes")], { description: "Resource type" }),
        namespace: Type.Optional(Type.String({ description: "Namespace for pods" })),
        allNamespaces: Type.Optional(Type.Boolean({ description: "Use --all-namespaces for pods" })),
      }),
    },
    buildInvocation: (toolCall) => {
      const args = toolCall.arguments;
      const resource = stringifyArg(args.resource);

      if (resource !== "pods" && resource !== "nodes") {
        throw new Error("resource must be pods or nodes");
      }

      const result = ["top", resource];

      if (resource === "pods") {
        addNamespaceArgs(result, stringifyArg(args.namespace), booleanArg(args.allNamespaces));
      }

      return { args: result };
    },
  },

  kubectl_apply: {
    isWrite: true,
    tool: {
      name: "kubectl_apply",
      description:
        "Apply a Kubernetes manifest from a string (YAML or JSON) against the active Freelens cluster. Use this to create or update resources. Always dry-run first unless the user explicitly confirms.",
      parameters: Type.Object({
        manifest: Type.String({ description: "Kubernetes manifest content in YAML or JSON format" }),
        namespace: Type.Optional(Type.String({ description: "Namespace to apply into" })),
        dryRun: Type.Optional(
          Type.Boolean({ description: "Use --dry-run=client to validate without applying. Default true." }),
        ),
      }),
    },
    buildInvocation: (toolCall) => {
      const args = toolCall.arguments;
      const manifest = stringifyArg(args.manifest);

      if (!manifest) {
        throw new Error("manifest is required");
      }

      validateSafeManifest(manifest);

      const result = ["apply", "--filename", "-"];

      addNamespaceArgs(result, stringifyArg(args.namespace));

      if (booleanArg(args.dryRun)) {
        result.push("--dry-run=client");
      }

      return { args: result, stdin: manifest };
    },
  },

  kubectl_delete: {
    isWrite: true,
    tool: {
      name: "kubectl_delete",
      description:
        "Delete a Kubernetes resource from the active Freelens cluster. Use with extreme caution. Always confirm with the user before deleting.",
      parameters: Type.Object({
        resource: Type.String({ description: "Resource type, for example pod, deployment, service" }),
        name: Type.String({ description: "Resource name" }),
        namespace: Type.Optional(Type.String({ description: "Namespace. Omit for cluster-scoped resources." })),
      }),
    },
    buildInvocation: (toolCall) => {
      const args = toolCall.arguments;
      const resource = stringifyArg(args.resource);
      const name = stringifyArg(args.name);

      if (!resource || !name) {
        throw new Error("resource and name are required");
      }

      validateSafeResource(resource);

      const result = ["delete", resource, name];

      addNamespaceArgs(result, stringifyArg(args.namespace));

      return { args: result };
    },
  },

  kubectl_scale: {
    isWrite: true,
    tool: {
      name: "kubectl_scale",
      description:
        "Scale a deployment or replicaset in the active Freelens cluster. Confirm with the user before scaling.",
      parameters: Type.Object({
        resource: Type.String({ description: "Resource type, typically deployment or replicaset" }),
        name: Type.String({ description: "Resource name" }),
        replicas: Type.Number({ description: "Target number of replicas" }),
        namespace: Type.Optional(Type.String({ description: "Namespace" })),
      }),
    },
    buildInvocation: (toolCall) => {
      const args = toolCall.arguments;
      const resource = stringifyArg(args.resource);
      const name = stringifyArg(args.name);
      const replicas = numberArg(args.replicas);

      if (!resource || !name || replicas === undefined) {
        throw new Error("resource, name, and replicas are required");
      }

      validateSafeResource(resource);

      const result = ["scale", resource, name, "--replicas", String(replicas)];

      addNamespaceArgs(result, stringifyArg(args.namespace));

      return { args: result };
    },
  },

  kubectl_rollout_restart: {
    isWrite: true,
    tool: {
      name: "kubectl_rollout_restart",
      description:
        "Restart a deployment or daemonset by triggering a rolling restart in the active Freelens cluster. Confirm with the user before restarting.",
      parameters: Type.Object({
        resource: Type.String({ description: "Resource type, typically deployment or daemonset" }),
        name: Type.String({ description: "Resource name" }),
        namespace: Type.Optional(Type.String({ description: "Namespace" })),
      }),
    },
    buildInvocation: (toolCall) => {
      const args = toolCall.arguments;
      const resource = stringifyArg(args.resource);
      const name = stringifyArg(args.name);

      if (!resource || !name) {
        throw new Error("resource and name are required");
      }

      validateSafeResource(resource);

      const result = ["rollout", "restart", resource, name];

      addNamespaceArgs(result, stringifyArg(args.namespace));

      return { args: result };
    },
  },
};

export const kubectlAiAgentTools = Object.values(toolDefinitions)
  .filter((definition) => !definition.isWrite)
  .map((definition) => definition.tool);

export const kubectlAiAgentWriteTools = Object.values(toolDefinitions)
  .filter((definition) => definition.isWrite)
  .map((definition) => definition.tool);

export const getAiAgentKubectlToolDefinition = (toolName: string) => {
  const definition = toolDefinitions[toolName as AiAgentKubectlToolName];

  if (!definition) {
    throw new Error(`Unsupported tool: ${toolName}`);
  }

  return definition;
};
