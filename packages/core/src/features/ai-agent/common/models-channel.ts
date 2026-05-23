/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

export const aiAgentListModelsChannel = "ai-agent:list-models";

export interface AiAgentListModelsRequest {
  baseUrl: string;
  apiKey: string;
}

export interface AiAgentModelInfo {
  id: string;
  name?: string;
}
