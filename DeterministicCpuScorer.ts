/**
 * DeterministicCpuScorer
 * 
 * CPU-based lexical and keyword scorer for tool discovery.
 * Uses token overlap, tags, and context matching without external dependencies or WebGPU.
 */

import type { ScoredToolCandidate, SemanticScorer, WebMcpToolDefinition } from './types';

export class DeterministicCpuScorer implements SemanticScorer {
    public readonly name = 'deterministic-cpu';

    /** Pre-tokenized cache of tool catalog for sub-millisecond lookups */
    private readonly toolIndex = new Map<string, {
        nameTokens: Set<string>;
        descTokens: Set<string>;
        tags: Set<string>;
    }>();

    public constructor(tools?: readonly WebMcpToolDefinition[]) {
        if (tools) {
            this.indexTools(tools);
        }
    }

    public indexTools(tools: readonly WebMcpToolDefinition[]): void {
        this.toolIndex.clear();
        for (const tool of tools) {
            this.toolIndex.set(tool.name, {
                nameTokens: new Set(this.tokenize(tool.name)),
                descTokens: new Set(this.tokenize(tool.description)),
                tags: new Set((tool.tags ?? []).map((t) => t.toLowerCase())),
            });
        }
    }

    public async scoreTools(
        query: string,
        tools: readonly WebMcpToolDefinition[],
        contextAnchor?: Readonly<Record<string, string | number | boolean | null | undefined>>
    ): Promise<readonly ScoredToolCandidate[]> {
        // Enrich query with minimal context anchor if present (e.g. focused node ID, active view)
        let enrichedQuery = query;
        if (contextAnchor) {
            const anchorHints: string[] = [];
            for (const [key, value] of Object.entries(contextAnchor)) {
                if (value !== null && value !== undefined && value !== '') {
                    anchorHints.push(`${key}:${String(value)}`);
                }
            }
            if (anchorHints.length > 0) {
                enrichedQuery = `${query} [${anchorHints.join(' ')}]`;
            }
        }

        const queryTokens = new Set(this.tokenize(enrichedQuery));
        const queryLower = enrichedQuery.toLowerCase();

        const candidates: ScoredToolCandidate[] = [];

        for (const tool of tools) {
            let entry = this.toolIndex.get(tool.name);
            if (!entry) {
                entry = {
                    nameTokens: new Set(this.tokenize(tool.name)),
                    descTokens: new Set(this.tokenize(tool.description)),
                    tags: new Set((tool.tags ?? []).map((t) => t.toLowerCase())),
                };
                this.toolIndex.set(tool.name, entry);
            }

            let score = 0;
            const matchReasons: string[] = [];

            // 1. Exact name match or substring match (Highest weight)
            const nameLower = tool.name.toLowerCase();
            if (queryLower.includes(nameLower)) {
                score += 100;
                matchReasons.push('exact_name');
            }

            // 2. Tag match
            let tagHits = 0;
            for (const tag of entry.tags) {
                if (queryLower.includes(tag)) {
                    tagHits++;
                    score += 25;
                }
            }
            if (tagHits > 0) {
                matchReasons.push(`tags(${tagHits})`);
            }

            // 3. Name token overlap
            let nameOverlap = 0;
            for (const token of entry.nameTokens) {
                if (queryTokens.has(token)) {
                    nameOverlap++;
                    score += 15;
                }
            }
            if (nameOverlap > 0) {
                matchReasons.push(`name_tokens(${nameOverlap})`);
            }

            // 4. Description token Jaccard similarity
            let descOverlap = 0;
            for (const token of entry.descTokens) {
                if (queryTokens.has(token)) {
                    descOverlap++;
                    score += 3;
                }
            }
            if (descOverlap > 0) {
                matchReasons.push(`desc_overlap(${descOverlap})`);
            }

            // 5. Context anchor relevance boost
            if (contextAnchor) {
                for (const value of Object.values(contextAnchor)) {
                    const strVal = String(value).toLowerCase();
                    if (strVal && (nameLower.includes(strVal) || entry.tags.has(strVal))) {
                        score += 30;
                        matchReasons.push('anchor_match');
                        break;
                    }
                }
            }

            if (score > 0) {
                candidates.push({
                    tool,
                    score,
                    reason: matchReasons.join(', ') || 'lexical_match',
                });
            }
        }

        // Sort descending by score, deterministic tie-breaking by tool name
        candidates.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.tool.name.localeCompare(b.tool.name);
        });

        return candidates;
    }

    private tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .split(/[\s_\-./,;:[\]()'"=+*&^%$#@!~`?<>]+/)
            .filter((t) => t.length > 1);
    }
}
