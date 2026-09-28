/**
 * @webmcp/progressive/ai - Types
 *
 * Configuration interfaces and data structures for on-device AI semantic scoring.
 */
import type { ScoredToolCandidate, SemanticScorer, WebMcpToolDefinition } from '../types';
export interface BekkoScorerOptions {
    /**
     * Hugging Face model repository ID.
     * Default: 'hotchpotch/bekko-embedding-v1-a8m'
     */
    readonly modelId?: string;
    /**
     * Optional custom host URL for model assets (e.g. self-hosted CDN or local public assets).
     * When omitted, defaults to official Hugging Face Hub.
     * Example: 'https://cdn.example.com/models/' or '/models/'
     */
    readonly modelHostUrl?: string;
    /**
     * Whether to use the browser's Cache API for persistent model storage.
     * Default: true
     */
    readonly useCache?: boolean;
    /**
     * Whether to automatically request storage persistence via `navigator.storage.persist()`
     * to prevent browser eviction during low-disk situations.
     * Default: true
     */
    readonly autoPersistStorage?: boolean;
    /**
     * Precomputed embedding vectors for static tools.
     * Maps tool names to 256-dimensional (or N-dimensional) normalized float arrays.
     */
    readonly precomputedEmbeddings?: Readonly<Record<string, readonly number[]>>;
    /**
     * Weight given to the on-device dense vector similarity score [0.0 - 1.0].
     * The remaining weight (1.0 - denseWeight) is assigned to sparse CPU scoring.
     * Default: 0.5
     */
    readonly denseWeight?: number;
    /**
     * Device execution provider preference: 'webgpu', 'wasm', or 'cpu'.
     * Default: 'webgpu' (automatically falls back to wasm/cpu if WebGPU is unsupported).
     */
    readonly device?: 'webgpu' | 'wasm' | 'cpu';
}
export interface VectorSearchResult {
    readonly toolName: string;
    readonly similarity: number;
}
export interface OnDeviceEmbeddingExtractor {
    (query: string, options?: {
        pooling?: string;
        normalize?: boolean;
    }): Promise<{
        readonly data: Float32Array | number[];
    }>;
}
export type { ScoredToolCandidate, SemanticScorer, WebMcpToolDefinition, };
//# sourceMappingURL=types.d.ts.map