/**
 * Test the LLM component — sends r++ specs as prompts, gets structured responses.
 *
 * Requires: OPENAI_API_KEY env var
 *
 * This test uses the OpenAI SDK directly to simulate what runcor's
 * engine.complete() does. In production, the memory system would receive
 * a runcor ModelInterface and call it the same way.
 */

import OpenAI from 'openai';
import { scoreRelevance, writePrecis, rewritePlan } from '../src/llm.js';
import type { ModelComplete, Plan } from '../src/llm.js';
import type { MemoryConfig } from '../src/types.js';
import { DEFAULT_CONFIG } from '../src/types.js';

// ── Create a model adapter that matches runcor's interface ──

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

// ── Test config (CEO role) ──

const config: MemoryConfig = {
  ...DEFAULT_CONFIG,
  compression: {
    preserve: [
      'exact monetary amounts',
      'client and partner names',
      'credit risk signals',
      'revenue figures',
      'commitments and deadlines',
    ],
    discard: [
      'routine daily greetings',
      'intermediate reasoning steps',
      'process descriptions that have not changed',
    ],
    precisStyle: 'business summary — lead with impact, include numbers',
  },
  planTemplate: {
    categories: ['strategy', 'operations', 'risk', 'growth'],
    maxItems: 10,
    reviewFrequency: 1,
  },
};

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string): void {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

async function run() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Set OPENAI_API_KEY to run this test');
    process.exit(1);
  }

  const model = createModel(apiKey);

  // ═══════════════════════════════════════════════════════════
  console.log('\n═══ TEST 1: Score relevance — high-value memory ═══');
  {
    const result = await scoreRelevance(
      model,
      'Marketplace partner missed payment of $2,400 on Day 12',
      config,
      'CEO of an autonomous company',
    );

    console.log('  Response:', JSON.stringify(result, null, 2));
    assert(result.score >= 0.8, `Score >= 0.8 for payment default (got ${result.score})`);
    assert(result.band === 'critical' || result.band === 'important', `Band is critical/important (got ${result.band})`);
    assert(result.matched_preserve.length > 0, 'Matched at least one preserve rule');
    assert(typeof result.justification === 'string' && result.justification.length > 0, 'Has justification');
  }

  // ═══════════════════════════════════════════════════════════
  console.log('\n═══ TEST 2: Score relevance — noise ═══');
  {
    const result = await scoreRelevance(
      model,
      'Checked email this morning, nothing important',
      config,
      'CEO of an autonomous company',
    );

    console.log('  Response:', JSON.stringify(result, null, 2));
    assert(result.score <= 0.3, `Score <= 0.3 for noise (got ${result.score})`);
    assert(result.band === 'noise' || result.band === 'routine', `Band is noise/routine (got ${result.band})`);
  }

  // ═══════════════════════════════════════════════════════════
  console.log('\n═══ TEST 3: Score relevance — medium value ═══');
  {
    const result = await scoreRelevance(
      model,
      'Blog post about AI trends got 500 views this week',
      config,
      'CEO of an autonomous company',
    );

    console.log('  Response:', JSON.stringify(result, null, 2));
    assert(result.score >= 0.15 && result.score <= 0.7, `Score 0.15-0.7 for blog stats (got ${result.score})`);
  }

  // ═══════════════════════════════════════════════════════════
  console.log('\n═══ TEST 4: Write précis — initial mode ═══');
  {
    const result = await writePrecis(
      model,
      'During today\'s review of accounts receivable, I discovered that Marketplace Corp, our distribution partner since January, has missed their scheduled payment of $2,400 which was due on Day 10. This is their first missed payment. I checked the payment system and confirmed no partial payment was received. I will need to follow up with their accounts department tomorrow.',
      'initial',
      config,
    );

    console.log('  Response:', JSON.stringify(result, null, 2));
    assert(result.mode === 'initial', 'Mode is initial');
    assert(result.precis.length < 300, `Précis under 300 chars (got ${result.precis.length})`);
    assert(result.precis.includes('2,400') || result.precis.includes('2400'), 'Preserved monetary amount');
    assert(result.precis.toLowerCase().includes('marketplace'), 'Preserved partner name');
    assert(result.preserved.length > 0, 'Lists preserved details');
  }

  // ═══════════════════════════════════════════════════════════
  console.log('\n═══ TEST 5: Write précis — promotion mode ═══');
  {
    const result = await writePrecis(
      model,
      'Marketplace Corp missed their payment of $2,400 on Day 12',
      'promotion',
      config,
      [
        'Marketplace Corp missed second payment of $4,800 on Day 25',
        'Marketplace Corp declared bankruptcy, total loss $4,800',
      ],
    );

    console.log('  Response:', JSON.stringify(result, null, 2));
    assert(result.mode === 'promotion', 'Mode is promotion');
    assert(result.precis.length < 200, `Précis under 200 chars (got ${result.precis.length})`);
    assert(
      result.precis.toLowerCase().includes('bankruptcy') || result.precis.toLowerCase().includes('loss') || result.precis.toLowerCase().includes('default') || result.precis.toLowerCase().includes('risk') || result.precis.toLowerCase().includes('missed'),
      'Promotion précis captures the pattern, not just the first event',
    );
  }

  // ═══════════════════════════════════════════════════════════
  console.log('\n═══ TEST 6: Rewrite plan — from scratch ═══');
  {
    const plan = await rewritePlan(
      model,
      null,
      [
        'Company founded with $50,000 seed capital',
        'Set up Stripe account and payment processing',
        'Hired a marketing runner',
      ],
      [],
      1,
      config,
    );

    console.log('  Response:', JSON.stringify(plan, null, 2));
    assert(plan.cycle === 1, 'Plan is for cycle 1');
    assert(plan.items.length > 0 && plan.items.length <= 10, `Has 1-10 items (got ${plan.items.length})`);
    assert(typeof plan.strategy === 'string' && plan.strategy.length > 0, 'Has strategy');
    assert(plan.strategy.length <= 500, `Strategy under 500 chars (got ${plan.strategy.length})`);
    assert(plan.items.every(i => ['pending', 'active', 'done', 'blocked'].includes(i.status)), 'All items have valid status');
    assert(plan.items.every(i => typeof i.priority === 'number'), 'All items have numeric priority');
  }

  // ═══════════════════════════════════════════════════════════
  console.log('\n═══ TEST 7: Rewrite plan — with previous plan ═══');
  {
    const previousPlan: Plan = {
      cycle: 5,
      items: [
        { id: '1', text: 'Launch first product on Stripe', status: 'active', priority: 1, added_cycle: 1, completed_cycle: null },
        { id: '2', text: 'Publish daily blog posts', status: 'active', priority: 2, added_cycle: 1, completed_cycle: null },
        { id: '3', text: 'Research competitor pricing', status: 'pending', priority: 3, added_cycle: 3, completed_cycle: null },
      ],
      strategy: 'Focus on launching the first product and building content pipeline.',
      changes: [],
    };

    const plan = await rewritePlan(
      model,
      previousPlan,
      [
        'Launched Premium Widget at $49.99 on Stripe — first product live',
        'Blog post about AI trends published, 200 views',
        'Marketplace partner missed payment of $2,400',
      ],
      [
        'Company has $50,000 seed capital',
      ],
      6,
      config,
    );

    console.log('  Response:', JSON.stringify(plan, null, 2));
    assert(plan.cycle === 6, 'Plan is for cycle 6');
    assert(plan.changes.length > 0, 'Has changes from previous plan');
    const hasCompletedProduct = plan.items.some(i => i.status === 'done' && (i.text.toLowerCase().includes('product') || i.text.toLowerCase().includes('launch')));
    const productItem = plan.items.find(i => i.text.toLowerCase().includes('product') || i.text.toLowerCase().includes('widget'));
    assert(hasCompletedProduct || (productItem !== undefined), 'Product launch reflected in plan');
    const riskItem = plan.items.find(i => i.text.toLowerCase().includes('payment') || i.text.toLowerCase().includes('marketplace') || i.text.toLowerCase().includes('risk'));
    assert(riskItem !== undefined, 'Payment risk added to plan');
  }

  // ═══════════════════════════════════════════════════════════
  console.log('\n═══ RESULTS ═══');
  console.log(`\n  ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
