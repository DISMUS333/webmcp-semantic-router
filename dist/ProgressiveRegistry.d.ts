/**
 * @webmcp/progressive - ProgressiveRegistry
 *
 * Core registry that implements progressive disclosure and capability-scoped execution.
 * Maintains stable surface tools (preventing LLM multi-step plan disruption),
 * protects in-flight executions during tool state changes (W3C Issue #218),
 * and proxies dynamic tools securely through strongly-bound tokens.
 */
import { CapabilityTokenManager } from './CapabilityTokenManager';
import type { CapabilityToken, ProgressiveWebMcpOptions, W3CModelContext, WebMcpToolDefinition } from './types';
export declare class ProgressiveRegistry {
    #private;
    private readonly catalog;
    private readonly coreToolNames;
    private readonly scorer;
    private readonly routeProvider?;
    private readonly contextAnchor?;
    private readonly tokenManager;
    private readonly maxCandidates;
    private readonly lifecycle;
    /** Tracks currently executing tools to ensure safe completion (W3C Issue #218) */
    private readonly inFlightExecutions;
    private abortController;
    private isMounted;
    constructor(options: ProgressiveWebMcpOptions);
    /**
     * Mounts stable surface tools to document.modelContext or fallback target.
     * Keeps surface toolset small and stable (route_tools + execute_capability + core tools).
     * Returns a promise resolving once all registrations are confirmed by the host.
     */
    mount(modelContext: W3CModelContext): Promise<{
        registeredCount: number;
    }>;
    private waitForPreviousSurfaceToDisappear;
    private toModelContextTool;
    /**
     * Safely unmounts surface tools.
     * Aligned with W3C Issue #218: In-flight executions are allowed to complete gracefully.
     */
    unmount(): {
        inFlightCount: number;
    };
    /**
     * Executes semantic tool discovery query with context anchor injection.
     * Returns top candidates with strongly-bound capability tokens.
     */
    routeTools(query: string, options?: {
        maxResults?: number;
    }): Promise<{
        query: string;
        anchorContext?: Readonly<Record<string, string | number | boolean | null | undefined>>;
        candidates: readonly {
            name: string;
            description: string;
            score: number;
            reason: string;
            inputSchema: Record<string, unknown>;
            suggestedArguments?: Record<string, unknown>;
            capabilityToken: CapabilityToken;
            token: string;
        }[];
    } & Readonly<Record<string, unknown>>>;
    /**
     * Resolves suggested argument values by matching tool inputSchema properties
     * against the application's current Context Anchor (e.g. focusedNodeId -> nodeId, focusedTrackId -> trackId, focusedProductId -> productId).
     */
    private resolveSuggestedArguments;
    /**
     * Issues an ephemeral capability token explicitly bound to toolName.
     */
    issueCapabilityToken(toolName: string, options?: {
        suggestedArguments?: Record<string, unknown>;
        scope?: string;
        ttlMs?: number;
        singleUse?: boolean;
    }): CapabilityToken;
    /**
     * Securely executes a tool using a strongly-bound Capability Token.
     * Enforces token validity, prevents Confused Deputy attacks, and tracks in-flight lifecycle (Issue #218).
     */
    executeCapability(tokenString: string, toolName: string, args: Record<string, unknown>, options?: {
        signal?: AbortSignal;
    }): Promise<unknown>;
    /**
     * Builds the minimal, stable surface tools permanently exposed to the LLM.
     */
    buildSurfaceTools(): readonly WebMcpToolDefinition[];
    getIsMounted(): boolean;
    getCatalogSize(): number;
    getActiveInFlightCount(): number;
    getTokenManager(): CapabilityTokenManager;
}
//# sourceMappingURL=ProgressiveRegistry.d.ts.map