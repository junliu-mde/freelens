/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import execFileInjectable from "../../../common/fs/exec-file.injectable";
import getClusterByIdInjectable from "../../cluster/storage/common/get-by-id.injectable";
import kubeconfigManagerInjectable from "../../../main/kubeconfig-manager/kubeconfig-manager.injectable";
import bundledKubectlInjectable from "../../../main/kubectl/bundled-kubectl.injectable";

import type { ToolCall } from "@earendil-works/pi-ai";
import type { ClusterId } from "../../../common/cluster-types";
import type { ExecFile } from "../../../common/fs/exec-file.injectable";
import type { GetClusterById } from "../../cluster/storage/common/get-by-id.injectable";
import type { Kubectl } from "../../../main/kubectl/kubectl";
import type { DiContainerForInjection } from "@ogre-tools/injectable";

export interface AiAgentToolExecutionResult {
  content: string;
  isError: boolean;
}

export type ExecuteAiAgentKubectlTool = (
  clusterId: ClusterId | undefined,
  toolCall: ToolCall,
) => Promise<AiAgentToolExecutionResult>;

const maxOutputLength = 16_000;
const allowedResourcePattern = /^[a-z0-9./-]+$/i;

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

const addNamespaceArgs = (args: string[], namespace?: string, allNamespaces?: boolean) => {
  if (allNamespaces) {
    args.push("--all-namespaces");
  } else if (namespace) {
    args.push("--namespace", namespace);
  }
};

const buildKubectlArgs = (toolCall: ToolCall): string[] => {
  const args = toolCall.arguments;

  switch (toolCall.name) {
    case "kubectl_get": {
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

      return result;
    }

    case "kubectl_describe": {
      const resource = stringifyArg(args.resource);
      const name = stringifyArg(args.name);

      if (!resource || !name) {
        throw new Error("resource and name are required");
      }

      validateSafeResource(resource);

      const result = ["describe", resource, name];

      addNamespaceArgs(result, stringifyArg(args.namespace));

      return result;
    }

    case "kubectl_logs": {
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

      return result;
    }

    case "kubectl_top": {
      const resource = stringifyArg(args.resource);

      if (resource !== "pods" && resource !== "nodes") {
        throw new Error("resource must be pods or nodes");
      }

      const result = ["top", resource];

      if (resource === "pods") {
        addNamespaceArgs(result, stringifyArg(args.namespace), booleanArg(args.allNamespaces));
      }

      return result;
    }

    // ── Write tools (only available in read-write mode) ──────────────

    case "kubectl_apply": {
      const manifest = stringifyArg(args.manifest);

      if (!manifest) {
        throw new Error("manifest is required");
      }

      const result = ["apply", "--filename", "-"];

      addNamespaceArgs(result, stringifyArg(args.namespace));

      if (booleanArg(args.dryRun) || args.dryRun === undefined) {
        result.push("--dry-run=client");
      }

      return result;
    }

    case "kubectl_delete": {
      const resource = stringifyArg(args.resource);
      const name = stringifyArg(args.name);

      if (!resource || !name) {
        throw new Error("resource and name are required");
      }

      validateSafeResource(resource);

      const result = ["delete", resource, name];

      addNamespaceArgs(result, stringifyArg(args.namespace));

      return result;
    }

    case "kubectl_scale": {
      const resource = stringifyArg(args.resource);
      const name = stringifyArg(args.name);
      const replicas = numberArg(args.replicas);

      if (!resource || !name || replicas === undefined) {
        throw new Error("resource, name, and replicas are required");
      }

      validateSafeResource(resource);

      const result = ["scale", resource, name, "--replicas", String(replicas)];

      addNamespaceArgs(result, stringifyArg(args.namespace));

      return result;
    }

    case "kubectl_rollout_restart": {
      const resource = stringifyArg(args.resource);
      const name = stringifyArg(args.name);

      if (!resource || !name) {
        throw new Error("resource and name are required");
      }

      validateSafeResource(resource);

      const result = ["rollout", "restart", resource, name];

      addNamespaceArgs(result, stringifyArg(args.namespace));

      return result;
    }

    default:
      throw new Error(`Unsupported tool: ${toolCall.name}`);
  }
};

const runKubectl = async (
  execFile: ExecFile,
  kubectl: Kubectl,
  kubeconfigPath: string,
  args: string[],
  stdin?: string,
) => {
  const kubectlPath = await kubectl.getPath();
  const commandArgs = ["--kubeconfig", kubeconfigPath, ...args, "--request-timeout=20s"];
  const execOptions: Record<string, unknown> = { maxBuffer: 1024 * 1024 * 8 };

  if (stdin) {
    execOptions.input = stdin;
  }

  const result = await execFile(kubectlPath, commandArgs, execOptions);

  if (result.callWasSuccessful) {
    return result.response.slice(0, maxOutputLength) || "Command completed with no output.";
  }

  const stderr = result.error.stderr || result.error.message;

  throw new Error(stderr.slice(0, maxOutputLength));
};

const createExecuteAiAgentKubectlTool =
  (
    di: DiContainerForInjection,
    getClusterById: GetClusterById,
    kubectl: Kubectl,
    execFile: ExecFile,
  ): ExecuteAiAgentKubectlTool =>
  async (clusterId, toolCall) => {
    try {
      if (!clusterId) {
        throw new Error("No active cluster is associated with this AI Agent chat.");
      }

      const cluster = getClusterById(clusterId);

      if (!cluster) {
        throw new Error(`Cluster not found: ${clusterId}`);
      }

      const kubeconfigManager = di.inject(kubeconfigManagerInjectable, cluster);
      const kubeconfigPath = await kubeconfigManager.ensurePath();
      const args = buildKubectlArgs(toolCall);

      // kubectl_apply reads manifest from stdin
      const isApply = toolCall.name === "kubectl_apply";
      const manifest = isApply ? (stringifyArg(toolCall.arguments.manifest) ?? "") : undefined;
      const output = await runKubectl(execFile, kubectl, kubeconfigPath, args, manifest);

      return {
        content: `$ kubectl ${args.join(" ")}\n${output}`,
        isError: false,
      };
    } catch (error) {
      return {
        content: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  };

const executeAiAgentKubectlToolInjectable = getInjectable({
  id: "execute-ai-agent-kubectl-tool",

  instantiate: (di): ExecuteAiAgentKubectlTool =>
    createExecuteAiAgentKubectlTool(
      di,
      di.inject(getClusterByIdInjectable),
      di.inject(bundledKubectlInjectable),
      di.inject(execFileInjectable),
    ),
});

export default executeAiAgentKubectlToolInjectable;
