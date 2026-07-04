/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { onLoadOfApplicationInjectionToken } from "@freelensapp/application";
import { loggerInjectionToken } from "@freelensapp/logger";
import { getInjectable } from "@ogre-tools/injectable";
import userPreferencesStateInjectable from "../../user-preferences/common/state.injectable";
import { normalizeAiAgentSettings } from "../common/settings";
import createAiAgentMcpToolSupportInjectable, {
  type AiAgentMcpToolSupport,
  type CreateAiAgentMcpToolSupport,
} from "./ai-agent-mcp-tool-support.injectable";

import type { AiAgentMcpLogger } from "./ai-agent-mcp-tool-support.injectable";

import type { AiAgentPermissionMode } from "../common/channels";
import type { AiAgentSettings } from "../common/settings";

const getMcpCacheKey = (settings: AiAgentSettings) => `${settings.enableMcpTools}:${settings.mcpConfigPath.trim()}`;

export type GetAiAgentMcpToolSupport = (
  settings: AiAgentSettings,
  permissionMode: AiAgentPermissionMode,
  signal?: AbortSignal,
) => Promise<AiAgentMcpToolSupport | undefined>;

export interface AiAgentMcpToolPool {
  preload: () => void;
  isReady: (settings: AiAgentSettings) => boolean;
  getForRun: GetAiAgentMcpToolSupport;
}

export const createAiAgentMcpToolPool = (
  createMcpToolSupport: CreateAiAgentMcpToolSupport,
  getAiAgentSettings: () => AiAgentSettings | undefined,
  logger: AiAgentMcpLogger,
): AiAgentMcpToolPool => {
  let cachedSupport: AiAgentMcpToolSupport | undefined;
  let cacheKey: string | undefined;
  let loadPromise: Promise<AiAgentMcpToolSupport | undefined> | undefined;

  const closeCachedSupport = async () => {
    const support = cachedSupport;

    cachedSupport = undefined;
    cacheKey = undefined;
    loadPromise = undefined;

    if (support) {
      await support.close().catch(() => undefined);
    }
  };

  const load = (settings: AiAgentSettings) => {
    const key = getMcpCacheKey(settings);

    if (cachedSupport && cacheKey === key) {
      return Promise.resolve(cachedSupport);
    }

    if (loadPromise && cacheKey === key) {
      return loadPromise;
    }

    if (cacheKey !== key) {
      void closeCachedSupport();
    }

    cacheKey = key;
    loadPromise = createMcpToolSupport(settings, "read-write", undefined)
      .then((support) => {
        cachedSupport = support;
        loadPromise = undefined;

        if (support) {
          logger.info(`[AI-AGENT] MCP tool pool ready with ${support.tools.length} tool(s)`);
        } else {
          logger.info("[AI-AGENT] MCP tool pool ready with no tools");
        }

        return support;
      })
      .catch((error) => {
        loadPromise = undefined;
        cacheKey = undefined;
        cachedSupport = undefined;

        const message = error instanceof Error ? error.message : String(error);

        logger.warn(`[AI-AGENT] MCP tool pool load failed: ${message}`);

        return undefined;
      });

    return loadPromise;
  };

  const waitForLoad = async (settings: AiAgentSettings, signal?: AbortSignal) => {
    const pending = load(settings);

    if (!signal) {
      return pending;
    }

    if (signal.aborted) {
      return undefined;
    }

    return new Promise<AiAgentMcpToolSupport | undefined>((resolve) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        resolve(undefined);
      };

      signal.addEventListener("abort", onAbort, { once: true });
      pending
        .then((support) => {
          signal.removeEventListener("abort", onAbort);
          resolve(support);
        })
        .catch(() => {
          signal.removeEventListener("abort", onAbort);
          resolve(undefined);
        });
    });
  };

  return {
    preload: () => {
      const settings = normalizeAiAgentSettings(getAiAgentSettings());

      if (!settings.enableMcpTools) {
        return;
      }

      logger.info("[AI-AGENT] preloading MCP tools in background");
      void load(settings);
    },

    isReady: (settings) => {
      if (!settings.enableMcpTools) {
        return true;
      }

      const key = getMcpCacheKey(settings);

      if (cachedSupport && cacheKey === key) {
        return true;
      }

      // Background preload already in flight — avoid flashing "Loading MCP tools..." on send.
      return Boolean(loadPromise && cacheKey === key);
    },

    getForRun: (settings, _permissionMode, signal) => waitForLoad(settings, signal),
  };
};

const aiAgentMcpToolPoolInjectable = getInjectable({
  id: "ai-agent-mcp-tool-pool",

  instantiate: (di): AiAgentMcpToolPool =>
    createAiAgentMcpToolPool(
      di.inject(createAiAgentMcpToolSupportInjectable),
      () => di.inject(userPreferencesStateInjectable).aiAgent,
      di.inject(loggerInjectionToken),
    ),
});

const setupAiAgentMcpPreloadInjectable = getInjectable({
  id: "setup-ai-agent-mcp-preload",

  instantiate: (di) => ({
    run: () => {
      di.inject(aiAgentMcpToolPoolInjectable).preload();
    },
  }),

  injectionToken: onLoadOfApplicationInjectionToken,
  causesSideEffects: true,
});

export default aiAgentMcpToolPoolInjectable;

export { setupAiAgentMcpPreloadInjectable };
