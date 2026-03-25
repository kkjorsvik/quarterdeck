export interface FuzzyResult {
  score: number;
  matches: number[];
}

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const matches: number[] = [];
  let score = 0;
  let qi = 0;
  let lastMatchIdx = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matches.push(ti);
      if (lastMatchIdx === ti - 1) {
        score += 3;
      } else {
        score += 1;
      }
      if (ti === 0 || t[ti - 1] === '/' || t[ti - 1] === '-' || t[ti - 1] === '_' || t[ti - 1] === '.') {
        score += 2;
      }
      lastMatchIdx = ti;
      qi++;
    }
  }

  if (qi < q.length) return null;
  score -= target.length * 0.1;
  return { score, matches };
}
