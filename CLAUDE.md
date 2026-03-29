# runcor-memory

Long chain memory for autonomous AI agents running on the runcor engine.

## Project structure

- `src/` — TypeScript source (ESM, strict mode)
- `specs/` — r++ specs that define LLM behavior for scoring, compression, planning, edge identification
- `tests/` — Unit tests and simulation scripts
- `results/` — Saved simulation outputs
- `examples/` — Suggested configs per role

## Key commands

```bash
npm test              # Formula tests (no API key needed, fast)
npm run test:config   # Config loader tests (no API key needed)
npm run test:all      # All offline tests

# These need OPENAI_API_KEY set:
npm run test:cube     # Short-term cube with real embeddings
npm run test:llm      # LLM scoring, precis, plan via r++ specs
npm run test:edges    # Edge type identification
npm run sim:2year     # Full 730-cycle simulation (takes ~15 min)
```

## Architecture

Two memory cubes (short-term + long-term) with a mathematical decay formula:
`M = R * ln(f+1) * e^(-t / tau * D)`

Code handles: formula, decay, promotion thresholds, dedup, density, plan lifecycle.
LLM handles: relevance scoring, precis compression, task generation, edge identification.

The r++ specs in `specs/` are the prompts sent to the LLM — they define structured behavior, not natural language instructions.

## Dependencies

- `better-sqlite3` for storage
- `openai` for embeddings only (text-embedding-3-small)
- runcor is NOT a dependency — the memory system accepts any model with a `complete()` method

## Config

Three layers (highest priority first): code > r++ spec > YAML (memory.yaml).
See `examples/suggested-configs.yaml` for per-role tuning.
