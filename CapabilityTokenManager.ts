/**
 * CapabilityTokenManager
 * 
 * Manages capability tokens for tool execution.
 * Enforces single-use consumption, expiration timestamps, and toolName bindings.
 */

import type { CapabilityToken } from './types';

/**
 * Internal capability record.
 */
interface InternalCapabilityRecord {
    readonly token: string;
    readonly toolName: string;
    readonly issuedAt: number;
    readonly expiresAt: number;
    readonly singleUse: boolean;
    readonly scope?: string;
    readonly suggestedArguments?: Readonly<Record<string, unknown>>;
    used: boolean;
}

/**
 * Recursively deep-freezes an object and all nested structures.
 */
export function deepFreeze<T>(obj: T): Readonly<T> {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    Object.freeze(obj);
    for (const key of Object.getOwnPropertyNames(obj)) {
        const val = (obj as Record<string, unknown>)[key];
        if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
            deepFreeze(val);
        }
    }
    return obj;
}

/**
 * Generates a 32-byte random hex token string using crypto.getRandomValues.
 */
function generateCryptographicToken(): string {
    const bytes = new Uint8Array(32);
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        throw new Error(
            'crypto.getRandomValues is required but unavailable.'
        );
    }
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `cap_${hex}`;
}

export class CapabilityTokenManager {
    /** Private storage inaccessible from outside */
    readonly #vault = new Map<string, InternalCapabilityRecord>();
    /** Map of consumed token -> expiresAt timestamp (TTL-bound tombstone, collected upon expiration) */
    readonly #consumedTokens = new Map<string, number>();
    readonly #defaultTtlMs: number;
    #cleanupTimer: ReturnType<typeof setInterval> | null = null;

    public constructor(defaultTtlMs: number = 60_000) {
        this.#defaultTtlMs = defaultTtlMs;
        // Schedule periodic sweep to prevent memory accumulation from unused expired tokens
        if (typeof setInterval !== 'undefined') {
            this.#cleanupTimer = setInterval(() => {
                this.cleanExpiredTokens();
            }, Math.max(10_000, Math.min(defaultTtlMs, 60_000)));
            // Unref timer in Node environments so it doesn't hold process open
            if (this.#cleanupTimer && typeof (this.#cleanupTimer as { unref?: () => void }).unref === 'function') {
                (this.#cleanupTimer as { unref: () => void }).unref();
            }
        }
    }

    /**
     * Issues a capability token bound to a toolName.
     */
    public issueToken(
        toolName: string,
        options?: {
            ttlMs?: number;
            singleUse?: boolean;
            scope?: string;
            suggestedArguments?: Record<string, unknown>;
        }
    ): CapabilityToken {
        const now = Date.now();
        const ttl = options?.ttlMs ?? this.#defaultTtlMs;
        const tokenString = generateCryptographicToken();

        // Deep-clone and freeze suggestedArguments to prevent mutations
        const clonedArgs = options?.suggestedArguments
            ? (JSON.parse(JSON.stringify(options.suggestedArguments)) as Record<string, unknown>)
            : undefined;
        const frozenArgs = clonedArgs ? deepFreeze(clonedArgs) : undefined;

        const internalRecord: InternalCapabilityRecord = {
            token: tokenString,
            toolName,
            issuedAt: now,
            expiresAt: now + ttl,
            singleUse: options?.singleUse ?? true,
            scope: options?.scope,
            suggestedArguments: frozenArgs,
            used: false,
        };

        this.#vault.set(tokenString, internalRecord);
        this.cleanExpiredTokens(now);

        // Return client token descriptor with frozen cloned arguments
        return {
            token: tokenString,
            toolName,
            issuedAt: now,
            expiresAt: internalRecord.expiresAt,
            singleUse: internalRecord.singleUse,
            scope: internalRecord.scope,
            suggestedArguments: internalRecord.suggestedArguments,
        };
    }

    /**
     * Validates and consumes a capability token for the requested tool.
     */
    public validateAndConsume(tokenString: string, requestedToolName: string): CapabilityToken {
        const now = Date.now();

        // 1. Check if token was already marked as consumed
        if (this.#consumedTokens.has(tokenString)) {
            throw new Error(`TOKEN_ALREADY_USED: Capability token is invalid, expired, or already consumed.`);
        }

        const record = this.#vault.get(tokenString);

        if (!record) {
            this.cleanExpiredTokens(now);
            throw new Error(`Capability token is invalid or expired.`);
        }

        // 2. Check expiration
        if (record.expiresAt < now) {
            this.#vault.delete(tokenString);
            this.cleanExpiredTokens(now);
            throw new Error(`Capability token for "${record.toolName}" has expired.`);
        }

        // 3. Check if already marked used in internal record
        if (record.used) {
            this.#vault.delete(tokenString);
            this.#consumedTokens.set(tokenString, record.expiresAt);
            throw new Error(`TOKEN_ALREADY_USED: Capability token is invalid, expired, or already consumed.`);
        }

        // 4. Check toolName match (Anti-Confused-Deputy)
        if (record.toolName !== requestedToolName) {
            // Immediate revocation upon misuse attempt
            this.#vault.delete(tokenString);
            this.#consumedTokens.set(tokenString, record.expiresAt);
            throw new Error(
                `Security violation: Capability token bound to "${record.toolName}" cannot be used for "${requestedToolName}".`
            );
        }

        // 5. Synchronous mark: used = true BEFORE any asynchronous work begins
        record.used = true;
        if (record.singleUse) {
            this.#vault.delete(tokenString);
            this.#consumedTokens.set(tokenString, record.expiresAt);
        }

        return {
            token: record.token,
            toolName: record.toolName,
            issuedAt: record.issuedAt,
            expiresAt: record.expiresAt,
            singleUse: record.singleUse,
            scope: record.scope,
            suggestedArguments: record.suggestedArguments,
        };
    }

    /**
     * Returns true if token is currently valid without consuming it.
     */
    public peekValid(tokenString: string, toolName?: string): boolean {
        const record = this.#vault.get(tokenString);
        if (!record) return false;
        if (record.used) return false;
        if (record.expiresAt < Date.now()) return false;
        if (toolName && record.toolName !== toolName) return false;
        return true;
    }

    /**
     * Resolves the bound toolName for a currently valid, unused token.
     */
    public resolveToolName(tokenString: string): string | undefined {
        const record = this.#vault.get(tokenString);
        if (!record || record.used || record.expiresAt < Date.now()) {
            return undefined;
        }
        return record.toolName;
    }

    /**
     * Finds the latest valid, unused token string issued for a specific tool.
     */
    public findLatestValidTokenForTool(toolName: string): string | undefined {
        const now = Date.now();
        let latestToken: string | undefined;
        let latestIssuedAt = -1;
        for (const record of this.#vault.values()) {
            if (record.toolName === toolName && !record.used && record.expiresAt > now) {
                if (record.issuedAt > latestIssuedAt) {
                    latestIssuedAt = record.issuedAt;
                    latestToken = record.token;
                }
            }
        }
        return latestToken;
    }

    /**
     * Cleans expired active tokens and expired tombstones to prevent any memory accumulation.
     */
    public cleanExpiredTokens(now: number = Date.now()): void {
        for (const [key, record] of this.#vault.entries()) {
            if (record.expiresAt < now) {
                this.#vault.delete(key);
            }
        }
        for (const [key, expiresAt] of this.#consumedTokens.entries()) {
            if (expiresAt < now) {
                this.#consumedTokens.delete(key);
            }
        }
    }

    /**
     * Revokes all active tokens, clears tombstones, and stops background cleanup.
     */
    public clear(): void {
        this.#vault.clear();
        this.#consumedTokens.clear();
        if (this.#cleanupTimer) {
            clearInterval(this.#cleanupTimer);
            this.#cleanupTimer = null;
        }
    }
}
