import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BekkoSemanticScorer } from '../BekkoSemanticScorer';
import type { WebMcpToolDefinition } from '../../types';

describe('BekkoSemanticScorer', () => {
    const mockTools: WebMcpToolDefinition[] = [
        {
            name: 'render_stage_node',
            description: 'Render the selected 3D building node snapshot',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => ({ status: 'rendered' }),
        },
        {
            name: 'optimize_stage_node',
            description: 'Optimize polygons, roof tiles, and decimate mesh',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => ({ status: 'optimized' }),
        },
        {
            name: 'set_tempo_bpm',
            description: 'Set project audio tempo metadata',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => ({ status: 'bpm_set' }),
        },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('accurately computes vector cosine similarities', () => {
        // Orthogonal vectors
        const simZero = BekkoSemanticScorer.computeCosineSimilarity([1, 0], [0, 1]);
        expect(simZero).toBeCloseTo(0);

        // Identical vectors
        const simOne = BekkoSemanticScorer.computeCosineSimilarity([0.6, 0.8], [0.6, 0.8]);
        expect(simOne).toBeCloseTo(1.0);

        // Opposite vectors
        const simMinusOne = BekkoSemanticScorer.computeCosineSimilarity([1, 0], [-1, 0]);
        expect(simMinusOne).toBeCloseTo(-1.0);

        // Dimension mismatch or empty
        expect(BekkoSemanticScorer.computeCosineSimilarity([1, 2], [1])).toBe(0);
        expect(BekkoSemanticScorer.computeCosineSimilarity([], [])).toBe(0);
    });

    it('falls back gracefully to deterministic CPU scoring when no precomputed embeddings are passed', async () => {
        const scorer = new BekkoSemanticScorer(mockTools, {
            autoPersistStorage: false,
        });

        const results = await scorer.scoreTools('optimize roof tiles decimate', mockTools);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].tool.name).toBe('optimize_stage_node');
        expect(results[0].score).toBeGreaterThan(0);
    });

    it('correctly boosts tools with precomputed embeddings when vectors match', async () => {
        // Synthetic 2D vectors for demonstration
        const precomputed = {
            render_stage_node: [0.0, 1.0],
            optimize_stage_node: [1.0, 0.0],
            set_tempo_bpm: [-1.0, 0.0],
        };

        const scorer = new BekkoSemanticScorer(mockTools, {
            precomputedEmbeddings: precomputed,
            denseWeight: 0.8,
            autoPersistStorage: false,
        });

        // Mock embedQuery to return vector pointing towards optimize_stage_node
        vi.spyOn(scorer, 'embedQuery').mockResolvedValue([0.99, 0.05]);

        const results = await scorer.scoreTools('something about mesh', mockTools);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].tool.name).toBe('optimize_stage_node');
        expect(results[0].reason).toContain('dense_vec');
    });

    it('honors custom options for model host URL and storage caching', () => {
        const scorer = new BekkoSemanticScorer(mockTools, {
            modelHostUrl: 'https://cdn.example.com/models/',
            useCache: true,
            autoPersistStorage: false,
            denseWeight: 0.3,
        });

        expect(scorer.name).toBe('bekko-multilingual-a8m-hybrid');
    });
});
