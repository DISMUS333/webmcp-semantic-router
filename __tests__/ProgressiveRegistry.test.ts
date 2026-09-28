/**
 * Comprehensive Unit Tests for @webmcp/progressive
 * 
 * Verifies the 4 critical production contracts:
 * 1. In-flight execution protection on tool unregistration (WebMCP § 3.1 Pending tool executions)
 * 2. Strict token binding, expiration, single-use, and anti-Confused-Deputy enforcement
 * 3. Deterministic CPU ranking without WebGPU
 * 4. Graceful handling of plan execution across unmount / lifecycle events
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    CapabilityTokenManager,
    createProgressiveWebMcpRouter,
    DeterministicCpuScorer,
    ProgressiveRegistry,
    type W3CModelContext,
    type W3CModelContextTool,
    type WebMcpToolDefinition,
    type RouteProvider,
} from '../index';

// Sample test catalog of 15 tools spanning different domains
const createTestCatalog = (): WebMcpToolDefinition[] => [
    {
        name: 'inspect_building_mesh',
        description: 'Inspect vertices, triangles, materials, and bounding box of a 3D building node.',
        tags: ['building', 'inspect', 'mesh', 'geometry'],
        inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] },
        execute: async (args: { nodeId?: string }) => ({ status: 'inspected', nodeId: args.nodeId }),
    },
    {
        name: 'optimize_roof_tiles',
        description: 'Merge and instanced batch roof tiles to reduce draw calls and polygon count.',
        tags: ['roof', 'tiles', 'optimize', 'drawcalls', 'performance'],
        inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] },
        execute: async (args: { nodeId?: string }) => ({ status: 'optimized', nodeId: args.nodeId }),
    },
    {
        name: 'set_material_pbr',
        description: 'Apply realistic PBR materials including plaster, wood, glass, and metal.',
        tags: ['material', 'pbr', 'plaster', 'wood', 'texture'],
        inputSchema: { type: 'object', properties: { material: { type: 'string' } }, required: ['material'] },
        execute: async (args: { material?: string }) => ({ status: 'applied', material: args.material }),
    },
    {
        name: 'reset_stage_camera',
        description: 'Reset viewpoint to standard game perspective or bird-eye view.',
        annotations: { readOnlyHint: true, debugging: true },
        tags: ['camera', 'view', 'reset', 'perspective'],
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({ status: 'camera_reset' }),
    },
    {
        name: 'slow_async_render_task',
        description: 'Simulates a slow 50ms asynchronous rendering pipeline.',
        tags: ['render', 'slow', 'async'],
        inputSchema: { type: 'object', properties: {} },
        execute: async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return { status: 'render_completed' };
        },
    },
    {
        name: 'delete_entire_project',
        description: 'Destructive operation to wipe all data.',
        tags: ['delete', 'wipe', 'danger'],
        annotations: { consequentialHint: true },
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({ status: 'wiped' }),
    },
];

describe('@webmcp/progressive Router Contracts', () => {
    describe('1. In-flight execution protection on unmount (WebMCP § 3.1)', () => {
        it('allows slow async executions to complete gracefully even if registry unmounts', async () => {
            const catalog = createTestCatalog();
            const registry = new ProgressiveRegistry({
                tools: catalog,
                coreToolNames: ['reset_stage_camera'],
            });

            const registeredTools: W3CModelContextTool[] = [];
            const mockContext: W3CModelContext = {
                registerTool: async (tool) => { registeredTools.push(tool); },
                getTools: async () => [],
                executeTool: async () => '',
            };

            // 1. Mount surface tools
            await registry.mount(mockContext);
            expect(registeredTools.length).toBe(3); // route_tools, execute_capability, reset_stage_camera

            // 2. Route and obtain token for slow_async_render_task
            const routeResult = await registry.routeTools('slow render');
            const renderCandidate = routeResult.candidates.find((c) => c.name === 'slow_async_render_task');
            expect(renderCandidate).toBeDefined();
            const token = renderCandidate!.capabilityToken.token;

            // 3. Start execution in-flight
            const executionPromise = registry.executeCapability(token, 'slow_async_render_task', {});

            // Verify execution is currently tracked as in-flight
            expect(registry.getActiveInFlightCount()).toBe(1);

            // 4. Unmount registry while execution is still running
            const unmountResult = registry.unmount();
            expect(unmountResult.inFlightCount).toBe(1);

            // 5. Verify the in-flight execution completes successfully (not cancelled/failed)
            const result = await executionPromise;
            expect(result).toEqual({ status: 'render_completed' });

            // In-flight count returns to 0
            expect(registry.getActiveInFlightCount()).toBe(0);
        });

        it('prevents lingering registrations if unmount is called before async mount completes (React race condition)', async () => {
            const catalog = createTestCatalog();
            const registry = new ProgressiveRegistry({ tools: catalog });

            let aborted = false;
            const mockContext: W3CModelContext = {
                registerTool: async (_tool, options) => {
                    options?.signal?.addEventListener('abort', () => {
                        aborted = true;
                    });
                    // Simulate async host registration delay
                    await new Promise((resolve) => setTimeout(resolve, 20));
                },
                getTools: async () => [],
                executeTool: async () => '',
            };

            // Start mounting asynchronously
            const mountPromise = registry.mount(mockContext);

            // Synchronously unmount before mount completes (simulating React StrictMode or rapid navigation)
            registry.unmount();

            const result = await mountPromise;
            expect(result.registeredCount).toBe(0);
            expect(aborted).toBe(true);
            expect(registry.getIsMounted()).toBe(false);
        });
    });

    describe('2. Strict Token Binding, Expiration & Anti-Confused-Deputy Enforcement', () => {
        it('rejects token reuse when singleUse is true', () => {
            const manager = new CapabilityTokenManager();
            const token = manager.issueToken('inspect_building_mesh', { singleUse: true });

            // First consumption succeeds
            const first = manager.validateAndConsume(token.token, 'inspect_building_mesh');
            expect(first.toolName).toBe('inspect_building_mesh');

            // Second consumption immediately rejected
            expect(() => {
                manager.validateAndConsume(token.token, 'inspect_building_mesh');
            }).toThrowError(/invalid, expired, or already consumed/i);
        });

        it('strictly blocks Confused Deputy attacks (using token for a different tool)', () => {
            const manager = new CapabilityTokenManager();
            // Issue token specifically for safe read operation
            const token = manager.issueToken('inspect_building_mesh');

            // Malicious or accidental attempt to use this token for destructive operation
            expect(() => {
                manager.validateAndConsume(token.token, 'delete_entire_project');
            }).toThrowError(/Security violation: Capability token bound to "inspect_building_mesh" cannot be used for "delete_entire_project"/);

            // Token is immediately revoked after attack attempt
            expect(manager.peekValid(token.token)).toBe(false);
        });

        it('rejects expired tokens', () => {
            const manager = new CapabilityTokenManager();
            // Issue token with 10ms TTL
            const token = manager.issueToken('set_material_pbr', { ttlMs: 5 });

            // Mock passage of time
            vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 50);

            expect(() => {
                manager.validateAndConsume(token.token, 'set_material_pbr');
            }).toThrowError(/has expired/i);

            vi.restoreAllMocks();
        });

        it('generates completely opaque tokens (cap_${hex}) without exposing toolName or metadata', () => {
            const manager = new CapabilityTokenManager();
            const token = manager.issueToken('inspect_building_mesh');

            // 1. Matches opaque 64-char hex format: cap_${64 hex digits} = 256-bit entropy
            expect(token.token).toMatch(/^cap_[0-9a-f]{64}$/);

            // 2. Token string does NOT leak toolName, domain, or timestamp
            expect(token.token).not.toContain('inspect');
            expect(token.token).not.toContain('building');
            expect(token.token).not.toContain('mesh');
        });

        it('actively invokes CSPRNG (crypto.getRandomValues) during token generation', () => {
            const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
            const manager = new CapabilityTokenManager();
            const token = manager.issueToken('reset_stage_camera');

            expect(spy).toHaveBeenCalled();
            expect(token.token).toMatch(/^cap_[0-9a-f]{64}$/);
            spy.mockRestore();
        });

        it('guarantees zero collisions across 1,000 rapid issuances', () => {
            const manager = new CapabilityTokenManager();
            const issuedSet = new Set<string>();
            const count = 1000;

            for (let i = 0; i < count; i++) {
                const token = manager.issueToken('inspect_building_mesh');
                issuedSet.add(token.token);
            }

            expect(issuedSet.size).toBe(count);
        });

        it('enforces ECMAScript #vault runtime encapsulation (inaccessible via reflection or property lookup)', () => {
            const manager = new CapabilityTokenManager();
            const token = manager.issueToken('inspect_building_mesh');

            // TypeScript private would still expose manager.vault at runtime, but #vault is completely inaccessible
            const raw = manager as unknown as Record<string, unknown>;
            expect(raw.vault).toBeUndefined();
            expect(raw['#vault']).toBeUndefined();
            expect(raw.consumedTokens).toBeUndefined();
            expect(raw['#consumedTokens']).toBeUndefined();
            expect(Object.keys(manager)).not.toContain('vault');
            expect(Object.getOwnPropertyNames(manager)).not.toContain('vault');

            // Token can still be validated through official public method
            expect(manager.peekValid(token.token)).toBe(true);
        });

        it('enforces recursive deep-freeze on nested arguments preventing in-memory tampering', () => {
            const manager = new CapabilityTokenManager();
            const originalArgs = {
                config: {
                    nested: {
                        mode: 'safe_preview',
                    },
                },
                tags: ['read_only', 'stage'],
            };

            const token = manager.issueToken('inspect_building_mesh', {
                suggestedArguments: originalArgs,
            });

            // 1. Nested objects and arrays are deeply frozen
            const nestedConfig = token.suggestedArguments?.config as { nested: { mode: string } };
            const tags = token.suggestedArguments?.tags as string[];

            expect(Object.isFrozen(token.suggestedArguments)).toBe(true);
            expect(Object.isFrozen(nestedConfig)).toBe(true);
            expect(Object.isFrozen(nestedConfig.nested)).toBe(true);
            expect(Object.isFrozen(tags)).toBe(true);

            // In strict mode, modifying frozen property throws TypeError
            expect(() => {
                nestedConfig.nested.mode = 'tampered';
            }).toThrow();

            // 2. Modifying originalArgs does NOT affect vault's stored arguments
            originalArgs.config.nested.mode = 'tampered_mode';
            originalArgs.tags.push('malicious_tag');

            const validated = manager.validateAndConsume(token.token, 'inspect_building_mesh');
            const storedConfig = validated.suggestedArguments?.config as { nested: { mode: string } };
            const storedTags = validated.suggestedArguments?.tags as string[];

            expect(storedConfig.nested.mode).toBe('safe_preview');
            expect(storedTags).toEqual(['read_only', 'stage']);
        });

        it('verifies that Math.random is completely absent from CapabilityTokenManager and ProgressiveRegistry', () => {
            const managerPath = path.resolve(__dirname, '../CapabilityTokenManager.ts');
            const registryPath = path.resolve(__dirname, '../ProgressiveRegistry.ts');

            const managerSource = fs.readFileSync(managerPath, 'utf8');
            const registrySource = fs.readFileSync(registryPath, 'utf8');

            expect(managerSource).not.toContain('Math.random');
            expect(registrySource).not.toContain('Math.random');
        });

        it('cleans consumed token tombstones upon expiration preventing unbounded memory accumulation', () => {
            const manager = new CapabilityTokenManager();
            // Issue token with short 10ms TTL
            const token = manager.issueToken('inspect_building_mesh', { ttlMs: 10 });

            // 1. Consume the token: enters tombstone table with expiresAt
            manager.validateAndConsume(token.token, 'inspect_building_mesh');

            // While within TTL, immediate reuse is rejected with TOKEN_ALREADY_USED
            expect(() => {
                manager.validateAndConsume(token.token, 'inspect_building_mesh');
            }).toThrowError(/already consumed/i);

            // 2. Advance time past expiresAt and clean expired tokens
            const futureTime = Date.now() + 50;
            manager.cleanExpiredTokens(futureTime);

            // After expiration & GC, tombstone is removed. Token is rejected as expired/invalid, never accepted
            expect(() => {
                manager.validateAndConsume(token.token, 'inspect_building_mesh');
            }).toThrowError(/invalid or expired/i);
        });
    });

    describe('3. 100% Reproducible Deterministic CPU Ranking (No WebGPU required)', () => {
        it('returns identical ranking order across multiple calls without GPU', async () => {
            const catalog = createTestCatalog();
            const scorer = new DeterministicCpuScorer(catalog);

            const query = 'optimize roof tiles to reduce rendering workload';

            const run1 = await scorer.scoreTools(query, catalog);
            const run2 = await scorer.scoreTools(query, catalog);
            const run3 = await scorer.scoreTools(query, catalog);

            expect(run1.length).toBeGreaterThan(0);
            expect(run1.map((r) => r.tool.name)).toEqual(run2.map((r) => r.tool.name));
            expect(run2.map((r) => r.tool.name)).toEqual(run3.map((r) => r.tool.name));

            // Top candidate must be optimize_roof_tiles
            expect(run1[0].tool.name).toBe('optimize_roof_tiles');
        });

        it('respects minimal ContextAnchor without leaking or scraping', async () => {
            const catalog = createTestCatalog();
            const scorer = new DeterministicCpuScorer(catalog);

            // Query: "inspect" (matches inspect_building_mesh description and tags)
            const ambiguousQuery = 'inspect';

            // Without anchor
            const withoutAnchor = await scorer.scoreTools(ambiguousQuery, catalog);
            expect(withoutAnchor.length).toBeGreaterThan(0);

            // With anchor specifying building node
            const withAnchor = await scorer.scoreTools(ambiguousQuery, catalog, {
                focusedNodeId: 'building-east-01',
                activeTab: 'geometry',
            });

            // The building tool receives anchor match boost
            const buildingCandidate = withAnchor.find((c) => c.tool.name === 'inspect_building_mesh');
            expect(buildingCandidate).toBeDefined();
            expect(buildingCandidate!.reason).toContain('anchor_match');
        });
    });

    describe('4. High-level Façade and Stable Surface Exposure', () => {
        it('exposes minimal stable surface tools (keeps LLM context compact)', async () => {
            const catalog = createTestCatalog();
            const { mount, registry } = createProgressiveWebMcpRouter({
                tools: catalog,
                coreToolNames: ['reset_stage_camera'],
            });

            const registered: string[] = [];
            const mockContext: W3CModelContext = {
                registerTool: async (t) => { registered.push(t.name); },
                getTools: async () => [],
                executeTool: async () => '',
            };

            const result = await mount(mockContext);
            expect(result.registeredCount).toBe(3);
            expect(registered).toEqual(['route_tools', 'execute_capability', 'reset_stage_camera']);
            expect(registry.getCatalogSize()).toBe(catalog.length);
        });

        it('successfully executes dynamic tool through route_tools and execute_capability', async () => {
            const catalog = createTestCatalog();
            const { registry } = createProgressiveWebMcpRouter({ tools: catalog });

            // 1. LLM queries route_tools
            const routed = await registry.routeTools('set wood pbr texture');
            expect(routed.candidates.length).toBeGreaterThan(0);

            const candidate = routed.candidates[0];
            expect(candidate.name).toBe('set_material_pbr');

            // 2. LLM executes execute_capability with received token
            const execResult = await registry.executeCapability(
                candidate.capabilityToken.token,
                candidate.name,
                { material: 'wood' }
            );

            expect(execResult).toEqual({ status: 'applied', material: 'wood' });
        });

        it('supports capabilityToken alias, stringified JSON, flat parameters, and toolName reverse-lookup in surface execute_capability', async () => {
            const catalog = createTestCatalog();
            const { registry } = createProgressiveWebMcpRouter({ tools: catalog });
            const surfaceTools = registry.buildSurfaceTools();
            const executeCapabilityTool = surfaceTools.find((t) => t.name === 'execute_capability')!;
            expect(executeCapabilityTool).toBeDefined();

            // 1. Invocation using capabilityToken alias + arguments object
            const routed1 = await registry.routeTools('set wood pbr texture');
            const candidate1 = routed1.candidates[0];
            const res1 = await executeCapabilityTool.execute({
                capabilityToken: candidate1.token,
                toolName: candidate1.name,
                arguments: { material: 'wood' },
            });
            expect(res1).toEqual({ status: 'applied', material: 'wood' });

            // 2. Omitted toolName (auto reverse-lookup from token) + flat arguments
            const routed2 = await registry.routeTools('set marble pbr texture');
            const candidate2 = routed2.candidates[0];
            const res2 = await executeCapabilityTool.execute({
                token: candidate2.token,
                material: 'marble',
            });
            expect(res2).toEqual({ status: 'applied', material: 'marble' });

            // 3. Invocation with JSON-encoded string payload
            const routed3 = await registry.routeTools('set metal pbr texture');
            const candidate3 = routed3.candidates[0];
            const res3 = await executeCapabilityTool.execute(JSON.stringify({
                capabilityToken: candidate3.token,
                tool_name: candidate3.name,
                args: { material: 'metal' },
            }) as unknown as Record<string, unknown>);
            expect(res3).toEqual({ status: 'applied', material: 'metal' });
        });

        it('keeps an application-owned route provider behind the native route_tools surface', async () => {
            const catalog = createTestCatalog();
            const provider: RouteProvider = vi.fn(async (_query, tools: readonly WebMcpToolDefinition[]) => ({
                candidates: [{
                    tool: tools.find((tool) => tool.name === 'inspect_building_mesh')!,
                    score: 99,
                    reason: 'application-router',
                }],
                metadata: { onDeviceAiUsed: true, routingEngine: 'application' },
            }));
            const { registry } = createProgressiveWebMcpRouter({
                tools: catalog,
                routeProvider: provider,
            });

            const routed = await registry.routeTools('inspect the current building');

            expect(provider).toHaveBeenCalledOnce();
            expect(routed.candidates[0]?.name).toBe('inspect_building_mesh');
            expect(routed.candidates[0]?.reason).toBe('application-router');
            expect(routed.onDeviceAiUsed).toBe(true);
            expect(routed.routingEngine).toBe('application');
        });

        it('preserves required-argument schemas when mounting route_tools onto a native modelContext', async () => {
            // Regression fix: If the native host does not retain inputSchema,
            // external agents mistake route_tools for a zero-argument tool and invoke it empty.
            // Guarantees that complete required argument schemas are supplied at registration.
            const catalog = createTestCatalog();
            const { registry } = createProgressiveWebMcpRouter({
                tools: catalog,
                coreToolNames: ['reset_stage_camera'],
            });

            const registeredByName = new Map<string, W3CModelContextTool>();
            const mockContext: W3CModelContext = {
                registerTool: async (tool) => { registeredByName.set(tool.name, tool); },
                getTools: async () => [],
                executeTool: async () => '',
            };

            await registry.mount(mockContext);

            const routeTools = registeredByName.get('route_tools');
            expect(routeTools).toBeDefined();
            expect(routeTools?.inputSchema).toBeDefined();
            const routeSchema = routeTools?.inputSchema as
                | { properties?: Record<string, { type?: string }>; required?: readonly string[] }
                | undefined;
            expect(routeSchema?.properties?.query).toBeDefined();
            expect(routeSchema?.properties?.query?.type).toBe('string');
            expect(routeSchema?.required).toEqual(['query']);

            const executeCapability = registeredByName.get('execute_capability');
            const executeSchema = executeCapability?.inputSchema as
                | { required?: readonly string[] }
                | undefined;
            expect(executeSchema?.required).toEqual(['token', 'toolName']);

            const resetStageCamera = registeredByName.get('reset_stage_camera');
            expect(resetStageCamera?.annotations?.readOnlyHint).toBe(true);
            expect(resetStageCamera?.annotations?.debugging).toBe(true);
        });

        it('generically binds and normalizes arbitrary domain parameters (DAW trackId & EC productId)', async () => {
            const genericCatalog: WebMcpToolDefinition[] = [
                {
                    name: 'set_track_volume',
                    description: 'Adjust volume fader of a DAW track.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            trackId: { type: 'string' },
                            gainDb: { type: 'number' },
                        },
                        required: ['trackId'],
                    },
                    execute: async (args: { trackId?: string; gainDb?: number }) => ({
                        status: 'volume_set',
                        trackId: args.trackId,
                        gainDb: args.gainDb ?? 0,
                    }),
                },
                {
                    name: 'add_product_to_cart',
                    description: 'Add an e-commerce product to shopping cart.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            productId: { type: 'string' },
                            quantity: { type: 'number' },
                        },
                        required: ['productId'],
                    },
                    execute: async (args: { productId?: string; quantity?: number }) => ({
                        status: 'added_to_cart',
                        productId: args.productId,
                        quantity: args.quantity ?? 1,
                    }),
                },
            ];

            const { registry } = createProgressiveWebMcpRouter({
                tools: genericCatalog,
                contextAnchor: () => ({
                    focusedTrackId: 'vocal-lead-01',
                    focusedProductId: 'item-sneakers-99',
                }),
            });

            // 1. Audio trackId auto-binding and placeholder substitution
            const routedDaw = await registry.routeTools('set volume of current track');
            const trackTool = routedDaw.candidates.find((c) => c.name === 'set_track_volume');
            expect(trackTool).toBeDefined();
            expect(trackTool?.suggestedArguments?.trackId).toBe('vocal-lead-01');

            const dawResult = await registry.executeCapability(
                trackTool!.capabilityToken.token,
                'set_track_volume',
                { trackId: 'current', gainDb: -3 }
            );
            expect(dawResult).toEqual({
                status: 'volume_set',
                trackId: 'vocal-lead-01',
                gainDb: -3,
            });

            // 2. E-commerce productId automatic completion when argument is omitted
            const routedEc = await registry.routeTools('add product to shopping cart');
            const ecTool = routedEc.candidates.find((c) => c.name === 'add_product_to_cart');
            expect(ecTool).toBeDefined();
            expect(ecTool?.suggestedArguments?.productId).toBe('item-sneakers-99');

            const ecResult = await registry.executeCapability(
                ecTool!.capabilityToken.token,
                'add_product_to_cart',
                {} // productId omitted
            );
            expect(ecResult).toEqual({
                status: 'added_to_cart',
                productId: 'item-sneakers-99',
                quantity: 1,
            });
        });

        it('strictly rejects parameter tampering when an explicit mismatched argument is passed (TOKEN_ARGUMENT_MISMATCH)', async () => {
            const genericCatalog: WebMcpToolDefinition[] = [
                {
                    name: 'inspect_building_mesh',
                    description: 'Inspect vertices of a 3D node.',
                    inputSchema: {
                        type: 'object',
                        properties: { nodeId: { type: 'string' } },
                        required: ['nodeId'],
                    },
                    execute: async (args: { nodeId?: string }) => ({ status: 'inspected', nodeId: args.nodeId }),
                },
            ];

            const { registry } = createProgressiveWebMcpRouter({
                tools: genericCatalog,
                contextAnchor: () => ({ focusedNodeId: 'building-pagoda-left' }),
            });

            // 1. Obtain token bound to 'building-pagoda-left'
            const routed = await registry.routeTools('inspect current building');
            const candidate = routed.candidates[0];
            expect(candidate.suggestedArguments?.nodeId).toBe('building-pagoda-left');

            // 2. Caller attempts to redirect execution to 'another-building-99'
            await expect(
                registry.executeCapability(
                    candidate.capabilityToken.token,
                    'inspect_building_mesh',
                    { nodeId: 'another-building-99' } // Mismatched argument
                )
            ).rejects.toThrowError(/TOKEN_ARGUMENT_MISMATCH: Argument "nodeId" is strictly bound to "building-pagoda-left" by capability token, but received "another-building-99"/);
        });

        it('does not bind optional filters to the currently focused node', async () => {
            const { registry } = createProgressiveWebMcpRouter({
                tools: [{
                    name: 'inspect_rig',
                    description: 'Inspect all joints or filter by node name.',
                    inputSchema: {
                        type: 'object',
                        properties: { nodeName: { type: 'string' } },
                    },
                    execute: async (args: { nodeName?: string }) => ({ nodeName: args.nodeName ?? null }),
                }],
                contextAnchor: () => ({ focusedNodeName: 'SelectedStageObject' }),
            });

            const all = (await registry.routeTools('inspect all joints')).candidates[0];
            expect(all.suggestedArguments).toBeUndefined();
            expect(await registry.executeCapability(all.token, 'inspect_rig', {})).toEqual({ nodeName: null });

            const filtered = (await registry.routeTools('inspect one joint')).candidates[0];
            expect(await registry.executeCapability(filtered.token, 'inspect_rig', { nodeName: 'LeftHip' }))
                .toEqual({ nodeName: 'LeftHip' });
        });
    });
});
