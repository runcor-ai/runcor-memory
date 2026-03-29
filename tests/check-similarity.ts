import { embed, cosineSimilarity } from '../src/embedding.js';

const texts = [
  'Marketplace missed payment on Day 12',
  'Marketplace missed their payment again on Day 12',
  'credit risk and payment defaults',
  'New product launched: Premium Widget at $49.99',
  'Blog post about AI trends got 500 views',
];

async function run() {
  const embeddings = await Promise.all(
    texts.map((t) => embed(t, process.env.OPENAI_API_KEY)),
  );

  console.log('Pairwise similarities:\n');
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      console.log(`  ${sim.toFixed(4)}  "${texts[i].slice(0, 40)}" ↔ "${texts[j].slice(0, 40)}"`);
    }
  }
}

run().catch(console.error);
