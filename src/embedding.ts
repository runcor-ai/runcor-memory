import OpenAI from 'openai';

let client: OpenAI | null = null;

function getClient(apiKey?: string): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: apiKey ?? process.env.OPENAI_API_KEY,
    });
  }
  return client;
}

/**
 * Get embedding vector for a text string.
 * Uses OpenAI text-embedding-3-small (1536 dimensions, cheap).
 */
export async function embed(
  text: string,
  apiKey?: string,
): Promise<number[]> {
  const openai = getClient(apiKey);
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Get embeddings for multiple texts in a single API call.
 */
export async function embedBatch(
  texts: string[],
  apiKey?: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const openai = getClient(apiKey);
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}

/**
 * Cosine similarity between two vectors. Returns value in [-1, 1].
 * Identical vectors → 1, orthogonal → 0, opposite → -1.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Calculate density (uniqueness) for a node given all other embeddings.
 * D = 1 - max cosine similarity to any other node.
 * Completely unique → D=1, identical to something → D≈0.
 */
export function calculateDensity(
  embedding: number[],
  otherEmbeddings: number[][],
): number {
  if (otherEmbeddings.length === 0) return 1;
  let maxSim = -Infinity;
  for (const other of otherEmbeddings) {
    const sim = cosineSimilarity(embedding, other);
    if (sim > maxSim) maxSim = sim;
  }
  return Math.max(0, 1 - maxSim);
}
