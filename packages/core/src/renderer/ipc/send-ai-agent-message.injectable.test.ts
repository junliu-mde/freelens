/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createContainer } from "@ogre-tools/injectable";
import { isObservable, observable } from "mobx";
import { aiAgentClusterIdHeader } from "../../features/ai-agent/common/headers";
import hostedClusterIdInjectable from "../cluster-frame-context/hosted-cluster-id.injectable";
import ipcRendererInjectable from "../utils/channel/ipc-renderer.injectable";
import sendAiAgentMessageInjectable from "./send-ai-agent-message.injectable";

describe("send-ai-agent-message injectable", () => {
  it("sanitizes observable ai agent requests before invoking electron ipc", async () => {
    const di = createContainer("renderer");
    const invokeMock = jest.fn(
      async (_channel: string, _payload: unknown): Promise<void> => undefined,
    ) as unknown as jest.Mock<Promise<void>, [string, unknown]>;

    di.register(hostedClusterIdInjectable);
    di.register(ipcRendererInjectable);
    di.register(sendAiAgentMessageInjectable);
    di.override(hostedClusterIdInjectable, () => "cluster-1");
    di.override(
      ipcRendererInjectable,
      () =>
        ({
          invoke: invokeMock,
        }) as unknown as Electron.IpcRenderer,
    );

    const sendAiAgentMessage = di.inject(sendAiAgentMessageInjectable);
    const request = observable({
      tabId: "tab-1",
      runId: "run-1",
      permissionMode: "read-only" as const,
      messages: [
        {
          role: "assistant" as const,
          createdAt: 1,
          parts: [
            {
              type: "tool_result" as const,
              toolCallId: "tool-1",
              content: "ok",
              isError: false,
              details: {
                command: "kubectl get pods",
              },
            },
          ],
        },
      ],
    });

    await sendAiAgentMessage(request as any);

    expect(invokeMock).toHaveBeenCalledTimes(1);

    const payload = invokeMock.mock.calls[0]?.[1] as
      | {
          tabId: string;
          runId: string;
          permissionMode: string;
          messages: Array<{
            role: string;
            createdAt: number;
            parts: Array<{
              type: string;
              toolCallId: string;
              content: string;
              isError: boolean;
              details?: {
                command?: string;
              };
            }>;
          }>;
          metadata: Record<string, string>;
        }
      | undefined;

    expect(payload).toBeDefined();

    if (!payload) {
      throw new Error("Missing ai-agent IPC payload");
    }

    expect(payload).toEqual({
      tabId: "tab-1",
      runId: "run-1",
      permissionMode: "read-only",
      messages: [
        {
          role: "assistant",
          createdAt: 1,
          parts: [
            {
              type: "tool_result",
              toolCallId: "tool-1",
              content: "ok",
              isError: false,
              details: {
                command: "kubectl get pods",
              },
            },
          ],
        },
      ],
      metadata: {
        [aiAgentClusterIdHeader]: "cluster-1",
      },
    });
    expect(isObservable(payload)).toBe(false);
    expect(isObservable(payload.messages)).toBe(false);
    expect(isObservable(payload.messages[0].parts)).toBe(false);
    expect(isObservable(payload.messages[0].parts[0].details)).toBe(false);
  });
});
