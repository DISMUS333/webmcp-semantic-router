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
export function createProgressiveWebMcpRouter(options) {
    const registry = new ProgressiveRegistry(options);
    return {
        registry,
        mount: (modelContext) => registry.mount(modelContext),
        unmount: () => registry.unmount(),
        routeTools: (query, opts) => registry.routeTools(query, opts),
        executeCapability: (token, toolName, args, opts) => registry.executeCapability(token, toolName, args, opts),
    };
}
//# sourceMappingURL=index.js.map