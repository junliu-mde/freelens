/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

jest.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: jest.fn(),
}));

jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: jest.fn(),
}));

jest.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: jest.fn(),
  getDefaultEnvironment: jest.fn(() => ({ PATH: "/usr/bin" })),
}));

jest.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));

import { createAiAgentMcpToolSupport } from "./ai-agent-mcp-tool-support.injectable";

import type { AiAgentSettings } from "../common/settings";

describe("ai-agent MCP tool support", () => {
  const settings: AiAgentSettings = {
    provider: "custom-openai-compat",
    baseUrl: "http://localhost:8000/v1",
    apiKey: "irrelevant",
    model: "some-model",
    reasoningEffort: "off",
    maxTokens: 512,
    temperature: undefined,
    enableKubectlTools: true,
    enableMcpTools: true,
    mcpConfigPath: "~/.mcp.json",
    maxToolIterations: 1,
    enableCompaction: true,
    compactionReserveTokens: 16_384,
    compactionKeepRecentTokens: 20_000,
  };

  it("returns no MCP tools when the default config file is missing", async () => {
    const support = await createAiAgentMcpToolSupport(settings, "read-write", undefined, {
      readJsonFile: async () => {
        const error = new Error("missing") as Error & { code: string };

        error.code = "ENOENT";
        throw error;
      },
      resolveTilde: (filePath) => filePath.replace("~", "/Users/tester"),
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
      },
    });

    expect(support).toBeUndefined();
  });

  it("loads tools from ~/.mcp.json and executes them through the matching MCP client", async () => {
    const connect = jest.fn(async () => undefined);
    const listTools = jest.fn(async () => ({
      tools: [
        {
          name: "read_file",
          description: "Read a file from disk.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
              },
            },
            required: ["path"],
          },
          annotations: {
            readOnlyHint: true,
          },
        },
      ],
    }));
    const callTool = jest.fn(async () => ({
      content: [
        {
          type: "text" as const,
          text: "file body",
        },
      ],
    }));
    const close = jest.fn(async () => undefined);
    const createClient = () => ({
      connect,
      listTools,
      callTool,
      close,
    });
    const createStdioTransport = jest.fn(() => ({
      stderr: null,
      close: async () => undefined,
    }));

    const support = await createAiAgentMcpToolSupport(settings, "read-write", undefined, {
      readJsonFile: async (filePath) => {
        expect(filePath).toBe("/Users/tester/.mcp.json");

        return {
          mcpServers: {
            filesystem: {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            },
          },
        };
      },
      resolveTilde: (filePath) => filePath.replace("~", "/Users/tester"),
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
      },
      canAccessExecutable: () => false,
      createClient,
      createStdioTransport,
    });

    expect(support?.tools).toHaveLength(1);
    expect(support?.tools[0]).toMatchObject({
      name: "mcp__filesystem__read_file",
      description: expect.stringContaining("MCP server: filesystem. Original tool: read_file."),
    });

    const result = await support?.execute({
      type: "toolCall",
      id: "call-1",
      name: "mcp__filesystem__read_file",
      arguments: {
        path: "/tmp/demo.txt",
      },
    });

    expect(connect).toHaveBeenCalled();
    expect(createStdioTransport).toHaveBeenCalledWith({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      cwd: undefined,
      env: expect.any(Object),
      stderr: "pipe",
    });
    expect(callTool).toHaveBeenCalledWith(
      {
        name: "read_file",
        arguments: {
          path: "/tmp/demo.txt",
        },
      },
      undefined,
      expect.objectContaining({
        timeout: 30_000,
      }),
    );
    expect(result).toEqual({
      content: "file body",
      details: {
        command: "mcp filesystem.read_file",
      },
      isError: false,
    });

    await support?.close();
    expect(close).toHaveBeenCalled();
  });

  it("truncates large MCP text results before returning them to the chat loop", async () => {
    const largeOutput = Array.from({ length: 3_500 }, (_, index) => `line-${index}`).join("\n");
    const callTool = jest.fn(async () => ({
      content: [
        {
          type: "text" as const,
          text: largeOutput,
        },
      ],
    }));
    const createClient = () => ({
      connect: async () => undefined,
      listTools: async () => ({
        tools: [
          {
            name: "read_file",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
        ],
      }),
      callTool,
      close: async () => undefined,
    });

    const support = await createAiAgentMcpToolSupport(settings, "read-write", undefined, {
      readJsonFile: async () => ({
        mcpServers: {
          filesystem: {
            command: "mcp-server",
          },
        },
      }),
      resolveTilde: (filePath) => filePath.replace("~", "/Users/tester"),
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
      },
      canAccessExecutable: () => false,
      createClient,
      createStdioTransport: jest.fn(() => ({
        stderr: null,
        close: async () => undefined,
      })),
    });

    const result = await support?.execute({
      type: "toolCall",
      id: "call-1",
      name: "mcp__filesystem__read_file",
      arguments: {},
    });

    expect(result?.content).not.toContain("line-0\n");
    expect(result?.content).toContain("line-500\n");
    expect(result?.content).toContain("line-3499");
    expect(result?.content).toContain("Full output:");
    expect(result?.details?.truncation).toMatchObject({
      truncated: true,
      outputLines: 3_000,
      totalLines: 3_500,
    });
    expect(result?.details?.fullOutputPath).toBeDefined();
  });

  it("resolves bare stdio commands from common executable directories", async () => {
    const createStdioTransport = jest.fn(() => ({
      stderr: null,
      close: async () => undefined,
    }));
    const createClient = () => ({
      connect: async () => undefined,
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [] }),
      close: async () => undefined,
    });

    await createAiAgentMcpToolSupport(settings, "read-write", undefined, {
      readJsonFile: async () => ({
        mcpServers: {
          docs: {
            command: "uvx",
            args: ["awslabs.aws-documentation-mcp-server"],
          },
        },
      }),
      resolveTilde: (filePath) => filePath.replace("~", "/Users/tester"),
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
      },
      canAccessExecutable: (filePath) => filePath === "/opt/homebrew/bin/uvx",
      executableSearchPaths: ["/opt/homebrew/bin"],
      createClient,
      createStdioTransport,
    });

    expect(createStdioTransport).toHaveBeenCalledWith({
      command: "/opt/homebrew/bin/uvx",
      args: ["awslabs.aws-documentation-mcp-server"],
      cwd: undefined,
      env: expect.any(Object),
      stderr: "pipe",
    });
  });

  it("accepts type=http as a transport alias for URL-based MCP servers", async () => {
    const createStreamableHttpTransport = jest.fn(() => ({}));
    const createClient = () => ({
      connect: async () => undefined,
      listTools: async () => ({
        tools: [
          {
            name: "search_docs",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
        ],
      }),
      callTool: async () => ({ content: [] }),
      close: async () => undefined,
    });

    const support = await createAiAgentMcpToolSupport(settings, "read-write", undefined, {
      readJsonFile: async () => ({
        mcpServers: {
          context7: {
            type: "http",
            url: "https://example.test/mcp",
          },
        },
      }),
      resolveTilde: (filePath) => filePath.replace("~", "/Users/tester"),
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
      },
      createClient,
      createStreamableHttpTransport,
    });

    expect(createStreamableHttpTransport).toHaveBeenCalledWith(new URL("https://example.test/mcp"), {
      requestInit: undefined,
    });
    expect(support?.tools).toHaveLength(1);
    expect(support?.tools[0]?.name).toBe("mcp__context7__search_docs");
  });

  it("loads multiple config files and resolves config relative path with its own directory", async () => {
    const createStdioTransport = jest.fn(() => ({
      stderr: null,
      close: async () => undefined,
    }));
    const createClient = () => ({
      connect: async () => undefined,
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [] }),
      close: async () => undefined,
    });

    const readJsonFile = jest.fn(async (filePath: string) => {
      if (filePath === "/Users/tester/.mcp.json") {
        return {
          mcpServers: {
            serverA: {
              command: "node",
              args: ["index.js"],
              cwd: "./custom-dir",
            },
            sharedServer: {
              command: "node",
              args: ["shared-custom.js"],
            },
          },
        };
      }
      if (filePath === "/Users/tester/.cursor/mcp.json") {
        return {
          mcpServers: {
            serverB: {
              command: "node",
              args: ["index.js"],
              cwd: "./cursor-dir",
            },
            sharedServer: {
              command: "node",
              args: ["shared-cursor.js"],
            },
          },
        };
      }
      return {};
    });

    const multipleSettings = {
      ...settings,
      mcpConfigPath: "~/.mcp.json",
    };

    await createAiAgentMcpToolSupport(multipleSettings, "read-write", undefined, {
      readJsonFile: readJsonFile as any,
      resolveTilde: (filePath) => filePath.replace("~", "/Users/tester"),
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
      },
      canAccessExecutable: () => false,
      createClient,
      createStdioTransport,
    });

    expect(readJsonFile).toHaveBeenCalledWith("/Users/tester/.mcp.json");
    expect(readJsonFile).toHaveBeenCalledWith("/Users/tester/.cursor/mcp.json");

    expect(createStdioTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "node",
        args: ["index.js"],
        cwd: "/Users/tester/custom-dir",
      }),
    );

    expect(createStdioTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "node",
        args: ["index.js"],
        cwd: "/Users/tester/.cursor/cursor-dir",
      }),
    );

    expect(createStdioTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "node",
        args: ["shared-custom.js"],
      }),
    );
    expect(createStdioTransport).not.toHaveBeenCalledWith(
      expect.objectContaining({
        command: "node",
        args: ["shared-cursor.js"],
      }),
    );
  });
});
