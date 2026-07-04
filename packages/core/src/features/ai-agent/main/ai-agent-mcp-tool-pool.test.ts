/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createAiAgentMcpToolPool } from "./ai-agent-mcp-tool-pool.injectable";

import type { AiAgentSettings } from "../common/settings";
import type { AiAgentMcpToolSupport } from "./ai-agent-mcp-tool-support.injectable";

describe("ai-agent MCP tool pool", () => {
  const settings: AiAgentSettings = {
    provider: "custom-openai-compat",
    baseUrl: "http://localhost:8000/v1",
    apiKey: "irrelevant",
    model: "some-model",
    reasoningEffort: "off",
    temperature: undefined,
    enableKubectlTools: true,
    enableMcpTools: true,
    mcpConfigPath: "~/.mcp.json",
    maxToolIterations: 1,
    enableCompaction: true,
    compactionReserveTokens: 16_384,
    compactionKeepRecentTokens: 20_000,
  };

  it("reuses a preloaded MCP support instance across runs", async () => {
    const support = {
      tools: [{ name: "mcp__demo__tool", description: "demo", parameters: { type: "object" } }],
      hasTool: () => true,
      execute: jest.fn(),
      close: jest.fn(async () => undefined),
    } satisfies AiAgentMcpToolSupport;

    const createMcpToolSupport = jest.fn(async () => support);

    const pool = createAiAgentMcpToolPool(createMcpToolSupport, () => settings, {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    });

    pool.preload();
    await Promise.resolve();

    await pool.getForRun(settings, "read-write");

    expect(pool.isReady(settings)).toBe(true);
    expect(createMcpToolSupport).toHaveBeenCalledTimes(1);

    const first = await pool.getForRun(settings, "read-write");
    const second = await pool.getForRun(settings, "read-write");

    expect(first).toBe(support);
    expect(second).toBe(support);
    expect(createMcpToolSupport).toHaveBeenCalledTimes(1);
    expect(support.close).not.toHaveBeenCalled();
  });

  it("treats an in-flight preload as ready for UI status purposes", async () => {
    let resolveLoad: (value: AiAgentMcpToolSupport) => void = () => undefined;

    const createMcpToolSupport = jest.fn(
      () =>
        new Promise<AiAgentMcpToolSupport>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const pool = createAiAgentMcpToolPool(createMcpToolSupport, () => settings, {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    });

    pool.preload();

    expect(pool.isReady(settings)).toBe(true);

    resolveLoad({
      tools: [],
      hasTool: () => false,
      execute: jest.fn(),
      close: jest.fn(async () => undefined),
    });
    await pool.getForRun(settings, "read-write");
  });

  it("reloads MCP tools when the config path changes", async () => {
    let loadCount = 0;
    const createMcpToolSupport = jest.fn(async () => {
      loadCount += 1;

      return {
        tools: [{ name: `mcp__demo__tool_${loadCount}`, description: "demo", parameters: { type: "object" } }],
        hasTool: () => true,
        execute: jest.fn(),
        close: jest.fn(async () => undefined),
      };
    });

    const pool = createAiAgentMcpToolPool(createMcpToolSupport, () => settings, {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    });

    await pool.getForRun(settings, "read-write");
    await pool.getForRun({ ...settings, mcpConfigPath: "~/.cursor/mcp.json" }, "read-write");

    expect(createMcpToolSupport).toHaveBeenCalledTimes(2);
  });
});
