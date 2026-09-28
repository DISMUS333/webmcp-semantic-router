# webmcp-semantic-router

A capability-scoped tool router for the W3C WebMCP draft specification.

It addresses common integration challenges when exposing large tool catalogs to in-browser agents:
- **Reduces prompt size**: Exposes only `route_tools` and `execute_capability` to the agent instead of registering dozens of tool schemas simultaneously.
- **Decouples tool discovery from execution**: Aligns with [WebMCP Draft Specification (§ 3.1 Pending tool executions)](https://webmachinelearning.github.io/webmcp/#pending-tool-executions); unregistering tools on view changes does not forcibly abort operations already in progress.
- **Scopes tool execution**: Issues short-lived, single-use capability tokens bound to specific tool names.
- **Flexible Semantic Routing**: Supports on-device multilingual vector search via `webmcp-semantic-router/ai` to handle natural language query variations, with a deterministic CPU keyword scorer as an automatic zero-dependency fallback.

---

## How It Works

Instead of registering an entire application tool catalog directly on `document.modelContext`, the router exposes two surface tools:

1. `route_tools(query)`: Scans the internal catalog and returns relevant candidates along with an ephemeral capability token.
2. `execute_capability(token, toolName, args)`: Validates the token and invokes the requested tool.

```
[Agent] -- (1) route_tools({ query }) ---------------------> [Router]
[Agent] <-- (candidate tools + capabilityToken) <----------- [Router]
[Agent] -- (2) execute_capability({ token, toolName, args }) -> [Router] -> [Application Tool]
```

---

## Security Considerations

Capability tokens are designed for client-side tool routing within a same-origin application:

- **Single-use**: Once validated and executed, a token cannot be reused. Duplicate submissions are rejected.
- **Tool binding**: Tokens are strictly tied to the requested `toolName` at issuance time, mitigating confused-deputy misuse.
- **TTL expiration**: Unused tokens expire automatically (default: 60 seconds).
- **Private storage**: Active tokens and consumption records are stored in ECMAScript private fields, preventing external inspection via global properties.
- **Argument freezing**: Suggested arguments bound at routing time are frozen to prevent in-memory tampering before dispatch.

---

## Installation

```bash
npm install webmcp-semantic-router
```

---

## Usage

### Basic Example

```typescript
import { createProgressiveWebMcpRouter, type WebMcpToolDefinition } from 'webmcp-semantic-router';

// 1. Define your internal tool catalog
const catalog: WebMcpToolDefinition[] = [
  {
    name: 'set_mesh_color',
    description: 'Change the diffuse color of a 3D object.',
    tags: ['color', 'material', '3d'],
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        colorHex: { type: 'string' },
      },
      required: ['nodeId', 'colorHex'],
    },
    annotations: {
      consequentialHint: true,
    },
    execute: async (args, context) => {
      if (context?.signal?.aborted) throw new Error('Aborted');
      return updateColor(args.nodeId, args.colorHex);
    },
  },
];

// 2. Initialize the router
const router = createProgressiveWebMcpRouter({
  tools: catalog,
  contextAnchor: () => ({
    focusedNodeId: getSelectedNodeId(),
  }),
  tokenTtlMs: 30_000,
  maxCandidates: 5,
});

// 3. Mount to WebMCP
if ('modelContext' in document) {
  await router.mount(document.modelContext);
}
```

### React Component Lifecycle

When views unmount, calling `router.unmount()` removes surface tools from discovery while allowing in-flight tasks to finish:

```typescript
useEffect(() => {
  if (!('modelContext' in document)) return;

  void router.mount(document.modelContext);

  return () => {
    // Unregisters tools from discovery. Executing tasks finish naturally.
    const { inFlightCount } = router.unmount();
    console.log(`Unmounted catalog. ${inFlightCount} in-flight tasks continue.`);
  };
}, []);
```

---

## On-Device AI Semantic Scoring (`webmcp-semantic-router/ai`)

In practical agent workflows, LLMs often issue search queries using colloquial phrasing, descriptive intent, or domain synonyms rather than the exact keywords or tags assigned to tools. Keyword-only matching can return zero results for valid requests when wording differs.

The optional subpath import (`webmcp-semantic-router/ai`) adds on-device vector similarity search using compact multilingual embeddings on WebGPU / Wasm:

- **Local Execution**: Embeddings are computed directly in the browser with zero external network requests, preserving privacy and eliminating per-call API fees.
- **Permissive Licensing**: Both the default embedding model (`hotchpotch/bekko-embedding-v1-a8m`, MIT License) and the Transformers.js runtime (Apache-2.0 License) are fully permissive for commercial use.
- **Automatic Fallback**: If WebGPU is unsupported or model assets fail to load, the router falls back to the deterministic CPU scorer without throwing unhandled exceptions.

```typescript
import { createProgressiveWebMcpRouter } from 'webmcp-semantic-router';
import { BekkoSemanticScorer } from 'webmcp-semantic-router/ai';

const aiScorer = new BekkoSemanticScorer(catalog, {
  precomputedEmbeddings: myVectors,
  denseWeight: 0.5,
});

const router = createProgressiveWebMcpRouter({
  tools: catalog,
  scorer: aiScorer,
});
```

---

## Specification Alignment (WebML CG Draft)

| WebMCP Draft Reference | `webmcp-semantic-router` Implementation |
| :--- | :--- |
| `registerTool` | Surface tools registered on `modelContext` |
| `ModelContextRegisterToolOptions.signal` | Supported via `AbortController` in `mount` / `unmount` |
| `ModelContextExecuteToolOptions.signal` | Forwarded through execution proxy |
| Execution Lifecycle Tracking | [§ 3.1 Pending tool executions](https://webmachinelearning.github.io/webmcp/#pending-tool-executions) | In-flight operations tracked and permitted to complete |
| `ToolAnnotations` | Preserved (`readOnlyHint`, `consequentialHint`, etc.) |

---

## Acknowledgements

- **[hotchpotch/bekko-embedding-v1-a8m](https://huggingface.co/hotchpotch/bekko-embedding-v1-a8m)**: Compact multilingual embedding model created by Yuichi Tateno (hotchpotch), licensed under MIT.
- **[@huggingface/transformers](https://github.com/huggingface/transformers.js)**: In-browser ML runtime developed by Hugging Face, licensed under Apache-2.0.

---

## License

MIT (c) 2026 DISMUS
