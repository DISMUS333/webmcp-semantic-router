/**
 * @webmcp/progressive - ProgressiveRegistry
 *
 * Core registry that implements progressive disclosure and capability-scoped execution.
 * Maintains stable surface tools (preventing LLM multi-step plan disruption),
 * protects in-flight executions during tool state changes (WebMCP § 3.1 Pending tool executions),
 * and proxies dynamic tools securely through strongly-bound tokens.
 */
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var _ProgressiveRegistry_executionCounter, _ProgressiveRegistry_mountGeneration;
import { CapabilityTokenManager } from './CapabilityTokenManager';
import { DeterministicCpuScorer } from './DeterministicCpuScorer';
function combineAbortSignals(signals) {
    const available = signals.filter((signal) => signal !== undefined);
    const controller = new AbortController();
    const onAbort = (event) => controller.abort(event.target.reason);
    for (const signal of available) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            break;
        }
        signal.addEventListener('abort', onAbort, { once: true });
    }
    return {
        signal: controller.signal,
        dispose: () => {
            for (const signal of available)
                signal.removeEventListener('abort', onAbort);
        },
    };
}
export class ProgressiveRegistry {
    constructor(options) {
        this.catalog = new Map();
        /** Tracks currently executing tools to ensure safe completion (WebMCP § 3.1) */
        this.inFlightExecutions = new Set();
        _ProgressiveRegistry_executionCounter.set(this, 0);
        this.abortController = null;
        this.isMounted = false;
        _ProgressiveRegistry_mountGeneration.set(this, 0);
        this.coreToolNames = options.coreToolNames ?? [];
        this.contextAnchor = options.contextAnchor;
        this.routeProvider = options.routeProvider;
        this.maxCandidates = options.maxCandidates ?? 5;
        this.lifecycle = options.lifecycle ?? {};
        this.tokenManager = new CapabilityTokenManager(options.tokenTtlMs ?? 60000);
        // Index full catalog
        for (const tool of options.tools) {
            this.catalog.set(tool.name, tool);
        }
        // Default to CPU-first deterministic scorer if none provided
        this.scorer = options.scorer ?? new DeterministicCpuScorer(options.tools);
    }
    /**
     * Mounts stable surface tools to document.modelContext or fallback target.
     * Keeps surface toolset small and stable (route_tools + execute_capability + core tools).
     * Returns a promise resolving once all registrations are confirmed by the host.
     */
    async mount(modelContext) {
        var _a;
        const hadPreviousMount = this.isMounted || this.abortController !== null;
        this.unmount();
        const currentGen = __classPrivateFieldSet(this, _ProgressiveRegistry_mountGeneration, (_a = __classPrivateFieldGet(this, _ProgressiveRegistry_mountGeneration, "f"), ++_a), "f");
        const currentController = new AbortController();
        this.abortController = currentController;
        this.isMounted = true;
        const surfaceTools = this.buildSurfaceTools();
        if (hadPreviousMount) {
            await this.waitForPreviousSurfaceToDisappear(modelContext, surfaceTools);
            if (currentGen !== __classPrivateFieldGet(this, _ProgressiveRegistry_mountGeneration, "f") || !this.isMounted) {
                return { registeredCount: 0 };
            }
        }
        try {
            await Promise.all(surfaceTools.map((tool) => {
                const result = modelContext.registerTool(this.toModelContextTool(tool), { signal: currentController.signal });
                if (result && typeof result.catch === 'function') {
                    return result.catch((err) => {
                        // Unmount or cancel during registration is normal lifecycle behavior, not an uncaught error
                        if (err instanceof Error && (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort'))) {
                            return undefined;
                        }
                        throw err;
                    });
                }
                return undefined;
            }));
        }
        catch (err) {
            if (err instanceof Error && (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort'))) {
                return { registeredCount: 0 };
            }
            throw err;
        }
        // Guard against race condition: if unmounted while registration was in-flight, cancel immediately
        if (currentGen !== __classPrivateFieldGet(this, _ProgressiveRegistry_mountGeneration, "f") || !this.isMounted) {
            try {
                currentController.abort();
            }
            catch {
                // Ignore abort errors
            }
            return { registeredCount: 0 };
        }
        return { registeredCount: surfaceTools.length };
    }
    async waitForPreviousSurfaceToDisappear(modelContext, surfaceTools) {
        const names = new Set(surfaceTools.map((tool) => tool.name));
        if (names.size === 0)
            return;
        for (let attempt = 0; attempt < 12; attempt += 1) {
            let registeredTools;
            try {
                registeredTools = await modelContext.getTools();
            }
            catch {
                return;
            }
            const hasPreviousSurface = registeredTools.some((tool) => names.has(tool.name));
            if (!hasPreviousSurface)
                return;
            await new Promise((resolve) => setTimeout(resolve, 16));
        }
    }
    toModelContextTool(tool) {
        return {
            name: tool.name,
            title: tool.title ?? tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: {
                readOnlyHint: tool.annotations?.readOnlyHint ?? false,
                untrustedContentHint: tool.annotations?.untrustedContentHint ?? false,
                consequentialHint: tool.annotations?.consequentialHint ?? false,
                debugging: tool.annotations?.debugging ?? false,
            },
            execute: async (inputObject, options) => tool.execute(inputObject, options),
        };
    }
    /**
     * Safely unmounts surface tools.
     * Aligned with WebMCP § 3.1: In-flight executions are allowed to complete gracefully.
     */
    unmount() {
        var _a;
        __classPrivateFieldSet(this, _ProgressiveRegistry_mountGeneration, (_a = __classPrivateFieldGet(this, _ProgressiveRegistry_mountGeneration, "f"), ++_a), "f");
        const inFlightCount = this.inFlightExecutions.size;
        if (this.abortController) {
            try {
                this.abortController.abort();
            }
            catch {
                // Ignore abort errors
            }
            this.abortController = null;
        }
        this.isMounted = false;
        // In-flight executions will complete natural lifecycle without interruption
        return { inFlightCount };
    }
    /**
     * Executes semantic tool discovery query with context anchor injection.
     * Returns top candidates with strongly-bound capability tokens.
     */
    async routeTools(query, options) {
        this.lifecycle.onRouteStart?.(query);
        try {
            const anchor = this.contextAnchor ? this.contextAnchor() : undefined;
            const allTools = Array.from(this.catalog.values());
            const limit = options?.maxResults ?? this.maxCandidates;
            let routed;
            try {
                routed = this.routeProvider
                    ? await this.routeProvider(query, allTools, anchor, { maxResults: limit })
                    : { candidates: await this.scorer.scoreTools(query, allTools, anchor) };
            }
            catch (providerErr) {
                console.warn('[ProgressiveRegistry] routeProvider threw an error, falling back to scorer:', providerErr);
                routed = { candidates: await this.scorer.scoreTools(query, allTools, anchor) };
            }
            const scored = routed && Array.isArray(routed.candidates) && routed.candidates.length > 0
                ? routed.candidates
                : await this.scorer.scoreTools(query, allTools, anchor);
            const topScored = scored.slice(0, limit);
            const candidates = topScored.map((c) => {
                const suggestedArguments = this.resolveSuggestedArguments(c.tool.inputSchema, anchor);
                const token = this.tokenManager.issueToken(c.tool.name, {
                    singleUse: true,
                    scope: c.tool.domain,
                    suggestedArguments,
                });
                return {
                    name: c.tool.name,
                    title: c.tool.title ?? c.tool.name,
                    description: c.tool.description,
                    domain: c.tool.domain,
                    score: c.score,
                    reason: c.reason,
                    annotations: c.tool.annotations,
                    consequentialHint: c.tool.annotations?.consequentialHint ?? false,
                    inputSchema: c.tool.inputSchema,
                    suggestedArguments,
                    capabilityToken: token,
                    token: token.token,
                };
            });
            const result = {
                query,
                anchorContext: anchor,
                ...(routed.metadata ?? {}),
                candidates,
            };
            this.lifecycle.onRouteEnd?.({ candidatesCount: candidates.length }, true);
            return result;
        }
        catch (err) {
            this.lifecycle.onRouteEnd?.(err instanceof Error ? err.message : String(err), false);
            throw err;
        }
    }
    /**
     * Resolves suggested argument values by matching tool inputSchema properties
     * against the application's current Context Anchor (e.g. focusedNodeId -> nodeId, focusedTrackId -> trackId, focusedProductId -> productId).
     */
    resolveSuggestedArguments(inputSchema, anchor) {
        if (!anchor || !inputSchema?.properties || typeof inputSchema.properties !== 'object') {
            return undefined;
        }
        const properties = inputSchema.properties;
        const required = new Set(Array.isArray(inputSchema.required) ? inputSchema.required : []);
        const suggested = {};
        let matchedCount = 0;
        for (const propName of Object.keys(properties)) {
            // Optional selectors are user-controlled filters. Binding one to the current
            // selection would silently narrow a list request and reject an explicit target.
            if (!required.has(propName))
                continue;
            // 1. Direct exact match (e.g. anchor.trackId -> args.trackId)
            if (anchor[propName] !== undefined && anchor[propName] !== null && anchor[propName] !== '') {
                suggested[propName] = anchor[propName];
                matchedCount++;
                continue;
            }
            // 2. Focused/Selected/Active prefix matching (e.g. anchor.focusedNodeId -> args.nodeId)
            const capitalized = propName.charAt(0).toUpperCase() + propName.slice(1);
            const focusedKey = `focused${capitalized}`;
            const selectedKey = `selected${capitalized}`;
            const activeKey = `active${capitalized}`;
            if (anchor[focusedKey] !== undefined && anchor[focusedKey] !== null && anchor[focusedKey] !== '') {
                suggested[propName] = anchor[focusedKey];
                matchedCount++;
            }
            else if (anchor[selectedKey] !== undefined && anchor[selectedKey] !== null && anchor[selectedKey] !== '') {
                suggested[propName] = anchor[selectedKey];
                matchedCount++;
            }
            else if (anchor[activeKey] !== undefined && anchor[activeKey] !== null && anchor[activeKey] !== '') {
                suggested[propName] = anchor[activeKey];
                matchedCount++;
            }
        }
        return matchedCount > 0 ? suggested : undefined;
    }
    /**
     * Issues an ephemeral capability token explicitly bound to toolName.
     */
    issueCapabilityToken(toolName, options) {
        return this.tokenManager.issueToken(toolName, options);
    }
    /**
     * Securely executes a tool using a strongly-bound Capability Token.
     * Enforces token validity, prevents Confused Deputy attacks, and tracks in-flight lifecycle (WebMCP § 3.1).
     */
    async executeCapability(tokenString, toolName, args, options) {
        var _a;
        // 1. Strict token validation and consumption
        const token = this.tokenManager.validateAndConsume(tokenString, toolName);
        // 2. Fetch tool implementation
        const tool = this.catalog.get(token.toolName);
        if (!tool) {
            throw new Error(`Tool "${token.toolName}" is not registered in the catalog.`);
        }
        // 3. Normalize and strictly verify arguments bound to the capability token
        const normalizedArgs = { ...(args || {}) };
        if (token.suggestedArguments) {
            for (const [key, suggestedVal] of Object.entries(token.suggestedArguments)) {
                const rawVal = normalizedArgs[key];
                const isPlaceholder = rawVal === undefined ||
                    rawVal === null ||
                    rawVal === '' ||
                    rawVal === 'current' ||
                    rawVal === 'focused' ||
                    rawVal === 'selected' ||
                    rawVal === 'this' ||
                    rawVal === 'auto';
                if (isPlaceholder && suggestedVal !== undefined && suggestedVal !== null) {
                    normalizedArgs[key] = suggestedVal;
                }
                else if (suggestedVal !== undefined && rawVal !== suggestedVal) {
                    throw new Error(`TOKEN_ARGUMENT_MISMATCH: Argument "${key}" is strictly bound to "${String(suggestedVal)}" by capability token, but received "${String(rawVal)}".`);
                }
            }
        }
        // 4. Validate required schema arguments
        const requiredFields = tool.inputSchema?.required;
        if (Array.isArray(requiredFields)) {
            for (const field of requiredFields) {
                const val = normalizedArgs[field];
                if (val === undefined || val === null || val === '') {
                    throw new Error(`Tool "${toolName}" is missing required argument "${field}".`);
                }
            }
        }
        // 5. In-flight execution tracking (WebMCP § 3.1 Pending tool executions)
        const executionId = `exec_${toolName}_${Date.now()}_${__classPrivateFieldSet(this, _ProgressiveRegistry_executionCounter, (_a = __classPrivateFieldGet(this, _ProgressiveRegistry_executionCounter, "f"), ++_a), "f")}`;
        this.inFlightExecutions.add(executionId);
        const isReadOnly = tool.annotations?.readOnlyHint === true;
        this.lifecycle.onToolStart?.(tool.name, isReadOnly, normalizedArgs);
        const combinedSignals = combineAbortSignals([options?.signal, this.lifecycle.getAbortSignal?.()]);
        try {
            const result = await tool.execute(normalizedArgs, { signal: combinedSignals.signal });
            this.lifecycle.onToolEnd?.(tool.name, result, true);
            return result;
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.lifecycle.onToolEnd?.(tool.name, detail, false);
            throw error;
        }
        finally {
            combinedSignals.dispose();
            this.inFlightExecutions.delete(executionId);
        }
    }
    /**
     * Builds the minimal, stable surface tools permanently exposed to the LLM.
     */
    buildSurfaceTools() {
        const tools = [
            {
                name: 'route_tools',
                title: 'Find available tools',
                description: 'Search available tools by task intent. Returns matching tools along with short-lived capability execution tokens.',
                annotations: { readOnlyHint: true },
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Natural language description of what you want to achieve' },
                        maxResults: { type: 'integer', description: 'Maximum candidates to return (default: 5)' },
                    },
                    required: ['query'],
                },
                execute: async (args) => {
                    const query = args?.query?.trim() || 'core tools';
                    const result = await this.routeTools(query, { maxResults: args?.maxResults });
                    if (!args?.query?.trim()) {
                        return {
                            ...result,
                            warning: 'No query was specified; returned default core tools. For targeted search, please specify route_tools({ query: "task intent" }).',
                        };
                    }
                    return result;
                },
            },
            {
                name: 'execute_capability',
                title: 'Execute a permitted tool',
                description: 'Execute a tool using a valid capability token obtained from route_tools.',
                annotations: { readOnlyHint: false },
                inputSchema: {
                    type: 'object',
                    properties: {
                        token: { type: 'string', description: 'The capability token received from route_tools (also accepts capabilityToken)' },
                        capabilityToken: { type: 'string', description: 'Alias for token' },
                        toolName: { type: 'string', description: 'The exact name of the tool to execute' },
                        arguments: { type: 'object', description: 'Arguments object for the tool' },
                    },
                    required: ['token', 'toolName'],
                },
                execute: async (rawInput, context) => {
                    let args = {};
                    if (typeof rawInput === 'string') {
                        try {
                            args = JSON.parse(rawInput);
                        }
                        catch {
                            args = {};
                        }
                    }
                    else if (typeof rawInput === 'object' && rawInput !== null) {
                        args = rawInput;
                    }
                    const extractTokenStr = (val) => {
                        if (typeof val === 'string')
                            return val.trim();
                        if (typeof val === 'object' && val !== null) {
                            const obj = val;
                            const inner = obj.token ?? obj.capabilityToken ?? obj.capability_token ?? obj.tokenString ?? obj.id;
                            if (typeof inner === 'string')
                                return inner.trim();
                        }
                        return '';
                    };
                    const rawToken = args?.token ??
                        args?.capabilityToken ??
                        args?.capability_token ??
                        args?.tokenString ??
                        args?.token_string ??
                        args?.capToken ??
                        args?.token_id ??
                        args?.id;
                    let token = extractTokenStr(rawToken);
                    const extractToolNameStr = (val) => {
                        if (typeof val === 'string')
                            return val.trim();
                        if (typeof val === 'object' && val !== null) {
                            const obj = val;
                            const inner = obj.toolName ?? obj.tool_name ?? obj.name ?? obj.tool;
                            if (typeof inner === 'string')
                                return inner.trim();
                        }
                        return '';
                    };
                    const rawToolName = args?.toolName ??
                        args?.tool_name ??
                        args?.name ??
                        args?.tool ??
                        args?.action ??
                        args?.target ??
                        args?.targetTool;
                    let toolName = extractToolNameStr(rawToolName);
                    // Resolve arguments
                    let resolvedArgs = {};
                    const explicitArgs = args?.arguments ??
                        args?.args ??
                        args?.parameters ??
                        args?.params ??
                        args?.input ??
                        args?.inputObject ??
                        args?.props ??
                        args?.payload;
                    if (typeof explicitArgs === 'string') {
                        try {
                            resolvedArgs = JSON.parse(explicitArgs);
                        }
                        catch {
                            resolvedArgs = { raw: explicitArgs };
                        }
                    }
                    else if (typeof explicitArgs === 'object' && explicitArgs !== null) {
                        resolvedArgs = { ...explicitArgs };
                    }
                    else {
                        // If no explicit arguments object is present, collect flat arguments
                        const reservedKeys = new Set([
                            'token', 'capabilityToken', 'capability_token', 'tokenString', 'token_string', 'capToken', 'token_id', 'id',
                            'toolName', 'tool_name', 'name', 'tool', 'action', 'target', 'targetTool',
                            'arguments', 'args', 'parameters', 'params', 'input', 'inputObject', 'props', 'payload',
                        ]);
                        for (const [key, value] of Object.entries(args)) {
                            if (!reservedKeys.has(key)) {
                                resolvedArgs[key] = value;
                            }
                        }
                    }
                    // 1. Reverse-lookup toolName from token if toolName was omitted
                    if (!toolName && token) {
                        toolName = this.tokenManager.resolveToolName(token) || '';
                    }
                    // 2. Auto-discover latest valid token for tool if token was omitted
                    if (!token && toolName) {
                        token = this.tokenManager.findLatestValidTokenForTool(toolName) || '';
                    }
                    // 3. Fallback to direct catalog execution if token is absent but tool exists
                    if (!token && toolName && this.catalog.has(toolName)) {
                        console.warn(`[ProgressiveRegistry] Missing token for "${toolName}". Falling back to direct tool execution.`);
                        const directTool = this.catalog.get(toolName);
                        return directTool.execute(resolvedArgs, { signal: context?.signal });
                    }
                    if (!token || !toolName) {
                        throw new Error(`Both token and toolName are required for capability execution. (token: ${token ? 'provided' : 'missing'}, toolName: ${toolName ? 'provided' : 'missing'})`);
                    }
                    return this.executeCapability(token, toolName, resolvedArgs, { signal: context?.signal });
                },
            },
        ];
        // Add stable core tools (e.g. status/read-only tools)
        for (const name of this.coreToolNames) {
            const coreTool = this.catalog.get(name);
            if (coreTool) {
                tools.push(coreTool);
            }
        }
        return tools;
    }
    getIsMounted() {
        return this.isMounted;
    }
    getCatalogSize() {
        return this.catalog.size;
    }
    getActiveInFlightCount() {
        return this.inFlightExecutions.size;
    }
    getTokenManager() {
        return this.tokenManager;
    }
}
_ProgressiveRegistry_executionCounter = new WeakMap(), _ProgressiveRegistry_mountGeneration = new WeakMap();
//# sourceMappingURL=ProgressiveRegistry.js.map