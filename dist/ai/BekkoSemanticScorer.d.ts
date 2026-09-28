/**
 * BekkoSemanticScorer (@webmcp/progressive/ai)
 *
 * Generic on-device AI semantic scorer combining dense multilingual vector embeddings
 * (via hotchpotch/bekko-embedding-v1-a8m on WebGPU/Wasm) with sparse CPU heuristic search.
 *
 * Complies with 2026 browser Cache API standards and Storage Persistence API.
 */
import type { ScoredToolCandidate, SemanticScorer, WebMcpToolDefinition } from '../types';
import type { BekkoScorerOptions, VectorSearchResult } from './types';
export declare class BekkoSemanticScorer implements SemanticScorer {
    readonly name = "bekko-multilingual-a8m-hybrid";
    private readonly cpuScorer;
    private readonly options;
    private extractor;
    private initPromise;
    private isPipelineReady;
    constructor(tools: readonly WebMcpToolDefinition[], options?: BekkoScorerOptions);
    /**
     * Ensures browser storage persistence to prevent Cache API eviction.
     */
    private requestStoragePersistence;
    /**
     * Initializes the Transformers.js feature extraction pipeline.
     */
    initializePipeline(): Promise<boolean>;
    /**
     * Compute cosine similarity between two normalized vectors.
     */
    static computeCosineSimilarity(a: readonly number[], b: readonly number[]): number;
    /**
     * Encodes a query string into a dense embedding vector using on-device WebGPU pipeline.
     */
    embedQuery(query: string): Promise<readonly number[] | null>;
    /**
     * Searches precomputed tool embeddings by query vector similarity.
     */
    searchSimilarTools(query: string, limit?: number): Promise<readonly VectorSearchResult[]>;
    /**
     * Scores all tool candidates using a Dense + Sparse Hybrid Ensemble.
     */
    scoreTools(query: string, tools: readonly WebMcpToolDefinition[], contextAnchor?: Readonly<Record<string, string | number | boolean | null | undefined>>): Promise<readonly ScoredToolCandidate[]>;
}
//# sourceMappingURL=BekkoSemanticScorer.d.ts.map