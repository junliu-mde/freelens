/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import spawnInjectable from "../../../main/child-process/spawn.injectable";
import kubeconfigManagerInjectable from "../../../main/kubeconfig-manager/kubeconfig-manager.injectable";
import bundledKubectlInjectable from "../../../main/kubectl/bundled-kubectl.injectable";
import getClusterByIdInjectable from "../../cluster/storage/common/get-by-id.injectable";
import { killProcessTree, waitForChildProcess } from "./ai-agent-process";
import {
  AiAgentOutputAccumulator,
  createAiAgentToolExecutionPayload,
  createAiAgentToolExecutionPayloadFromSnapshot,
} from "./ai-agent-tool-output";
import { getAiAgentKubectlToolDefinition } from "./kubectl-tools";

import type { ToolCall } from "@earendil-works/pi-ai";
import type { DiContainerForInjection } from "@ogre-tools/injectable";

import type { ClusterId } from "../../../common/cluster-types";
import type { Spawn } from "../../../main/child-process/spawn.injectable";
import type { Kubectl } from "../../../main/kubectl/kubectl";
import type { GetClusterById } from "../../cluster/storage/common/get-by-id.injectable";
import type { AiAgentToolResultDetails } from "../common/tool-result-details";

export interface AiAgentToolExecutionResult {
  content: string;
  isError: boolean;
  details?: AiAgentToolResultDetails;
}

export type ExecuteAiAgentKubectlTool = (
  clusterId: ClusterId | undefined,
  toolCall: ToolCall,
  signal?: AbortSignal,
) => Promise<AiAgentToolExecutionResult>;

const kubectlToolTimeoutMs = 30_000;

class AiAgentKubectlExecutionError extends Error {
  constructor(
    message: string,
    readonly details?: AiAgentToolResultDetails,
  ) {
    super(message);
    this.name = "AiAgentKubectlExecutionError";
  }
}

const getAbortMessage = (signal?: AbortSignal) => {
  const reason = signal?.reason;

  return typeof reason === "string" && reason ? reason : "AI Agent run was stopped.";
};

const getKubectlErrorMessage = (message: string, timedOut: boolean, signal?: AbortSignal) => {
  if (signal?.aborted) {
    return getAbortMessage(signal);
  }

  if (timedOut) {
    return `kubectl command timed out after ${kubectlToolTimeoutMs / 1000}s.`;
  }

  return message;
};

const runKubectl = async (
  spawn: Spawn,
  kubectl: Kubectl,
  kubeconfigPath: string,
  args: string[],
  signal?: AbortSignal,
  stdin?: string,
) => {
  const kubectlPath = await kubectl.getPath();
  const commandArgs = ["--kubeconfig", kubeconfigPath, ...args, "--request-timeout=20s"];
  const stdout = new AiAgentOutputAccumulator({ tempFilePrefix: "freelens-ai-agent-stdout" });
  const stderr = new AiAgentOutputAccumulator({ tempFilePrefix: "freelens-ai-agent-stderr" });
  const child = spawn(kubectlPath, commandArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  let timedOut = false;
  let timeoutHandle: NodeJS.Timeout | undefined;
  const abortChild = () => {
    if (child.pid) {
      killProcessTree(child.pid);
    }
  };

  try {
    child.stdout?.on("data", (data: Buffer) => stdout.append(data));
    child.stderr?.on("data", (data: Buffer) => stderr.append(data));

    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    } else {
      child.stdin?.end();
    }

    if (signal) {
      if (signal.aborted) {
        abortChild();
      } else {
        signal.addEventListener("abort", abortChild, { once: true });
      }
    }

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortChild();
    }, kubectlToolTimeoutMs);

    const exitCode = await waitForChildProcess(child);

    stdout.finish();
    stderr.finish();

    const stdoutSnapshot = stdout.snapshot({ persistIfTruncated: true });
    const stderrSnapshot = stderr.snapshot({ persistIfTruncated: true });

    await Promise.all([stdout.closeTempFile(), stderr.closeTempFile()]);

    if (signal?.aborted || timedOut) {
      const payload = createAiAgentToolExecutionPayloadFromSnapshot(
        `kubectl ${args.join(" ")}`,
        stderrSnapshot.content ? stderrSnapshot : stdoutSnapshot,
      );

      throw new AiAgentKubectlExecutionError(
        getKubectlErrorMessage(payload.content, timedOut, signal),
        payload.details,
      );
    }

    if (exitCode === 0) {
      return createAiAgentToolExecutionPayloadFromSnapshot(`kubectl ${args.join(" ")}`, stdoutSnapshot);
    }

    const errorPayload = createAiAgentToolExecutionPayloadFromSnapshot(
      `kubectl ${args.join(" ")}`,
      stderrSnapshot.content ? stderrSnapshot : stdoutSnapshot,
    );

    throw new AiAgentKubectlExecutionError(
      getKubectlErrorMessage(errorPayload.content, false, signal),
      errorPayload.details,
    );
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    if (signal) {
      signal.removeEventListener("abort", abortChild);
    }
  }
};

const getToolCommand = (toolCall: ToolCall) => {
  try {
    const definition = getAiAgentKubectlToolDefinition(toolCall.name);
    const invocation = definition.buildInvocation(toolCall);

    return `kubectl ${invocation.args.join(" ")}`;
  } catch {
    return undefined;
  }
};

const createExecuteAiAgentKubectlTool =
  (
    di: DiContainerForInjection,
    getClusterById: GetClusterById,
    kubectl: Kubectl,
    spawn: Spawn,
  ): ExecuteAiAgentKubectlTool =>
  async (clusterId, toolCall, signal) => {
    try {
      if (signal?.aborted) {
        throw new Error(getAbortMessage(signal));
      }

      if (!clusterId) {
        throw new Error("No active cluster is associated with this AI Agent chat.");
      }

      const cluster = getClusterById(clusterId);

      if (!cluster) {
        throw new Error(`Cluster not found: ${clusterId}`);
      }

      const kubeconfigManager = di.inject(kubeconfigManagerInjectable, cluster);
      const kubeconfigPath = await kubeconfigManager.ensurePath();
      const definition = getAiAgentKubectlToolDefinition(toolCall.name);
      const invocation = definition.buildInvocation(toolCall);
      const payload = await runKubectl(spawn, kubectl, kubeconfigPath, invocation.args, signal, invocation.stdin);

      return {
        content: payload.content,
        isError: false,
        details: payload.details,
      };
    } catch (error) {
      const command = getToolCommand(toolCall);
      const payload =
        error instanceof AiAgentKubectlExecutionError
          ? {
              content: error.message,
              details: error.details,
            }
          : createAiAgentToolExecutionPayload(command, error instanceof Error ? error.message : String(error));

      return {
        content: payload.content,
        isError: true,
        details: payload.details,
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
      di.inject(spawnInjectable),
    ),
});

export default executeAiAgentKubectlToolInjectable;
