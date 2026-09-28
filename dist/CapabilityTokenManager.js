/**
 * CapabilityTokenManager
 *
 * Manages capability tokens for tool execution.
 * Enforces single-use consumption, expiration timestamps, and toolName bindings.
 */
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _CapabilityTokenManager_vault, _CapabilityTokenManager_consumedTokens, _CapabilityTokenManager_defaultTtlMs, _CapabilityTokenManager_cleanupTimer;
/**
 * Recursively deep-freezes an object and all nested structures.
 */
export function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    Object.freeze(obj);
    for (const key of Object.getOwnPropertyNames(obj)) {
        const val = obj[key];
        if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
            deepFreeze(val);
        }
    }
    return obj;
}
/**
 * Generates a 32-byte random hex token string using crypto.getRandomValues.
 */
function generateCryptographicToken() {
    const bytes = new Uint8Array(32);
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
    }
    else {
        throw new Error('crypto.getRandomValues is required but unavailable.');
    }
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `cap_${hex}`;
}
export class CapabilityTokenManager {
    constructor(defaultTtlMs = 60000) {
        /** Private storage inaccessible from outside */
        _CapabilityTokenManager_vault.set(this, new Map());
        /** Map of consumed token -> expiresAt timestamp (TTL-bound tombstone, collected upon expiration) */
        _CapabilityTokenManager_consumedTokens.set(this, new Map());
        _CapabilityTokenManager_defaultTtlMs.set(this, void 0);
        _CapabilityTokenManager_cleanupTimer.set(this, null);
        __classPrivateFieldSet(this, _CapabilityTokenManager_defaultTtlMs, defaultTtlMs, "f");
        // Schedule periodic sweep to prevent memory accumulation from unused expired tokens
        if (typeof setInterval !== 'undefined') {
            __classPrivateFieldSet(this, _CapabilityTokenManager_cleanupTimer, setInterval(() => {
                this.cleanExpiredTokens();
            }, Math.max(10000, Math.min(defaultTtlMs, 60000))), "f");
            // Unref timer in Node environments so it doesn't hold process open
            if (__classPrivateFieldGet(this, _CapabilityTokenManager_cleanupTimer, "f") && typeof __classPrivateFieldGet(this, _CapabilityTokenManager_cleanupTimer, "f").unref === 'function') {
                __classPrivateFieldGet(this, _CapabilityTokenManager_cleanupTimer, "f").unref();
            }
        }
    }
    /**
     * Issues a capability token bound to a toolName.
     */
    issueToken(toolName, options) {
        const now = Date.now();
        const ttl = options?.ttlMs ?? __classPrivateFieldGet(this, _CapabilityTokenManager_defaultTtlMs, "f");
        const tokenString = generateCryptographicToken();
        // Deep-clone and freeze suggestedArguments to prevent mutations
        const clonedArgs = options?.suggestedArguments
            ? JSON.parse(JSON.stringify(options.suggestedArguments))
            : undefined;
        const frozenArgs = clonedArgs ? deepFreeze(clonedArgs) : undefined;
        const internalRecord = {
            token: tokenString,
            toolName,
            issuedAt: now,
            expiresAt: now + ttl,
            singleUse: options?.singleUse ?? true,
            scope: options?.scope,
            suggestedArguments: frozenArgs,
            used: false,
        };
        __classPrivateFieldGet(this, _CapabilityTokenManager_vault, "f").set(tokenString, internalRecord);
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
    validateAndConsume(tokenString, requestedToolName) {
        const now = Date.now();
        // 1. Check if token was already marked as consumed
        if (__classPrivateFieldGet(this, _CapabilityTokenManager_consumedTokens, "f").has(tokenString)) {
            throw new Error(`TOKEN_ALREADY_USED: Capability token is invalid, expired, or already consumed.`);
        }
        const record = __classPrivateFieldGet(this, _CapabilityTokenManager_vault, "f").get(tokenString);
        if (!record) {
            this.cleanExpiredTokens(now);
            throw new Error(`Capability token is invalid or expired.`);
        }
        // 2. Check expiration
        if (record.expiresAt < now) {
            __classPrivateFieldGet(this, _CapabilityTokenManager_vault, "f").delete(tokenString);
            this.cleanExpiredTokens(now);
            throw new Error(`Capability token for "${record.toolName}" has expired.`);
        }
        // 3. Check if already marked used in internal record
        if (record.used) {
            __classPrivateFieldGet(this, _CapabilityTokenManager_vault, "f").delete(tokenString);
            __classPrivateFieldGet(this, _CapabilityTokenManager_consumedTokens, "f").set(tokenString, record.expiresAt);
            throw new Error(`TOKEN_ALREADY_USED: Capability token is invalid, expired, or already consumed.`);
        }
        // 4. Check toolName match (Anti-Confused-Deputy)
        if (record.toolName !== requestedToolName) {
            // Immediate revocation upon misuse attempt
            __classPrivateFieldGet(this, _CapabilityTokenManager_vault, "f").delete(tokenString);
            __classPrivateFieldGet(this, _CapabilityTokenManager_consumedTokens, "f").set(tokenString, record.expiresAt);
            throw new Error(`Security violation: Capability token bound to "${record.toolName}" cannot be used for "${requestedToolName}".`);
        }
        // 5. Synchronous mark: used = true BEFORE any asynchronous work begins
        record.used = true;
        if (record.singleUse) {
            __classPrivateFieldGet(this, _CapabilityTokenManager_vault, "f").delete(tokenString);
            __classPrivateFieldGet(this, _CapabilityTokenManager_consumedTokens, "f").set(tokenString, record.expiresAt);
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
    peekValid(tokenString, toolName) {
        const record = __classPrivateFieldGet(this, _CapabilityTokenManager_vault, "f").get(tokenString);
        if (!record)
            return false;
        if (record.used)
            return false;
        if (record.expiresAt < Date.now())
            return false;
        if (toolName && record.toolName !== toolName)
            return false;
        return true;
    }
    /**
     * Resolves the bound toolName for a currently valid, unused token.
     */
    resolveToolName(tokenString) {
        const record = __classPrivateFieldGet(this, _CapabilityTokenManager_vault, "f").get(tokenString);
        if (!record || record.used || record.expiresAt < Date.now()) {
            return undefined;
        }
        return record.toolName;
    }
    /**
     * Finds the latest valid, unused token string issued for a specific tool.
     */
    findLatestValidTokenForTool(toolName) {
        const now = Date.now();
        let latestToken;
        let latestIssuedAt = -1;
        for (const record of __classPrivateFieldGet(this, _CapabilityTokenManager_vault, "f").values()) {
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
    cleanExpiredTokens(now = Date.now()) {
        for (const [key, record] of __classPrivateFieldGet(this, _CapabilityTokenManager_vault, "f").entries()) {
            if (record.expiresAt < now) {
                __classPrivateFieldGet(this, _CapabilityTokenManager_vault, "f").delete(key);
            }
        }
        for (const [key, expiresAt] of __classPrivateFieldGet(this, _CapabilityTokenManager_consumedTokens, "f").entries()) {
            if (expiresAt < now) {
                __classPrivateFieldGet(this, _CapabilityTokenManager_consumedTokens, "f").delete(key);
            }
        }
    }
    /**
     * Revokes all active tokens, clears tombstones, and stops background cleanup.
     */
    clear() {
        __classPrivateFieldGet(this, _CapabilityTokenManager_vault, "f").clear();
        __classPrivateFieldGet(this, _CapabilityTokenManager_consumedTokens, "f").clear();
        if (__classPrivateFieldGet(this, _CapabilityTokenManager_cleanupTimer, "f")) {
            clearInterval(__classPrivateFieldGet(this, _CapabilityTokenManager_cleanupTimer, "f"));
            __classPrivateFieldSet(this, _CapabilityTokenManager_cleanupTimer, null, "f");
        }
    }
}
_CapabilityTokenManager_vault = new WeakMap(), _CapabilityTokenManager_consumedTokens = new WeakMap(), _CapabilityTokenManager_defaultTtlMs = new WeakMap(), _CapabilityTokenManager_cleanupTimer = new WeakMap();
//# sourceMappingURL=CapabilityTokenManager.js.map