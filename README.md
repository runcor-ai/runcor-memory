# runcor-memory

Long chain memory for autonomous agents. [runcor.ai/memory](https://runcor.ai/memory/)

## Long chain memory

runcor-memory implements long chain memory — a memory architecture where knowledge passes through a chain of stages, each one filtering, strengthening, and compressing what survives.

```
event → record → short-term cube → reinforce → promote → compress → long-term cube
                       ↓                                                  ↓
                   decay + forget                                  survives months to years
```

A raw event enters the chain as an episodic memory: "Marketplace Corp missed payment of $2,400 on Day 12." If nobody accesses it and nothing reinforces it, it decays and dies in the short-term cube within weeks. But if the same pattern keeps appearing — a second missed payment, then a third — the memory gets reinforced, its value rises, and it earns promotion to long-term. On promotion, the LLM compresses it from a specific event into general knowledge: "Marketplace Corp is a credit risk with repeated payment defaults."

That long-term memory now decays at a fraction of the rate. With durability=10 and tau=40, a long-term memory survives over 400 cycles. At one cycle per day, that's more than a year of retained knowledge.

The chain is what makes this different from storage. Every other memory system stores things and retrieves them. Long chain memory earns, compresses, and preserves — the way a human employee builds expertise over months and years on the job.

## Why this exists

Every AI memory system on the market — [Mem0](https://github.com/mem0ai/mem0), [Letta/MemGPT](https://github.com/letta-ai/letta), [Zep](https://github.com/getzep/graphiti), [Cognee](https://github.com/topoteretes/cognee) — is built for conversational AI. A human talks, the assistant responds, memory updates. They assume someone is in the loop asking questions and getting answers.

Autonomous agents have a fundamentally different memory problem. A CEO agent running its 150th daily cycle has no human to prompt it. It needs to know that Marketplace Corp is a credit risk because of what happened 138 cycles ago — not because someone asked, but because the memory system kept that knowledge alive while shedding thousands of irrelevant events.

runcor-memory is built for agents that run alone for hundreds of cycles. It decides what to remember, what to forget, and what's important enough to keep permanently — the way a human employee would after 150 days on the job.

### What makes it different

**Mathematical forgetting.** Other systems store memories and retrieve them. None of them forget. Mem0 keeps facts until explicitly updated. Letta keeps everything in archival storage. Zep invalidates but never deletes. runcor-memory has a decay formula that runs every cycle — memories that nobody accesses and nothing reinforces naturally fade and get deleted. An agent running for 500 cycles doesn't accumulate infinite context.

**Earned promotion.** Other systems either keep everything or extract facts on first contact. runcor-memory requires a memory to prove itself. A one-off event stays in short-term and may decay. Only memories that are reinforced (the same pattern keeps appearing) or accessed (the agent keeps thinking about it) earn promotion to long-term, where the LLM compresses them from specific events to general knowledge.

**Role-specific behavior from config.** A CEO scores a payment default at 0.85. A marketing runner scores the same event at 0.05. Same infrastructure, same formula — different r++ spec with different preserve/discard rules. No other framework has role-specific memory behavior built into the configuration layer.

**Code-first, LLM-second.** Letta's OS-paging model means the LLM makes every memory decision — expensive and slow. Mem0 calls the LLM for every add/update. runcor-memory uses code for everything deterministic (formula, decay, dedup, promotion, plan lifecycle) and only calls the LLM for the four things that need understanding: relevance scoring, precis compression, task generation, and edge identification. ~90% math, ~10% LLM.

## How it works

### The formula

Every memory has a value **M** that determines whether it survives, gets promoted, or gets deleted:

```
M = R * ln(f + 1) * e^(-t / tau * D)
```

| Variable | What it means |
|----------|--------------|
| **R** | Relevance (0-1) — how important is this to the agent's role? Scored by an LLM using an [r++ spec](https://runcor.ai/rpp). |
| **f** | Frequency — how many times has this come up? Reinforcement makes memories stronger. |
| **t** | Time since last access — resets to 0 when queried or reinforced. Older = weaker. |
| **tau** | Base decay rate — set per role. CEO=20, lawyer=40, social media=15. |
| **D** | Density/uniqueness — unique information decays slower than redundant information. |

### Two memory cubes

**Short-term** — Where new events land. Episodic memories that decay at the normal rate. Most die within 20-40 cycles if not reinforced.

**Long-term** — Where proven memories live. Promoted from short-term when M exceeds the threshold. The LLM compresses them from episodic to semantic: "Marketplace missed payment on Day 12" becomes "Marketplace is a credit risk with repeated payment defaults." Decay rate is tau * durability (5x slower by default).

### The plan

A rolling to-do list rewritten every cycle. Code handles mechanics (carry forward, mark done, remove stale, enforce limits). The LLM generates new tasks from events and writes a one-sentence strategy.

### The lens

Same infrastructure, different behavior per role. A CEO's config says "preserve monetary amounts, discard blog views." A marketing runner says the opposite. Same event, different relevance score, different memory.

## Getting started

Requires Node.js >= 20.6.0.

### 1. Clone and test (no API key needed)

```bash
git clone https://github.com/runcor-ai/runcor-memory.git
cd runcor-memory
npm install
npm test              # 75 tests pass — formula, config, parser. No API key needed.
npm run build         # Compile TypeScript to dist/
```

### 2. Run simulations (needs OpenAI key for embeddings)

```bash
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

Start with the fast tests, then work up to the full simulation:

```bash
npm run test:cube       # Short-term cube with real embeddings (~30s)
npm run test:llm        # LLM scoring, precis, plan via r++ specs (~60s)
npm run test:edges      # Edge type identification (~30s)
npm run sim:100         # 100-cycle decay simulation (~2 min)
npm run sim:personas    # CEO/Marketing/Lawyer/Sales lens comparison (~5 min)
npm run sim:cubes       # Both cubes working together (~3 min)
npm run sim:plan        # 20-cycle plan evolution (~3 min)
npm run sim:2year       # Full 730-cycle simulation (~15 min)
```

### 3. Use as a package

```bash
npm install runcor-memory
```

### Standalone usage

```typescript
import { createCognitiveMemory } from 'runcor-memory';

const mem = createCognitiveMemory({
  dbPath: './memory.db',
  openaiApiKey: process.env.OPENAI_API_KEY,
  model: myModelAdapter,       // any object with complete() method
  agentRole: 'CEO of an autonomous company',
  config: {
    tau: 20,
    durability: 5,
    promoteThreshold: 0.6,
    forgetThreshold: 0.05,
  },
});

const memory = mem.standalone();

// Record events
memory.setCycle(1);
await memory.record('Company founded with $50,000 seed capital');
await memory.record('Marketplace partner missed payment of $2,400');

// Query memories (searches both cubes)
const results = await memory.query('credit risk concerns');

// Run cycle maintenance (decay, promote, forget, rewrite plan)
const report = await memory.cycle();

// Check what survived
console.log('Short-term:', memory.getShortTerm().length);
console.log('Long-term:', memory.getLongTerm().length);
console.log('Plan:', memory.getPlan());
```

### With runcor engine

```typescript
import { createCognitiveMemory } from 'runcor-memory';

// Inside a runcor flow handler
engine.register('ceo-daily', async (ctx) => {
  const mem = createCognitiveMemory({
    dbPath: './ceo-memory.db',
    openaiApiKey: process.env.OPENAI_API_KEY,
    model: ctx.model,
    agentRole: 'CEO',
  });

  // Extend existing memory — tool/user/session still work
  const memory = mem.extend(ctx.memory);

  await memory.record('Revenue report: $42,000 this quarter');
  const plan = memory.getPlan();
  await memory.cycle();
});
```

## Configuration

Three ways to configure, layered by priority:

1. **Code** — Pass config object directly (highest priority)
2. **r++ spec** — `@memory` block in a `.rpp` file
3. **YAML** — `memory.yaml` file auto-detected in working directory

### memory.yaml

```yaml
tau: 20                    # base decay rate in cycles
durability: 5              # long-term decays 5x slower
promote_threshold: 0.6     # M above this -> promote to long-term
forget_threshold: 0.05     # M below this -> delete

compression:
  preserve:
    - "monetary amounts above $100"
    - "client and partner names"
    - "credit risk signals"
  discard:
    - "routine admin tasks"
    - "personal reminders"
    - "spam"
  precis_style: "executive summary — lead with impact"

plan_template:
  categories: [strategy, operations, risk, growth]
  max_items: 10
  review_frequency: 1
```

### r++ spec

```rpp
@memory {
  tau: 40
  durability: 10
  promote_threshold: 0.4
  forget_threshold: 0.03

  @compression {
    preserve: ["exact contractual language", "obligations and deadlines"]
    discard: ["marketing content", "routine operational tasks"]
    precis_style: "legal brief — cite specific facts and dates"
  }
}
```

### Suggested role configs

Pre-built configurations in [`examples/suggested-configs.yaml`](examples/suggested-configs.yaml):

| Role | tau | durability | promote | forget | Notes |
|------|-----|-----------|---------|--------|-------|
| CEO | 20 | 5 | 0.6 | 0.05 | Balanced — keeps strategic patterns, sheds noise |
| Marketing | 15 | 3 | 0.4 | 0.05 | Fast cycle — recent content stats matter most |
| Lawyer | 40 | 10 | 0.4 | 0.03 | Long memory — forgetting is dangerous |
| Sales | 25 | 4 | 0.6 | 0.05 | Client-focused — deals and pipeline |
| Product | 30 | 5 | 0.8 | 0.05 | Pattern-focused — only proven user signals promote |
| Analyst | 40 | 8 | 1.0 | 0.03 | Very selective — only validated patterns earn long-term |

## Simulation results

All results from 100-cycle simulations with 29 events fed to a CEO agent. Events range from critical business events (bankruptcy, enterprise client signed) to noise (checked email, spam).

### Tau comparison — decay speed per role

Same events, same thresholds. Only tau changes. Shows how decay rate controls what an agent remembers.

```
 Metric                          | tau=10 | tau=20 | tau=40 | tau=80 |
 --------------------------------+--------+--------+--------+--------+
 Total survived                  |      1 |      3 |      6 |      9 |
 Total forgotten                 |     25 |     21 |     18 |     15 |
 Survival rate                   |     4% |    12% |    23% |    35% |
 Noise survived (R<=0.3)         |      0 |      0 |      0 |      2 |
 Critical survived (R>=0.8)      |      0 |      1 |      3 |      3 |
 Reinforced survived (f>1)       |      0 |      2 |      2 |      2 |
```

- tau=10: Only the customer survey survived (too recent to decay). Even the 5x reinforced revenue pattern died.
- tau=20: 3 survivors — revenue pattern (f=5), payment risk (accessed via query), recent survey.
- tau=40: 6 survivors including enterprise client and server outage. Zero noise.
- tau=80: 9 survivors but includes 2 noise items (backup, blog post).

### Persona comparison — the lens effect

Same events, same tau=30, same formula. Only the preserve/discard rules change per role. LLM-scored R values.

```
 Event                                       |  CEO  |  Mkt  |  Law  | Sales |
 --------------------------------------------|-------|-------|-------|-------|
 Marketplace partner missed payment $2,400   | 0.85  | 0.05  | 0.85  | 0.85  |
 Blog post about AI trends, 200 views        | 0.14  | 0.39  | 0.10  | 0.15  |
 Server outage, lost $3,200 in orders        | 0.85  | 0.05  | 0.85  | 0.85  |
 Pricing strategy change, 15% increase       | 0.65  | 0.15  | 0.40  | 0.65  |
 Q3 revenue report: $42,000                  | 0.40  | 0.05  | 0.40  | 0.40  |
```

Survival grid — who remembers what after 100 cycles:

```
 Event                                       |  CEO  |  Mkt  |  Law  | Sales |
 --------------------------------------------|-------|-------|-------|-------|
 Missed payment $2,400                       |   Y   |   -   |   Y   |   Y   |
 Monthly revenue pattern (reinforced 5x)     |   Y   |   Y   |   Y   |   Y   |
 Server outage, lost $3,200                  |   Y   |   -   |   Y   |   Y   |
 Enterprise client $10,000/month             |   Y   |   Y   |   Y   |   Y   |
 Customer satisfaction 4.2/5                 |   Y   |   Y   |   Y   |   Y   |
 Bankruptcy, $4,800 written off              |   -   |   Y   |   -   |   -   |
```

Marketing doesn't remember payment defaults or server outages — they're in its discard list. Everyone remembers the revenue pattern because it was reinforced 5 times.

### Promotion threshold comparison — selectivity

Same events, tau=20, durability=5. Only promote_threshold changes.

```
 Metric                          | t=0.4 | t=0.6 | t=0.8 | t=1.2 |
 --------------------------------+-------+-------+-------+-------+
 Promotions                      |     8 |     2 |     1 |     0 |
 Final short-term                |     1 |     2 |     2 |     3 |
 Final long-term                 |     7 |     2 |     1 |     0 |
 Total surviving                 |     8 |     4 |     3 |     3 |
 Forgotten %                     |   70% |   83% |   88% |   88% |
 Avg M (long-term)               |  0.18 |  0.57 |  0.73 |   n/a |
```

- 0.4 (aggressive): 8 promotions — even single high-R events make it. More durable but includes unproven one-offs.
- 0.6 (moderate): 2 promotions — payment pattern (R=0.85, f=2) and revenue trend (R=0.40, f=5). Balanced.
- 0.8 (selective): 1 promotion — only the payment pattern. Revenue trend never promoted (R too low).
- 1.2 (strict): 0 promotions — everything stays short-term and fades.

### Both cubes working together

100 cycles, tau=20, durability=5, promote_threshold=0.8. LLM scores R and writes promotion precis.

Two promotions occurred:
- **Cycle 16**: "Marketplace partner missed first payment of $2,400" (R=0.85, f=2) promoted and compressed to: "Missed payments are a credit risk signal, indicating potential financial instability."
- **Cycle 69**: "Monthly revenue: $5,000 — growth trend continuing" (R=0.55, f=5) promoted and compressed to: "Monthly revenue is $5,000, indicating a growth trend."

Final state at cycle 100:
```
 Short-term (2 memories, fading):
   M=0.09 | Customer satisfaction survey: 4.2/5 average
   M=0.06 | Q3 revenue report: $42,000 total

 Long-term (2 memories, durable):
   M=0.67 | Monthly revenue is $5,000, indicating a growth trend (compressed)
   M=0.63 | Missed payments are a credit risk signal (compressed)
```

Long-term memories have M > 0.6 while short-term is fading below 0.1. The long-term memories will survive for hundreds more cycles.

### Edge identification

The LLM correctly identifies typed relationships between memories:

```
 "Bankruptcy, $4,800 written off"
   --caused--> "Missed first payment of $2,400" (weight: 0.8)
   --caused--> "Missed second payment, $4,800 overdue" (weight: 0.9)

 "Sales have completely stalled"
   --contradicts--> "Revenue $28,000 — growth trend continuing" (weight: 0.8)

 "Monthly revenue: $12,500"
   --reinforced--> "Monthly revenue: $5,000" (weight: 0.8)
   --reinforced--> "Monthly revenue: $8,200" (weight: 0.8)

 "First sale: Premium Widget $49.99"
   --preceded--> "Product launched: Premium Widget at $49.99" (weight: 0.8)
```

### Plan evolution

20-cycle CEO simulation. The plan starts with setup tasks, adapts as events happen:

```
 Cycle  1: "Set up Stripe payment processing" (done by cycle 3)
 Cycle  5: "Draft bulk pricing proposal for 3 competitors at $29-$79"
 Cycle 10: "Finalize distribution agreement with Marketplace Corp"
 Cycle 16: "Send reminder email to Marketplace Corp about $1,750 overdue"
 Cycle 18: "Call Marketplace Corp to discuss overdue payment of $1,750"
 Cycle 20: "Prepare quote for enterprise lead: 500 units/month"
```

Strategy evolved from "establish payment processing" (cycle 1) to "recover $1,750 from Marketplace Corp while closing the enterprise deal for 500 units/month" (cycle 20).

## Architecture

### Code vs LLM split

The system uses code for everything deterministic and LLM only where understanding is required:

| What | How | Why |
|------|-----|-----|
| Calculate M | Code (formula) | Pure math |
| Decay, promote, forget | Code (thresholds) | Mechanical |
| Dedup check | Code + embeddings | Cosine similarity |
| Density calculation | Code | 1 - max similarity |
| Carry forward tasks | Code | List filtering |
| Remove stale tasks | Code | Age check |
| Mark tasks done | Code + embeddings | Match event to task |
| Enforce max items | Code | Sort and trim |
| Score relevance (R) | LLM via r++ spec | Needs role context |
| Write precis | LLM via r++ spec | Needs to compress meaning |
| Generate new tasks | LLM (prompted) | Needs to understand events |
| Identify edge types | LLM via r++ spec | Needs causal reasoning |

### r++ specs

Four specs in `specs/` define how the LLM behaves:

- **`score-relevance.rpp`** — Scores new memories 0-1 using a pipeline: discard check, base score, preserve boost, clamp
- **`write-precis.rpp`** — Compresses memories. Initial mode (light) and promotion mode (episodic to semantic)
- **`rewrite-plan.rpp`** — Generates actionable tasks from events with concrete verbs and specific targets
- **`identify-edges.rpp`** — Identifies typed relationships: caused, contradicts, preceded, reinforced, related

### Storage

SQLite via `better-sqlite3`. Three tables:

- `memory_nodes` — All memories from both cubes (id, content, embedding, R, f, t, D, M, cube, timestamps, source, tags)
- `memory_edges` — Typed relationships between nodes (from, to, weight, type)
- `memory_plans` — Plan history per cycle (items, strategy, changes)

## File structure

```
src/
  types.ts          — Node, edge, config types
  formula.ts        — M = R * ln(f+1) * e^(-t/tau*D)
  embedding.ts      — OpenAI embeddings, cosine similarity, density
  database.ts       — SQLite tables + CRUD for nodes, edges, plans
  cube.ts           — ShortTermCube (standalone, no LLM needed)
  memory-system.ts  — Both cubes + promotion + plan (full system)
  plan.ts           — Hybrid code+LLM plan rewriting
  llm.ts            — LLM calls using r++ specs
  rpp-parser.ts     — Extracts @memory config from .rpp files
  config-loader.ts  — YAML + r++ + code config merging
  ctx-memory.ts     — ctx.memory API for runcor integration
  index.ts          — Package exports

specs/
  score-relevance.rpp
  write-precis.rpp
  rewrite-plan.rpp
  identify-edges.rpp

examples/
  suggested-configs.yaml

tests/
  test-formula.ts           — 50 unit tests for the formula
  test-config.ts            — 25 tests for config loading
  test-cube.ts              — 18 tests for short-term cube
  test-llm.ts               — 25 tests for LLM scoring/precis/plan
  test-edges.ts             — 7 tests for edge identification
  sim-100-cycles.ts         — 100-cycle decay simulation
  sim-tau-compare.ts        — tau=10/20/40/80 comparison
  sim-tau-llm.ts            — Same with LLM-scored R values
  sim-personas.ts           — CEO/Marketing/Lawyer/Sales lens comparison
  sim-both-cubes.ts         — Short+long term working together
  sim-threshold-compare.ts  — Promote threshold 0.4/0.6/0.8/1.2
  sim-plan.ts               — 20-cycle plan evolution
```

## Requirements

- Node.js >= 20
- OpenAI API key (for embeddings via `text-embedding-3-small`)
- Any LLM with a `complete()` method (for R scoring, precis, plan, edges)

## License

MIT
