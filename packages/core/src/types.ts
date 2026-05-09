export interface ChatMessage {
  role: string;
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  reasoning_content?: string | null;
  prefix?: string;
}

export interface ToolCall {
  id?: string;
  type?: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type?: string;
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  max_tokens?: number;
  max_completion_tokens?: number;
  response_format?: unknown;
  stop?: string | string[];
  tools?: ToolDefinition[];
  tool_choice?: string | Record<string, unknown>;
  functions?: ToolDefinition[];
  function_call?: string | { name: string };
  thinking?: { type: string };
  reasoning_effort?: string;
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logprobs?: boolean;
  top_logprobs?: number;
  user?: string;
  seed?: number;
  n?: number;
  logit_bias?: Record<string, number>;
  [key: string]: unknown;
}

export interface DeltaChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    reasoning_content?: string;
    tool_calls?: ToolCallDelta[];
  };
  finish_reason?: string | null;
  logprobs?: unknown;
}

export interface ToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: DeltaChoice[];
  usage?: ChatUsage;
}

export interface ChatChoice {
  index: number;
  finish_reason: string | null;
  message: ChatMessage;
  logprobs?: unknown;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: ChatUsage;
}

export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

export interface PreparedRequest {
  payload: Record<string, unknown>;
  originalModel: string;
  upstreamModel: string;
  cacheNamespace: string;
  patchedReasoningMessages: number;
  missingReasoningMessages: number;
  recoveredReasoningMessages: number;
  recoveryDroppedMessages: number;
  recoveryNotice: string | null;
  recordResponseScope: string | null;
  recordResponseMessages: ChatMessage[];
  recordResponseContexts: [string, ChatMessage[]][];
  reasoningDiagnostics: Record<string, unknown>[];
  recoverySteps: Record<string, unknown>[];
  continuedRecoveryBoundary: boolean;
  retiredPrefixMessages: number;
}

export interface ReasoningLookupKey {
  kind: string;
  key: string;
  portable: boolean;
  hit: boolean;
  [key: string]: unknown;
}

export interface ProxyConfig {
  host: string;
  port: number;
  upstreamBaseUrl: string;
  upstreamModel: string;
  thinking: "enabled" | "disabled";
  reasoningEffort: string;
  requestTimeout: number;
  maxRequestBodyBytes: number;
  reasoningContentPath: string;
  missingReasoningStrategy: "recover" | "reject";
  reasoningCacheMaxAgeSeconds: number;
  reasoningCacheMaxRows: number;
  displayReasoning: boolean;
  collapsibleReasoning: boolean;
  ngrok: boolean;
  verbose: boolean;
}
