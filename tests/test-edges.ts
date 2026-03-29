/**
 * Test LLM-powered edge type identification.
 */

import OpenAI from 'openai';
import { identifyEdges } from '../src/llm.js';
import type { ModelComplete } from '../src/llm.js';

function createModel(apiKey: string): ModelComplete {
  const client = new OpenAI({ apiKey });
  return {
    async complete(request) {
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: request.maxTokens ?? 1000,
        temperature: request.temperature ?? 0,
        messages: [
          { role: 'system', content: request.systemPrompt ?? '' },
          { role: 'user', content: request.prompt ?? '' },
        ],
        response_format: request.responseFormat === 'json' ? { type: 'json_object' } : undefined,
      });
      return { text: response.choices[0].message.content ?? '' };
    },
  };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string): void {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

async function run() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error('Set OPENAI_API_KEY'); process.exit(1); }
  const model = createModel(apiKey);

  console.log('\n═══ TEST 1: Causal chain — missed payment → bankruptcy ═══');
  {
    const edges = await identifyEdges(
      model,
      'Marketplace Corp declared bankruptcy, $4,800 written off as loss',
      [
        { id: 'a', content: 'Marketplace Corp missed first payment of $2,400' },
        { id: 'b', content: 'Marketplace Corp missed second payment, $4,800 overdue' },
        { id: 'c', content: 'Blog post about AI trends, 200 views' },
      ],
    );

    console.log('  Edges:', JSON.stringify(edges, null, 2));
    assert(edges.length >= 1, `At least 1 edge found (got ${edges.length})`);

    const causalEdge = edges.find(e => e.type === 'caused' || e.type === 'preceded');
    assert(causalEdge !== undefined, 'Found causal/preceded edge to payment history');

    const blogEdge = edges.find(e => e.to_id === 'c');
    assert(blogEdge === undefined || blogEdge.type === 'related', 'No strong edge to unrelated blog post');
  }

  console.log('\n═══ TEST 2: Contradiction — revenue up vs stalled ═══');
  {
    const edges = await identifyEdges(
      model,
      'Sales have completely stalled this month, zero new orders',
      [
        { id: 'x', content: 'Monthly revenue: $28,000 — growth trend continuing' },
        { id: 'y', content: 'New enterprise client signed: $10,000/month contract' },
      ],
    );

    console.log('  Edges:', JSON.stringify(edges, null, 2));
    const contradiction = edges.find(e => e.type === 'contradicts');
    assert(contradiction !== undefined, 'Found contradiction with growth trend');
  }

  console.log('\n═══ TEST 3: Reinforcement — same fact repeated ═══');
  {
    const edges = await identifyEdges(
      model,
      'Monthly revenue: $12,500 — growth trend continuing',
      [
        { id: 'r1', content: 'Monthly revenue: $5,000 — growth trend continuing' },
        { id: 'r2', content: 'Monthly revenue: $8,200 — growth trend continuing' },
        { id: 'u', content: 'Updated password for admin panel' },
      ],
    );

    console.log('  Edges:', JSON.stringify(edges, null, 2));
    const reinforced = edges.filter(e => e.type === 'reinforced' || e.type === 'preceded');
    assert(reinforced.length >= 1, `Found reinforced/preceded edge to prior revenue (got ${reinforced.length})`);

    const adminEdge = edges.find(e => e.to_id === 'u');
    assert(adminEdge === undefined, 'No edge to unrelated admin task');
  }

  console.log('\n═══ TEST 4: Temporal sequence — launch then sale ═══');
  {
    const edges = await identifyEdges(
      model,
      'First sale: Premium Widget sold for $49.99',
      [
        { id: 'p', content: 'New product launched: Premium Widget at $49.99' },
        { id: 'q', content: 'Office wifi was slow this morning' },
      ],
    );

    console.log('  Edges:', JSON.stringify(edges, null, 2));
    const temporal = edges.find(e => e.to_id === 'p' && (e.type === 'preceded' || e.type === 'caused'));
    assert(temporal !== undefined, 'Found preceded/caused edge from launch to sale');
  }

  console.log('\n═══ RESULTS ═══');
  console.log(`\n  ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
