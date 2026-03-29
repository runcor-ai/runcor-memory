/**
 * Memory value formula:
 *
 *   M = R · ln(f + 1) · e^(−t / τD)
 *
 * R  = relevance (0-1)
 * f  = frequency (times reinforced, starts at 1)
 * t  = time since last access (in cycles)
 * τ  = base half-life (in cycles, from r++ spec)
 * D  = density/uniqueness (0-1, from embeddings)
 */

export interface FormulaInputs {
  R: number;
  f: number;
  t: number;
  tau: number;
  D: number;
}

/**
 * Calculate memory value M.
 *
 * Guards against edge cases:
 * - D=0 would cause division by zero → clamp to 0.01
 * - f<1 shouldn't happen but clamp to 1
 * - Returns 0 if R=0 (irrelevant memories have no value)
 */
export function calculateM(inputs: FormulaInputs): number {
  const { R, f, t, tau } = inputs;
  const D = Math.max(inputs.D, 0.01); // avoid division by zero
  const freq = Math.max(f, 1);

  if (R === 0) return 0;

  const frequencyTerm = Math.log(freq + 1);
  const decayExponent = -t / (tau * D);
  const decayTerm = Math.exp(decayExponent);

  return R * frequencyTerm * decayTerm;
}

/**
 * Calculate M for a long-term node (decay is slower by durability factor).
 */
export function calculateMLongTerm(
  inputs: FormulaInputs,
  durability: number,
): number {
  return calculateM({
    ...inputs,
    tau: inputs.tau * durability,
  });
}

/**
 * Determine if a node should be promoted to long-term.
 */
export function shouldPromote(M: number, threshold: number): boolean {
  return M > threshold;
}

/**
 * Determine if a node should be forgotten (deleted).
 */
export function shouldForget(M: number, threshold: number): boolean {
  return M < threshold;
}
