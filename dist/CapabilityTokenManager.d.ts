/**
 * CapabilityTokenManager
 *
 * Manages capability tokens for tool execution.
 * Enforces single-use consumption, expiration timestamps, and toolName bindings.
 */
import type { CapabilityToken } from './types';
/**
 * Recursively deep-freezes an object and all nested structures.
 */
export declare function deepFreeze<T>(obj: T): Readonly<T>;
export declare class CapabilityTokenManager {
    #private;
    constructor(defaultTtlMs?: number);
    /**
     * Issues a capability token bound to a toolName.
     */
    issueToken(toolName: string, options?: {
        ttlMs?: number;
        singleUse?: boolean;
        scope?: string;
        suggestedArguments?: Record<string, unknown>;
    }): CapabilityToken;
    /**
     * Validates and consumes a capability token for the requested tool.
     */
    validateAndConsume(tokenString: string, requestedToolName: string): CapabilityToken;
    /**
     * Returns true if token is currently valid without consuming it.
     */
    peekValid(tokenString: string, toolName?: string): boolean;
    /**
     * Resolves the bound toolName for a currently valid, unused token.
     */
    resolveToolName(tokenString: string): string | undefined;
    /**
     * Finds the latest valid, unused token string issued for a specific tool.
     */
    findLatestValidTokenForTool(toolName: string): string | undefined;
    /**
     * Cleans expired active tokens and expired tombstones to prevent any memory accumulation.
     */
    cleanExpiredTokens(now?: number): void;
    /**
     * Revokes all active tokens, clears tombstones, and stops background cleanup.
     */
    clear(): void;
}
//# sourceMappingURL=CapabilityTokenManager.d.ts.map