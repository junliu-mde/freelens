/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { accessSync, constants as fsConstants } from "node:fs";
import path from "node:path";
import { loggerInjectionToken } from "@freelensapp/logger";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getInjectable } from "@ogre-tools/injectable";
import readJsonFileInjectable from "../../../common/fs/read-json-file.injectable";
import resolveTildeInjectable from "../../../common/path/resolve-tilde.injectable";
import type { Stream } from "node:stream";

import type { Logger } from "@freelensapp/logger";

import type { Tool, ToolCall } from "@earendil-works/pi-ai";

import type { ReadJson } from "../../../common/fs/read-json-file.injectable";
import type { ResolveTilde } from "../../../common/path/resolve-tilde.injectable";
import type { AiAgentPermissionMode } from "../common/channels";
import type { AiAgentSettings } from "../common/settings";
import type { AiAgentToolExecutionResult } from "./execute-ai-agent-kubectl-tool.injectable";

interface AiAgentMcpLogger extends Pick<Logger, "debug" | "info" | "warn"> {}

interface AiAgentMcpRemoteTool {
  name: string;
  description?: string;
  inputSchema: Tool["parameters"];
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

interface AiAgentMcpToolResponseContentText {
  type: "text";
  text: string;
}

interface AiAgentMcpToolResponseContentImage {
  type: "image";
  data: string;
  mimeType: string;
}

interface AiAgentMcpToolResponseContentAudio {
  type: "audio";
  data: string;
  mimeType: string;
}

interface AiAgentMcpToolResponseTextResource {
  uri: string;
  text: string;
  mimeType?: string;
}

interface AiAgentMcpToolResponseBlobResource {
  uri: string;
  blob: string;
  mimeType?: string;
}

interface AiAgentMcpToolResponseContentResource {
  type: "resource";
  resource: AiAgentMcpToolResponseTextResource | AiAgentMcpToolResponseBlobResource;
}

interface AiAgentMcpToolResponseContentResourceLink {
  type: "resource_link";
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  size?: number;
  title?: string;
}

type AiAgentMcpToolResponseContent =
  | AiAgentMcpToolResponseContentText
  | AiAgentMcpToolResponseContentImage
  | AiAgentMcpToolResponseContentAudio
  | AiAgentMcpToolResponseContentResource
  | AiAgentMcpToolResponseContentResourceLink;

interface AiAgentMcpCallToolResult {
  content?: AiAgentMcpToolResponseContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  toolResult?: unknown;
}

interface AiAgentMcpTransport {}

interface AiAgentMcpStdioTransport extends AiAgentMcpTransport {
  stderr?: Stream | null;
}

interface AiAgentMcpClient {
  connect(transport: AiAgentMcpTransport, options?: { signal?: AbortSignal; timeout?: number }): Promise<void>;
  listTools(
    params?: unknown,
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<{ tools?: AiAgentMcpRemoteTool[] }>;
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    resultSchema?: unknown,
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<AiAgentMcpCallToolResult>;
  close(): Promise<void>;
}

interface AiAgentMcpServerConfig {
  disabled?: boolean;
  transport?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

interface AiAgentMcpToolBinding {
  client: AiAgentMcpClient;
  serverName: string;
  remoteToolName: string;
}

export interface AiAgentMcpToolSupport {
  tools: Tool[];
  hasTool(toolName: string): boolean;
  execute(toolCall: ToolCall, signal?: AbortSignal): Promise<AiAgentToolExecutionResult>;
  close(): Promise<void>;
}

export type CreateAiAgentMcpToolSupport = (
  settings: AiAgentSettings,
  permissionMode: AiAgentPermissionMode,
  signal?: AbortSignal,
) => Promise<AiAgentMcpToolSupport | undefined>;

interface AiAgentMcpToolSupportDependencies {
  readJsonFile: ReadJson;
  resolveTilde: ResolveTilde;
  logger: AiAgentMcpLogger;
  canAccessExecutable?: (filePath: string) => boolean;
  executableSearchPaths?: string[];
  createClient?: () => AiAgentMcpClient;
  createStdioTransport?: (params: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    stderr?: "pipe";
  }) => AiAgentMcpStdioTransport;
  createStreamableHttpTransport?: (url: URL, options?: { requestInit?: RequestInit }) => AiAgentMcpTransport;
  createSseTransport?: (url: URL, options?: { requestInit?: RequestInit }) => AiAgentMcpTransport;
}

const mcpRequestTimeoutMs = 30_000;
const defaultExecutableSearchPaths = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFileNotFoundError = (error: unknown) =>
  isRecord(error) && typeof error.code === "string" && error.code === "ENOENT";

const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const toOptionalString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

const toStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) =>
        typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? [String(item)] : [],
      )
    : undefined;

const toStringRecord = (value: unknown) => {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).flatMap(([key, item]) =>
    typeof item === "string" || typeof item === "number" || typeof item === "boolean"
      ? [[key, String(item)] as const]
      : [],
  );

  return Object.fromEntries(entries);
};

const sanitizeToolToken = (value: string) => {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");

  return sanitized || "tool";
};

const buildUniqueToolName = (serverName: string, toolName: string, seenNames: Set<string>) => {
  const baseName = `mcp__${sanitizeToolToken(serverName)}__${sanitizeToolToken(toolName)}`;
  let uniqueName = baseName;
  let suffix = 2;

  while (seenNames.has(uniqueName)) {
    uniqueName = `${baseName}__${suffix}`;
    suffix += 1;
  }

  seenNames.add(uniqueName);

  return uniqueName;
};

const resolveConfigRelativePath = (
  filePath: string | undefined,
  configDirectory: string,
  resolveTilde: ResolveTilde,
) => {
  const resolvedPath = toOptionalString(filePath);

  if (!resolvedPath) {
    return undefined;
  }

  const tildeResolvedPath = resolveTilde(resolvedPath);

  return path.isAbsolute(tildeResolvedPath) ? tildeResolvedPath : path.resolve(configDirectory, tildeResolvedPath);
};

const splitPathEntries = (value: string | undefined) =>
  (value ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

const resolveExecutableCommand = (
  command: string | undefined,
  env: Record<string, string>,
  deps: Pick<AiAgentMcpToolSupportDependencies, "canAccessExecutable" | "executableSearchPaths">,
) => {
  if (!command) {
    return undefined;
  }

  if (path.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return command;
  }

  const canAccessExecutable =
    deps.canAccessExecutable ??
    ((filePath: string) => {
      try {
        accessSync(filePath, fsConstants.X_OK);

        return true;
      } catch {
        return false;
      }
    });
  const searchPaths = Array.from(
    new Set([
      ...splitPathEntries(env.PATH),
      ...splitPathEntries(process.env.PATH),
      ...(deps.executableSearchPaths ?? defaultExecutableSearchPaths),
    ]),
  );

  for (const directoryPath of searchPaths) {
    const candidate = path.join(directoryPath, command);

    if (canAccessExecutable(candidate)) {
      return candidate;
    }
  }

  return command;
};

const createDefaultClient = (): AiAgentMcpClient =>
  new Client({
    name: "Freelens AI Agent",
    version: "1.0.0",
  });

const createDefaultStdioTransport = (params: {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  stderr?: "pipe";
}): AiAgentMcpStdioTransport => new StdioClientTransport(params);

const createDefaultStreamableHttpTransport = (url: URL, options?: { requestInit?: RequestInit }) =>
  new StreamableHTTPClientTransport(url, options);

const createDefaultSseTransport = (url: URL, options?: { requestInit?: RequestInit }) =>
  new SSEClientTransport(url, options);

const attachMcpServerStderrLogging = (
  transport: AiAgentMcpStdioTransport,
  serverName: string,
  logger: AiAgentMcpLogger,
) => {
  transport.stderr?.on("data", (chunk) => {
    const message = String(chunk).trim();

    if (message) {
      logger.debug(`[AI-AGENT] MCP server "${serverName}" stderr: ${message}`);
    }
  });
};

const parseMcpServerConfig = (
  value: unknown,
  configDirectory: string,
  resolveTilde: ResolveTilde,
  deps: Pick<AiAgentMcpToolSupportDependencies, "canAccessExecutable" | "executableSearchPaths">,
): AiAgentMcpServerConfig | undefined => {
  if (!isRecord(value) || value.disabled === true) {
    return undefined;
  }

  const command = toOptionalString(value.command);
  const env = value.env ? { ...getDefaultEnvironment(), ...toStringRecord(value.env) } : getDefaultEnvironment();
  const cwd = resolveConfigRelativePath(
    typeof value.cwd === "string" ? value.cwd : undefined,
    configDirectory,
    resolveTilde,
  );

  return {
    disabled: value.disabled === true,
    transport: toOptionalString(value.transport) ?? toOptionalString(value.type),
    command: resolveExecutableCommand(command ? resolveTilde(command) : undefined, env, deps),
    args: toStringArray(value.args),
    env,
    cwd,
    url: toOptionalString(value.url),
    headers: toStringRecord(value.headers),
  };
};

const createMcpTransport = (serverConfig: AiAgentMcpServerConfig, deps: AiAgentMcpToolSupportDependencies) => {
  if (serverConfig.command) {
    return (
      deps.createStdioTransport?.({
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
        cwd: serverConfig.cwd,
        stderr: "pipe",
      }) ??
      createDefaultStdioTransport({
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
        cwd: serverConfig.cwd,
        stderr: "pipe",
      })
    );
  }

  if (!serverConfig.url) {
    return undefined;
  }

  const requestInit = serverConfig.headers ? { headers: serverConfig.headers } : undefined;
  const serverUrl = new URL(serverConfig.url);

  if (serverConfig.transport === "sse") {
    return (
      deps.createSseTransport?.(serverUrl, { requestInit }) ?? createDefaultSseTransport(serverUrl, { requestInit })
    );
  }

  return (
    deps.createStreamableHttpTransport?.(serverUrl, { requestInit }) ??
    createDefaultStreamableHttpTransport(serverUrl, { requestInit })
  );
};

const createMcpToolDescription = (serverName: string, tool: AiAgentMcpRemoteTool) => {
  const parts = [
    tool.description?.trim() || `${tool.annotations?.title || tool.name} from MCP server "${serverName}".`,
  ];

  parts.push(`MCP server: ${serverName}. Original tool: ${tool.name}.`);

  if (tool.annotations?.readOnlyHint) {
    parts.push("This tool is marked read-only.");
  }

  if (tool.annotations?.destructiveHint) {
    parts.push("This tool can change data or state.");
  }

  return parts.join(" ");
};

const formatStructuredContent = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatMcpToolResultContent = (block: AiAgentMcpToolResponseContent) => {
  switch (block.type) {
    case "text":
      return block.text;
    case "image":
      return `[Image output: ${block.mimeType}, ${block.data.length} base64 chars]`;
    case "audio":
      return `[Audio output: ${block.mimeType}, ${block.data.length} base64 chars]`;
    case "resource":
      if ("text" in block.resource) {
        return `Resource ${block.resource.uri}:\n${block.resource.text}`;
      }

      return `[Binary resource: ${block.resource.uri}${block.resource.mimeType ? ` (${block.resource.mimeType})` : ""}]`;
    case "resource_link":
      return [block.title || block.name, block.description, block.uri].filter(Boolean).join("\n");
  }
};

const formatMcpToolResult = (result: AiAgentMcpCallToolResult) => {
  const parts = [
    ...(result.content ?? []).map(formatMcpToolResultContent).filter((value) => value.trim().length > 0),
    ...(result.structuredContent ? [`Structured content:\n${formatStructuredContent(result.structuredContent)}`] : []),
  ];

  if (parts.length > 0) {
    return parts.join("\n\n");
  }

  if (result.toolResult !== undefined) {
    return formatStructuredContent(result.toolResult);
  }

  return "";
};

const getAbortMessage = (signal?: AbortSignal) => {
  const reason = signal?.reason;

  return typeof reason === "string" && reason ? reason : "AI Agent run was stopped.";
};

class AiAgentMcpToolSupportImpl implements AiAgentMcpToolSupport {
  private closed = false;

  constructor(
    readonly tools: Tool[],
    private readonly bindings: Map<string, AiAgentMcpToolBinding>,
  ) {}

  hasTool(toolName: string) {
    return this.bindings.has(toolName);
  }

  async execute(toolCall: ToolCall, signal?: AbortSignal): Promise<AiAgentToolExecutionResult> {
    const binding = this.bindings.get(toolCall.name);

    if (!binding) {
      return {
        content: `MCP tool not found: ${toolCall.name}`,
        isError: true,
      };
    }

    try {
      if (signal?.aborted) {
        throw new Error(getAbortMessage(signal));
      }

      const result = await binding.client.callTool(
        {
          name: binding.remoteToolName,
          arguments: toolCall.arguments,
        },
        undefined,
        {
          signal,
          timeout: mcpRequestTimeoutMs,
        },
      );

      return {
        content: formatMcpToolResult(result),
        isError: Boolean(result.isError),
      };
    } catch (error) {
      return {
        content: signal?.aborted ? getAbortMessage(signal) : toErrorMessage(error),
        isError: true,
      };
    }
  }

  async close() {
    if (this.closed) {
      return;
    }

    this.closed = true;

    const clients = Array.from(new Set(this.bindings.values().map((binding) => binding.client)));

    await Promise.allSettled(clients.map((client) => client.close()));
  }
}

export const createAiAgentMcpToolSupport = async (
  settings: AiAgentSettings,
  _permissionMode: AiAgentPermissionMode,
  signal: AbortSignal | undefined,
  deps: AiAgentMcpToolSupportDependencies,
): Promise<AiAgentMcpToolSupport | undefined> => {
  if (!settings.enableMcpTools) {
    return undefined;
  }

  const candidatePaths: string[] = [];
  if (settings.mcpConfigPath.trim()) {
    candidatePaths.push(deps.resolveTilde(settings.mcpConfigPath.trim()));
  }
  candidatePaths.push(deps.resolveTilde("~/.claude.json"));
  candidatePaths.push(deps.resolveTilde("~/.claude/mcp.json"));
  candidatePaths.push(deps.resolveTilde("~/.cursor/mcp.json"));

  const mergedServers = new Map<string, { config: unknown; configPath: string }>();

  for (const configPath of candidatePaths) {
    try {
      const rawConfig = await deps.readJsonFile(configPath);
      if (isRecord(rawConfig) && isRecord(rawConfig.mcpServers)) {
        for (const [name, config] of Object.entries(rawConfig.mcpServers)) {
          if (!mergedServers.has(name)) {
            mergedServers.set(name, { config, configPath });
          }
        }
      }
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        deps.logger.warn(`[AI-AGENT] Failed to read MCP config at ${configPath}: ${toErrorMessage(error)}`);
      }
    }
  }

  if (mergedServers.size === 0) {
    deps.logger.info("[AI-AGENT] no MCP servers found or loaded");
    return undefined;
  }

  const bindings = new Map<string, AiAgentMcpToolBinding>();
  const tools: Tool[] = [];
  const seenToolNames = new Set<string>();
  const connectedClients = new Set<AiAgentMcpClient>();

  const loadedConfigs = candidatePaths.filter((p) => p);
  deps.logger.info(`[AI-AGENT] loading MCP configurations from: ${loadedConfigs.join(", ")}`);

  for (const [serverName, serverEntry] of mergedServers.entries()) {
    const configDirectory = path.dirname(serverEntry.configPath);
    const serverConfig = parseMcpServerConfig(serverEntry.config, configDirectory, deps.resolveTilde, deps);

    if (!serverConfig) {
      continue;
    }

    const transport = createMcpTransport(serverConfig, deps);

    if (!transport) {
      deps.logger.warn(`[AI-AGENT] skipping MCP server "${serverName}" because it has no supported transport config.`);
      continue;
    }

    const client = deps.createClient?.() ?? createDefaultClient();

    try {
      if ("stderr" in transport) {
        attachMcpServerStderrLogging(transport as AiAgentMcpStdioTransport, serverName, deps.logger);
      }

      await client.connect(transport, {
        signal,
        timeout: mcpRequestTimeoutMs,
      });

      connectedClients.add(client);

      const response = await client.listTools(undefined, {
        signal,
        timeout: mcpRequestTimeoutMs,
      });
      const remoteTools = response.tools ?? [];

      for (const tool of remoteTools) {
        const toolName = buildUniqueToolName(serverName, tool.name, seenToolNames);

        tools.push({
          name: toolName,
          description: createMcpToolDescription(serverName, tool),
          parameters: tool.inputSchema,
        });
        bindings.set(toolName, {
          client,
          serverName,
          remoteToolName: tool.name,
        });
      }

      deps.logger.info(`[AI-AGENT] initialized MCP server "${serverName}" with ${remoteTools.length} tool(s)`);
    } catch (error) {
      connectedClients.delete(client);
      await client.close().catch(() => undefined);
      deps.logger.warn(`[AI-AGENT] failed to initialize MCP server "${serverName}": ${toErrorMessage(error)}`);
    }
  }

  if (signal?.aborted) {
    await Promise.allSettled(Array.from(connectedClients).map((client) => client.close()));

    return undefined;
  }

  if (tools.length === 0) {
    await Promise.allSettled(Array.from(connectedClients).map((client) => client.close()));
    deps.logger.info("[AI-AGENT] no MCP tools were loaded for this run");

    return undefined;
  }

  deps.logger.info(`[AI-AGENT] loaded ${tools.length} MCP tool(s) for this run`);

  return new AiAgentMcpToolSupportImpl(tools, bindings);
};

const createAiAgentMcpToolSupportInjectable = getInjectable({
  id: "create-ai-agent-mcp-tool-support",

  instantiate: (di): CreateAiAgentMcpToolSupport => {
    const readJsonFile = di.inject(readJsonFileInjectable);
    const resolveTilde = di.inject(resolveTildeInjectable);
    const logger = di.inject(loggerInjectionToken);

    return (settings, permissionMode, signal) =>
      createAiAgentMcpToolSupport(settings, permissionMode, signal, {
        readJsonFile,
        resolveTilde,
        logger,
      });
  },
});

export default createAiAgentMcpToolSupportInjectable;
