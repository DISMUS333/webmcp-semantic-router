/**
 * BekkoSemanticScorer (@webmcp/progressive/ai)
 * 
 * Generic on-device AI semantic scorer combining dense multilingual vector embeddings
 * (via hotchpotch/bekko-embedding-v1-a8m on WebGPU/Wasm) with sparse CPU heuristic search.
 * 
 * Complies with 2026 browser Cache API standards and Storage Persistence API.
 */

import { DeterministicCpuScorer } from '../DeterministicCpuScorer';
import type {
    ScoredToolCandidate,
    SemanticScorer,
    WebMcpToolDefinition,
} from '../types';
import type {
    BekkoScorerOptions,
    OnDeviceEmbeddingExtractor,
    VectorSearchResult,
} from './types';

export class BekkoSemanticScorer implements SemanticScorer {
    public readonly name = 'bekko-multilingual-a8m-hybrid';
    private readonly cpuScorer: DeterministicCpuScorer;
    private readonly options: Required<Omit<BekkoScorerOptions, 'modelHostUrl' | 'precomputedEmbeddings'>> & {
        readonly modelHostUrl?: string;
        readonly precomputedEmbeddings?: Readonly<Record<string, readonly number[]>>;
    };

    private extractor: OnDeviceEmbeddingExtractor | null = null;
    private initPromise: Promise<boolean> | null = null;
    private isPipelineReady = false;

    public constructor(
        tools: readonly WebMcpToolDefinition[],
        options: BekkoScorerOptions = {}
    ) {
        this.cpuScorer = new DeterministicCpuScorer(tools);
        this.options = {
            modelId: options.modelId ?? 'hotchpotch/bekko-embedding-v1-a8m',
            modelHostUrl: options.modelHostUrl,
            useCache: options.useCache ?? true,
            autoPersistStorage: options.autoPersistStorage ?? true,
            precomputedEmbeddings: options.precomputedEmbeddings,
            denseWeight: Math.max(0, Math.min(1, options.denseWeight ?? 0.5)),
            device: options.device ?? 'webgpu',
        };

        if (typeof window !== 'undefined') {
            this.requestStoragePersistence();
            // Lazy background initialization
            void this.initializePipeline();
        }
    }

    /**
     * Ensures browser storage persistence to prevent Cache API eviction.
     */
    private requestStoragePersistence(): void {
        if (!this.options.autoPersistStorage) return;
        if (typeof navigator !== 'undefined' && 'storage' in navigator && typeof navigator.storage.persist === 'function') {
            navigator.storage.persist().catch(() => {
                // Ignore storage permission or persistence denial
            });
        }
    }

    /**
     * Initializes the Transformers.js feature extraction pipeline.
     */
    public async initializePipeline(): Promise<boolean> {
        if (this.isPipelineReady) return true;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                const { pipeline, env } = await import('@huggingface/transformers');

                if (typeof window !== 'undefined') {
                    env.useBrowserCache = this.options.useCache;
                    if (this.options.modelHostUrl) {
                        env.remoteHost = this.options.modelHostUrl;
                    }
                }

                // Attempt preferred device (webgpu), fallback cleanly if unsupported
                try {
                    const pipe = await pipeline('feature-extraction', this.options.modelId, {
                        device: this.options.device,
                    });
                    this.extractor = pipe as unknown as OnDeviceEmbeddingExtractor;
                    this.isPipelineReady = true;
                    return true;
                } catch {
                    // Fallback to wasm/cpu execution provider
                    const fallbackPipe = await pipeline('feature-extraction', this.options.modelId, {
                        device: 'wasm',
                    });
                    this.extractor = fallbackPipe as unknown as OnDeviceEmbeddingExtractor;
                    this.isPipelineReady = true;
                    return true;
                }
            } catch {
                // Graceful fallback to pure CPU scoring if transformers or network is unavailable
                this.isPipelineReady = false;
                return false;
            }
        })();

        return this.initPromise;
    }

    /**
     * Compute cosine similarity between two normalized vectors.
     */
    public static computeCosineSimilarity(a: readonly number[], b: readonly number[]): number {
        if (a.length !== b.length || a.length === 0) return 0;
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            const ai = a[i];
            const bi = b[i];
            dot += ai * bi;
            normA += ai * ai;
            normB += bi * bi;
        }
        if (normA <= 0 || normB <= 0) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Encodes a query string into a dense embedding vector using on-device WebGPU pipeline.
     */
    public async embedQuery(query: string): Promise<readonly number[] | null> {
        if (!this.isPipelineReady || !this.extractor) {
            const ok = await this.initializePipeline();
            if (!ok || !this.extractor) return null;
        }

        try {
            const output = await this.extractor(query, {
                pooling: 'mean',
                normalize: true,
            });
            return Array.from(output.data);
        } catch {
            return null;
        }
    }

    /**
     * Searches precomputed tool embeddings by query vector similarity.
     */
    public async searchSimilarTools(
        query: string,
        limit = 20
    ): Promise<readonly VectorSearchResult[]> {
        if (!this.options.precomputedEmbeddings) {
            return [];
        }

        const queryVec = await this.embedQuery(query);
        if (!queryVec) return [];

        const results: VectorSearchResult[] = [];
        for (const [toolName, vec] of Object.entries(this.options.precomputedEmbeddings)) {
            const similarity = BekkoSemanticScorer.computeCosineSimilarity(queryVec, vec);
            results.push({ toolName, similarity });
        }

        results.sort((a, b) => b.similarity - a.similarity);
        return results.slice(0, limit);
    }

    /**
     * Scores all tool candidates using a Dense + Sparse Hybrid Ensemble.
     */
    public async scoreTools(
        query: string,
        tools: readonly WebMcpToolDefinition[],
        contextAnchor?: Readonly<Record<string, string | number | boolean | null | undefined>>
    ): Promise<readonly ScoredToolCandidate[]> {
        // 1. Sparse CPU Heuristics Scoring
        const cpuCandidates = await this.cpuScorer.scoreTools(query, tools, contextAnchor);
        const candidateMap = new Map<string, { tool: WebMcpToolDefinition; score: number; reasons: string[] }>();

        for (const c of cpuCandidates) {
            candidateMap.set(c.tool.name, {
                tool: c.tool,
                score: c.score,
                reasons: [c.reason],
            });
        }

        for (const tool of tools) {
            if (!candidateMap.has(tool.name)) {
                candidateMap.set(tool.name, {
                    tool,
                    score: 0,
                    reasons: [],
                });
            }
        }

        // 2. Dense Vector Semantic Blend (if embeddings and pipeline are active)
        if (this.options.precomputedEmbeddings) {
            try {
                const vectorResults = await this.searchSimilarTools(query, 30);
                const denseWeightFactor = this.options.denseWeight * 100;

                for (const res of vectorResults) {
                    const item = candidateMap.get(res.toolName);
                    if (item && res.similarity > 0.1) {
                        const vecBoost = Math.round(res.similarity * denseWeightFactor);
                        item.score += vecBoost;
                        item.reasons.push(`dense_vec(${res.similarity.toFixed(2)})`);
                    }
                }
            } catch {
                // Graceful fallback to pure CPU score
            }
        }

        // 3. Filter and Sort
        return Array.from(candidateMap.values())
            .filter((c) => c.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((c) => ({
                tool: c.tool,
                score: c.score,
                reason: c.reasons.filter(Boolean).join(' + ') || 'heuristic',
            }));
    }
}
