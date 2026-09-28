/**
 * DeterministicCpuScorer
 *
 * CPU-based lexical and keyword scorer for tool discovery.
 * Uses token overlap, tags, and context matching without external dependencies or WebGPU.
 */
import type { ScoredToolCandidate, SemanticScorer, WebMcpToolDefinition } from './types';
export declare class DeterministicCpuScorer implements SemanticScorer {
    readonly name = "deterministic-cpu";
    /** Pre-tokenized cache of tool catalog for sub-millisecond lookups */
    private readonly toolIndex;
    constructor(tools?: readonly WebMcpToolDefinition[]);
    indexTools(tools: readonly WebMcpToolDefinition[]): void;
    scoreTools(query: string, tools: readonly WebMcpToolDefinition[], contextAnchor?: Readonly<Record<string, string | number | boolean | null | undefined>>): Promise<readonly ScoredToolCandidate[]>;
    private tokenize;
}
//# sourceMappingURL=DeterministicCpuScorer.d.ts.map