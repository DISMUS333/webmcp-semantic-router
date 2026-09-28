/**
 * @webmcp/progressive - Types & Specification Contracts
 *
 * Compliant with W3C WebML WG WebMCP Draft specification.
 * Provides capability-scoped execution contracts, deterministic scoring,
 * and minimal Context Anchor interfaces.
 */
/**
 * W3C WebMCP Tool Annotations
 */
export interface WebMcpToolAnnotations {
    /** True if tool performs read-only operations without side effects */
    readonly readOnlyHint?: boolean;
    /** True if tool execution results in irreversible or impactful changes */
    readonly consequentialHint?: boolean;
    /** True if tool content contains untrusted external input */
    readonly untrustedContentHint?: boolean;
    /** True if tool is intended for debugging or developer tooling */
    readonly debugging?: boolean;
}
/**
 * Standard W3C WebMCP Tool Definition
 */
export interface WebMcpToolDefinition<TArgs = Record<string, unknown>, TResult = unknown> {
    readonly name: string;
    readonly title?: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
    readonly annotations?: WebMcpToolAnnotations;
    readonly tags?: readonly string[];
    readonly domain?: string;
    readonly execute: (args: TArgs, context?: {
        signal?: AbortSignal;
    }) => Promise<TResult> | TResult;
}
/**
 * Strongly-bound Capability Token for secure proxy execution
 * Prevents Confused Deputy attacks by strictly binding to toolName and expiry.
 */
export interface CapabilityToken {
    /** Cryptographically secure unique token string */
    readonly token: string;
    /** Target tool name strictly bound to this token */
    readonly toolName: string;
    /** Timestamp (epoch ms) when token was issued */
    readonly issuedAt: number;
    /** Expiration timestamp (epoch ms) */
    readonly expiresAt: number;
    /** True if token can only be executed exactly once */
    readonly singleUse: boolean;
    /** Optional domain scope identifier */
    readonly scope?: string;
    /** Ephemeral parameter bindings resolved at route time (e.g. nodeId of focused building) */
    readonly suggestedArguments?: Readonly<Record<string, unknown>>;
}
/**
 * Context Anchor Provider
 * Minimal least-privilege interface for passing explicit application state (e.g. focused node ID, active tab).
 * Prevents arbitrary DOM or sensitive history scraping.
 */
export type ContextAnchorProvider = () => Readonly<Record<string, string | number | boolean | null | undefined>>;
/**
 * Scored tool candidate returned by routing engines
 */
export interface ScoredToolCandidate {
    readonly tool: WebMcpToolDefinition;
    readonly score: number;
    readonly reason: string;
    readonly capabilityToken?: CapabilityToken;
}
/**
 * Pluggable Semantic Scorer Interface
 * Allows CPU-first deterministic scoring with optional WebGPU acceleration.
 */
export interface SemanticScorer {
    readonly name: string;
    scoreTools(query: string, tools: readonly WebMcpToolDefinition[], contextAnchor?: Readonly<Record<string, string | number | boolean | null | undefined>>): Promise<readonly ScoredToolCandidate[]>;
}
/**
 * Optional host callbacks for observability and task cancellation.
 * The router core stays independent from any application state store.
 */
export interface ProgressiveRouterLifecycle {
    readonly onRouteStart?: (query: string) => void;
    readonly onRouteEnd?: (result: unknown, success: boolean) => void;
    readonly onToolStart?: (toolName: string, readOnly: boolean, args: Record<string, unknown>) => void;
    readonly onToolEnd?: (toolName: string, result: unknown, success: boolean) => void;
    readonly getAbortSignal?: () => AbortSignal | undefined;
}
/**
 * Optional application-owned route provider.
 * WebMCP defines tool exposure and execution, while applications may provide
 * their own semantic router for discovery quality and domain safety rules.
 */
export interface RouteProviderResult {
    readonly candidates: readonly ScoredToolCandidate[];
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export type RouteProvider = (query: string, tools: readonly WebMcpToolDefinition[], contextAnchor?: Readonly<Record<string, string | number | boolean | null | undefined>>, options?: {
    maxResults?: number;
}) => Promise<RouteProviderResult>;
/**
 * Configuration Options for Progressive WebMCP Router
 */
export interface ProgressiveWebMcpOptions {
    /** Full catalog of application tools (can be 50~200+ tools) */
    readonly tools: readonly WebMcpToolDefinition[];
    /** Names of stable core tools to permanently expose (recommended: 3~6 tools) */
    readonly coreToolNames?: readonly string[];
    /** Pluggable semantic scorer (defaults to DeterministicCpuScorer) */
    readonly scorer?: SemanticScorer;
    /** Optional application-owned discovery provider used by route_tools */
    readonly routeProvider?: RouteProvider;
    /** Optional context anchor provider for minimal state resolution */
    readonly contextAnchor?: ContextAnchorProvider;
    /** Default token lifetime in milliseconds (default: 60,000ms = 60s) */
    readonly tokenTtlMs?: number;
    /** Maximum number of tool candidates to return per route query (default: 5) */
    readonly maxCandidates?: number;
    /** Optional host integration hooks for telemetry, UI state, and cancellation. */
    readonly lifecycle?: ProgressiveRouterLifecycle;
}
/** Current WebMCP ModelContext tool contract. */
export interface W3CModelContextTool {
    readonly name: string;
    readonly title?: string;
    readonly description: string;
    readonly inputSchema?: Record<string, unknown>;
    readonly annotations?: WebMcpToolAnnotations;
    readonly execute: (inputObject: Record<string, unknown>, options: {
        signal: AbortSignal;
    }) => Promise<unknown>;
}
/** Tool returned by the current WebMCP discovery API. */
export interface W3CRegisteredTool {
    readonly name: string;
    readonly title: string;
    readonly description: string;
    readonly inputSchema?: Record<string, unknown>;
    readonly window: Window;
    readonly origin: string;
    readonly annotations: WebMcpToolAnnotations;
}
/**
 * WebMCP ModelContext interface.
 *
 * The browser-facing entry point is `document.modelContext`. The optional
 * legacy alias is handled only at the adapter boundary.
 */
export interface W3CModelContext {
    registerTool(tool: W3CModelContextTool, options?: {
        exposedTo?: readonly string[];
        signal?: AbortSignal;
    }): Promise<void>;
    getTools(options?: {
        fromOrigins?: readonly string[];
    }): Promise<readonly W3CRegisteredTool[]>;
    executeTool(tool: W3CRegisteredTool, inputObject?: Record<string, unknown>, options?: {
        signal?: AbortSignal;
    }): Promise<string>;
    ontoolchange?: ((event: Event) => void) | null;
}
//# sourceMappingURL=types.d.ts.map