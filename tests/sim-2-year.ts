/**
 * 2-YEAR CEO SIMULATION — 730 cycles with memory agent
 *
 * Semi-random business events generated from probability distributions.
 * A memory agent processes the CEO's raw daily output and decides
 * what's worth recording. The CEO queries memory each cycle.
 *
 * This proves:
 *   1. Long-term memory survives 730 cycles
 *   2. Short-term stays lean while long-term accumulates knowledge
 *   3. Reinforced patterns dominate long-term
 *   4. The plan evolves meaningfully over 2 years
 *   5. Promoted precis still captures the right knowledge at cycle 730
 */

import OpenAI from 'openai';
import { MemoryDatabase } from '../src/database.js';
import { MemorySystem } from '../src/memory-system.js';
import type { ModelComplete, Plan } from '../src/llm.js';
import type { MemoryConfig, MemoryNode } from '../src/types.js';
import { DEFAULT_CONFIG } from '../src/types.js';
import { unlinkSync, existsSync } from 'node:fs';

// ── Model adapter ────────────────────────────────────────────

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

// ── Random helpers ───────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function chance(pct: number): boolean {
  return Math.random() * 100 < pct;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function money(n: number): string {
  return '$' + n.toLocaleString('en-US');
}

// ── Business simulation state ────────────────────────────────

interface BusinessState {
  revenue: number;         // monthly revenue (grows with noise)
  customers: number;       // active customer count
  employees: number;
  products: string[];
  enterpriseClients: string[];
  cash: number;
  churnRate: number;       // % chance of losing a customer per cycle
  competitorThreat: number; // 0-100
  phase: string;           // startup | growth | scaling
  crisisActive: string | null;
  crisisCyclesLeft: number;
  partnerDebt: number;
  raised: number;          // total funding raised
}

// ── Event generator ──────────────────────────────────────────
// Returns 0-3 events per cycle based on probabilities and state

function generateEvents(cycle: number, state: BusinessState): string[] {
  const events: string[] = [];
  const month = Math.ceil(cycle / 30);
  const year = Math.ceil(cycle / 365);

  // ── Revenue (every 30 cycles = monthly) ──
  if (cycle % 30 === 0) {
    // Revenue grows with noise
    const growth = state.phase === 'startup' ? rand(-5, 15) :
                   state.phase === 'growth' ? rand(2, 20) :
                   rand(-3, 12);
    state.revenue = Math.max(500, Math.round(state.revenue * (1 + growth / 100)));
    events.push(`Monthly revenue: ${money(state.revenue)} (month ${month})`);
  }

  // ── Quarterly review ──
  if (cycle % 90 === 0) {
    const quarterly = state.revenue * 3;
    events.push(`Q${Math.ceil((cycle % 365) / 90) || 4} revenue report: ${money(quarterly)} total this quarter`);
  }

  // ── New customer (probability based on phase) ──
  const newCustChance = state.phase === 'startup' ? 8 :
                        state.phase === 'growth' ? 15 : 20;
  if (chance(newCustChance)) {
    state.customers++;
    const type = chance(20) ? 'enterprise' : 'individual';
    const name = type === 'enterprise'
      ? pick(['Acme Corp', 'Global Industries', 'TechVentures', 'Pinnacle Group', 'Nexus Partners', 'Summit LLC', 'Atlas Dynamics', 'Forge Capital', 'Vantage Tech', 'Meridian Co'])
      : 'an individual customer';
    if (type === 'enterprise' && !state.enterpriseClients.includes(name)) {
      const value = rand(3, 25) * 1000;
      state.enterpriseClients.push(name);
      state.revenue += Math.round(value / 3); // partial month impact
      events.push(`New enterprise client signed: ${name}, ${money(value)}/month contract`);
    } else if (type === 'individual') {
      events.push(`New customer acquired, total active customers: ${state.customers}`);
    }
  }

  // ── Customer churn ──
  if (state.customers > 5 && chance(state.churnRate)) {
    state.customers--;
    if (chance(30) && state.enterpriseClients.length > 0) {
      const lost = pick(state.enterpriseClients);
      state.enterpriseClients = state.enterpriseClients.filter(c => c !== lost);
      events.push(`Lost enterprise client: ${lost} cancelled their contract`);
    } else {
      events.push(`Customer churned, active customers now: ${state.customers}`);
    }
  }

  // ── Hiring ──
  if (chance(5) && state.cash > 50000) {
    state.employees++;
    const role = pick(['marketing', 'sales', 'engineering', 'customer support', 'product', 'operations']);
    events.push(`Hired new ${role} team member, team size now ${state.employees}`);
    state.cash -= 5000; // signing cost
  }

  // ── Employee departure ──
  if (state.employees > 3 && chance(2)) {
    state.employees--;
    const role = pick(['marketing', 'engineering', 'sales']);
    events.push(`${role} team member resigned, team size now ${state.employees}`);
  }

  // ── New product ──
  if (chance(1.5) && state.products.length < 5) {
    const product = pick(['Pro Widget', 'Widget Lite', 'Enterprise Suite', 'Analytics Dashboard', 'API Access Plan']);
    if (!state.products.includes(product)) {
      const price = rand(19, 199);
      state.products.push(product);
      events.push(`Launched new product: ${product} at ${money(price)}/month`);
    }
  }

  // ── Blog / marketing (frequent but low value) ──
  if (chance(15)) {
    const topic = pick(['industry trends', 'product update', 'customer success story', 'technical deep-dive', 'team culture', 'market analysis']);
    const views = rand(50, chance(5) ? 5000 : 500); // 5% chance of viral
    events.push(`Published blog post about ${topic}, ${views.toLocaleString()} views`);
  }

  // ── Routine noise ──
  if (chance(10)) {
    events.push(pick([
      'Checked email, nothing urgent',
      'Updated company website',
      'Ran weekly backup',
      'Reorganized Slack channels',
      'Updated admin passwords',
      'Cleaned up old files',
      'Attended industry webinar',
    ]));
  }

  // ── Crisis events ──
  if (state.crisisActive) {
    state.crisisCyclesLeft--;
    if (state.crisisCyclesLeft <= 0) {
      events.push(`Crisis resolved: ${state.crisisActive}`);
      state.crisisActive = null;
    } else if (chance(40)) {
      events.push(`Ongoing: ${state.crisisActive} — ${state.crisisCyclesLeft} cycles estimated to resolve`);
    }
  } else if (chance(2)) {
    // Random crisis
    const crisis = pick([
      { text: 'Server outage affecting all customers', duration: rand(1, 3), cost: rand(1000, 10000) },
      { text: 'Supply chain disruption, fulfillment delayed', duration: rand(10, 40), cost: rand(5000, 20000) },
      { text: 'Key competitor launched aggressive pricing campaign', duration: rand(20, 60), cost: 0 },
      { text: 'Data breach scare, security audit required', duration: rand(5, 15), cost: rand(3000, 15000) },
      { text: 'Payment processor outage, can\'t accept orders', duration: rand(1, 5), cost: rand(2000, 8000) },
    ]);
    state.crisisActive = crisis.text;
    state.crisisCyclesLeft = crisis.duration;
    state.cash -= crisis.cost;
    events.push(`CRISIS: ${crisis.text} (estimated cost: ${money(crisis.cost)})`);
  }

  // ── Partner/debt events (early game) ──
  if (cycle >= 20 && cycle <= 60 && state.partnerDebt === 0 && chance(3)) {
    state.partnerDebt = rand(1500, 5000);
    events.push(`Distribution partner Marketplace Corp missed payment of ${money(state.partnerDebt)}`);
  }
  if (state.partnerDebt > 0 && chance(8)) {
    if (chance(40)) {
      events.push(`Marketplace Corp declared bankruptcy, ${money(state.partnerDebt)} written off as loss`);
      state.cash -= state.partnerDebt;
      state.partnerDebt = 0;
    } else {
      events.push(`Marketplace Corp still hasn't paid, ${money(state.partnerDebt)} overdue`);
    }
  }

  // ── Funding events ──
  if (cycle === 300 && state.raised === 0) {
    state.raised = 2000000;
    state.cash += 2000000;
    events.push(`Closed seed round: $2M at $8M valuation`);
    state.phase = 'growth';
  }
  if (cycle === 620 && state.raised <= 2000000) {
    events.push('Series A discussions started with 3 VC firms');
  }
  if (cycle === 680) {
    state.raised += 10000000;
    state.cash += 10000000;
    events.push('Closed Series A: $10M at $40M valuation');
    state.phase = 'scaling';
  }

  // ── Acquisition offer (year 2) ──
  if (cycle === 550) {
    events.push('Received acquisition offer: $5M from larger competitor');
  }
  if (cycle === 560) {
    events.push('Rejected $5M acquisition offer, decided to stay independent and raise Series A');
  }

  // ── Phase transitions ──
  if (cycle === 120 && state.phase === 'startup') {
    state.phase = 'growth';
    state.churnRate = 3;
    events.push('Product-market fit achieved, transitioning to growth phase');
  }

  // ── Competitor events ──
  if (chance(3)) {
    state.competitorThreat = Math.min(100, state.competitorThreat + rand(5, 15));
    events.push(pick([
      `Competitor raised ${money(rand(1, 20) * 1000000)} in funding`,
      'Competitor launched feature that matches our core product',
      'Industry report shows 3 new entrants in our market',
      `Competitor pricing undercuts us by ${rand(10, 40)}%`,
    ]));
  }

  // ── Customer feedback ──
  if (chance(8)) {
    const score = (rand(25, 50) / 10); // 2.5 - 5.0
    events.push(pick([
      `Customer satisfaction survey: ${score.toFixed(1)}/5.0 average`,
      `Customer feedback: "${pick(['love the product', 'needs better documentation', 'pricing is fair', 'support response too slow', 'great onboarding experience'])}"`,
      `NPS score this month: ${rand(20, 70)}`,
    ]));
  }

  // ── Cash flow ──
  state.cash += Math.round(state.revenue / 30); // daily revenue
  state.cash -= Math.round(state.employees * 200); // daily burn per employee

  return events;
}

// ── Memory agent ─────────────────────────────────────────────
// Processes raw CEO output, decides what to record

async function memoryAgentProcess(
  model: ModelComplete,
  events: string[],
  mem: MemorySystem,
): Promise<string[]> {
  if (events.length === 0) return [];

  // Ask the LLM which events are worth recording
  const response = await model.complete({
    systemPrompt: 'You are a memory agent for an autonomous CEO. Decide which events are worth remembering. Return JSON.',
    prompt: `These events happened this cycle:
${events.map((e, i) => `${i}: ${e}`).join('\n')}

Return a JSON object with:
- "record": array of indices worth recording as memories (business-relevant events)
- "skip": array of indices to skip (routine noise, no business impact)

Only record events with business impact: revenue, clients, crises, strategic decisions, team changes.
Skip: routine admin, blog posts with low views, generic updates.

Return ONLY JSON.`,
    responseFormat: 'json',
    temperature: 0,
    maxTokens: 300,
  });

  const raw = JSON.parse(response.text);
  const indices: number[] = raw.record ?? [];
  const recorded: string[] = [];

  for (const i of indices) {
    if (i >= 0 && i < events.length) {
      await mem.record(events[i], { source: 'ceo' });
      recorded.push(events[i]);
    }
  }

  return recorded;
}

// ── CEO query patterns ───────────────────────────────────────
// Each cycle, the CEO queries memory for context

function getCeoQuery(cycle: number, state: BusinessState): string | null {
  // Query every 5 cycles, and always during crises
  if (state.crisisActive) return `current crisis: ${state.crisisActive}`;
  if (cycle % 5 !== 0) return null;

  return pick([
    'revenue trends and financial performance',
    'customer acquisition and churn patterns',
    'competitive landscape and threats',
    'team size and hiring needs',
    'product performance and roadmap',
    'risks and outstanding issues',
    'enterprise client pipeline',
    'what happened with past crises',
  ]);
}

// ── Main simulation ──────────────────────────────────────────

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error('Set OPENAI_API_KEY'); process.exit(1); }

  const model = createModel(apiKey);
  const dbPath = './sim-2-year.db';
  if (existsSync(dbPath)) unlinkSync(dbPath);

  const db = new MemoryDatabase(dbPath);
  const mem = new MemorySystem({
    db,
    config: {
      tau: 30,
      durability: 10,
      promoteThreshold: 0.6,
      forgetThreshold: 0.05,
      compression: {
        preserve: [
          'monetary amounts above $100 representing revenue, loss, or debt',
          'client and partner names involved in contracts or disputes',
          'credit risk signals such as missed payments, defaults, bankruptcy',
          'revenue figures and financial performance metrics',
          'funding rounds, valuations, and investor names',
          'strategic decisions: pivots, acquisitions, pricing changes',
        ],
        discard: [
          'routine daily greetings and small talk',
          'routine admin tasks: password changes, backups, config updates',
          'personal reminders unrelated to business',
          'spam and unsolicited communications',
          'blog posts with under 500 views',
          'infrastructure maintenance with no business impact',
        ],
        precisStyle: 'executive summary — lead with impact, include numbers',
      },
      planTemplate: {
        categories: ['strategy', 'operations', 'risk', 'growth'],
        maxItems: 10,
        reviewFrequency: 1,
      },
    },
    openaiApiKey: apiKey,
    model,
    agentRole: 'CEO of an autonomous company in growth phase, making daily strategic decisions',
  });

  const state: BusinessState = {
    revenue: 2000,
    customers: 3,
    employees: 2,
    products: ['Premium Widget'],
    enterpriseClients: [],
    cash: 50000,
    churnRate: 5,
    competitorThreat: 10,
    phase: 'startup',
    crisisActive: null,
    crisisCyclesLeft: 0,
    partnerDebt: 0,
    raised: 0,
  };

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' 2-YEAR CEO SIMULATION — 730 cycles with memory agent');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' tau=30, durability=10, promote>0.6, forget<0.05');
  console.log(' Long-term effective tau = 300 cycles (~10 months)');
  console.log(' Events generated from probability distributions, not scripted');
  console.log(' Memory agent decides what to record from CEO\'s daily activity');
  console.log('');

  // Tracking
  const checkpoints = Array.from({ length: 24 }, (_, i) => (i + 1) * 30);
  const snapshots: { cycle: number; short: number; long: number; totalEvents: number; totalRecorded: number; revenue: number; phase: string }[] = [];
  const promotionLog: { cycle: number; original: string; precis: string }[] = [];
  let totalEvents = 0;
  let totalRecorded = 0;
  let totalLLMCalls = 0;

  // Plan snapshots at key moments
  const planCycles = [1, 90, 180, 365, 540, 730];
  const planSnapshots: { cycle: number; plan: Plan | null }[] = [];

  for (let cycle = 1; cycle <= 730; cycle++) {
    mem.setCycle(cycle);

    // Generate random events for this cycle
    const events = generateEvents(cycle, state);
    totalEvents += events.length;

    // Memory agent processes events (LLM decides what to record)
    let recorded: string[] = [];
    if (events.length > 0) {
      recorded = await memoryAgentProcess(model, events, mem);
      totalRecorded += recorded.length;
      totalLLMCalls++; // memory agent filter call
    }

    // CEO queries memory for context
    const query = getCeoQuery(cycle, state);
    if (query) {
      await mem.query(query, 3);
    }

    // Run cycle maintenance (decay, promote, forget, plan)
    const report = await mem.cycle();

    // Track promotions
    for (const p of report.promoted) {
      promotionLog.push({ cycle, original: p.originalContent, precis: p.precis });
    }

    // Snapshots every 30 cycles
    if (checkpoints.includes(cycle)) {
      snapshots.push({
        cycle,
        short: mem.getShortTerm().length,
        long: mem.getLongTerm().length,
        totalEvents,
        totalRecorded,
        revenue: state.revenue,
        phase: state.phase,
      });
    }

    // Plan snapshots
    if (planCycles.includes(cycle)) {
      planSnapshots.push({ cycle, plan: mem.getPlan() });
    }

    // Progress output every 100 cycles
    if (cycle % 100 === 0 || cycle === 730) {
      const s = mem.getShortTerm().length;
      const l = mem.getLongTerm().length;
      console.log(` Cycle ${String(cycle).padStart(3)}/730 | ${state.phase.padEnd(8)} | rev=${money(state.revenue).padStart(8)} | ${s}S ${l}L | events=${totalEvents} recorded=${totalRecorded} | promotions=${promotionLog.length}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // OUTPUT TABLES
  // ═══════════════════════════════════════════════════════════

  // TABLE 1: Memory cube sizes over time
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 1: MEMORY CUBE SIZES OVER 2 YEARS');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' Cycle | Month | Phase    | Revenue  | Short | Long  | Events | Recorded');
  console.log(' ------+-------+----------+----------+-------+-------+--------+---------');
  for (const s of snapshots) {
    const month = Math.ceil(s.cycle / 30);
    console.log(` ${String(s.cycle).padStart(5)} | ${String(month).padStart(5)} | ${s.phase.padEnd(8)} | ${money(s.revenue).padStart(8)} | ${String(s.short).padStart(5)} | ${String(s.long).padStart(5)} | ${String(s.totalEvents).padStart(6)} | ${String(s.totalRecorded).padStart(8)}`);
  }

  // TABLE 2: Promotions
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(` TABLE 2: ALL PROMOTIONS (${promotionLog.length} total)`);
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  if (promotionLog.length === 0) {
    console.log(' (no promotions)');
  } else {
    console.log(' Cycle | Original → Precis');
    console.log(' ------+--------------------------------------------------------------');
    for (const p of promotionLog) {
      const orig = p.original.length > 55 ? p.original.slice(0, 52) + '...' : p.original;
      const prec = p.precis.length > 55 ? p.precis.slice(0, 52) + '...' : p.precis;
      console.log(` ${String(p.cycle).padStart(5)} | "${orig}"`);
      console.log(`       |   → "${prec}"`);
    }
  }

  // TABLE 3: Final long-term memory
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 3: WHAT THE CEO KNOWS AFTER 2 YEARS (long-term memory)');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  const finalLong = mem.getLongTerm().sort((a, b) => b.M - a.M);
  const finalShort = mem.getShortTerm().sort((a, b) => b.M - a.M);

  if (finalLong.length === 0) {
    console.log(' (no long-term memories)');
  } else {
    console.log(' M     | R    | f  | Age  | Content');
    console.log(' ------+------+----+------+--------------------------------------------------');
    for (const n of finalLong) {
      const age = 730 - n.createdAt;
      const label = n.content.length > 50 ? n.content.slice(0, 47) + '...' : n.content;
      console.log(` ${n.M.toFixed(2).padStart(5)} | ${n.R.toFixed(2)} | ${String(n.f).padStart(2)} | ${String(age).padStart(4)} | ${label}`);
    }
  }

  console.log('');
  console.log(` Short-term at cycle 730: ${finalShort.length} memories`);
  for (const n of finalShort.slice(0, 10)) {
    const label = n.content.length > 60 ? n.content.slice(0, 57) + '...' : n.content;
    console.log(`   M=${n.M.toFixed(2).padStart(5)} R=${n.R.toFixed(2)} f=${n.f} | ${label}`);
  }

  // TABLE 4: Plan evolution
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 4: PLAN EVOLUTION');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  for (const snap of planSnapshots) {
    console.log('');
    if (!snap.plan) {
      console.log(` ── CYCLE ${snap.cycle} — (no plan yet) ──`);
      continue;
    }
    console.log(` ── CYCLE ${snap.cycle} (month ${Math.ceil(snap.cycle / 30)}) ──`);
    console.log(` Strategy: "${snap.plan.strategy}"`);
    const items = snap.plan.items.sort((a, b) => a.priority - b.priority).slice(0, 5);
    for (const item of items) {
      const text = (item.text ?? '').slice(0, 60);
      console.log(`   [${item.status.padEnd(7)}] P${item.priority} | ${text}`);
    }
    if (snap.plan.items.length > 5) {
      console.log(`   ... and ${snap.plan.items.length - 5} more items`);
    }
  }

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(` Total cycles:            730`);
  console.log(` Total events generated:  ${totalEvents}`);
  console.log(` Total recorded:          ${totalRecorded} (${((totalRecorded / totalEvents) * 100).toFixed(0)}% of events)`);
  console.log(` Total promotions:        ${promotionLog.length}`);
  console.log(` Final short-term:        ${finalShort.length}`);
  console.log(` Final long-term:         ${finalLong.length}`);
  console.log(` Total surviving:         ${finalShort.length + finalLong.length}`);
  console.log(` Forgotten:               ${totalRecorded - finalShort.length - finalLong.length}`);
  console.log(` Forgotten %:             ${(((totalRecorded - finalShort.length - finalLong.length) / totalRecorded) * 100).toFixed(0)}%`);
  console.log(` Final revenue:           ${money(state.revenue)}/month`);
  console.log(` Final cash:              ${money(state.cash)}`);
  console.log(` Final team size:         ${state.employees}`);
  console.log(` Enterprise clients:      ${state.enterpriseClients.length}`);
  console.log(` Products:                ${state.products.join(', ')}`);
  console.log(` Phase:                   ${state.phase}`);
  console.log('');

  db.close();
  // Keep the database for inspection
  console.log(` Database saved to: ${dbPath}`);
  console.log('');
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
