/**
 * @webmcp/progressive
 *
 * Progressive, Capability-Scoped WebMCP Router
 * Compliant with W3C WebML WG WebMCP Specification.
 */
export * from './types';
export * from './CapabilityTokenManager';
export * from './DeterministicCpuScorer';
export * from './ProgressiveRegistry';
import { ProgressiveRegistry } from './ProgressiveRegistry';
import type { ProgressiveWebMcpOptions, W3CModelContext } from './types';
/**
 * Creates and initializes a Progressive, Capability-Scoped WebMCP Router instance.
 *
 * @example
 * ```ts
 * const router = createProgressiveWebMcpRouter({
 *   tools: my100Tools,
 *   coreToolNames: ['get_system_status'],
 *   contextAnchor: () => ({ selectedId: getSelectedNodeId() }),
 * });
 *
 * router.mount(document.modelContext);
 * ```
 */
export declare function createProgressiveWebMcpRouter(options: ProgressiveWebMcpOptions): {
    registry: ProgressiveRegistry;
    mount: (modelContext: W3CModelContext) => Promise<{
        registeredCount: number;
    }>;
    unmount: () => {
        inFlightCount: number;
    };
    routeTools: (query: string, options?: {
        maxResults?: number;
    }) => ReturnType<ProgressiveRegistry['routeTools']>;
    executeCapability: (token: string, toolName: string, args: Record<string, unknown>, options?: {
        signal?: AbortSignal;
    }) => Promise<unknown>;
};
//# sourceMappingURL=index.d.ts.map