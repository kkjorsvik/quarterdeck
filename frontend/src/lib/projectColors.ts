export const PROJECT_COLORS = [
  '#60a5fa', '#a78bfa', '#34d399', '#fb923c', '#22d3ee',
  '#f472b6', '#facc15', '#f87171', '#2dd4bf', '#a3e635',
];

export function getProjectColor(sortOrder: number, dbColor: string | null): string {
  if (dbColor) return dbColor;
  return PROJECT_COLORS[((sortOrder % PROJECT_COLORS.length) + PROJECT_COLORS.length) % PROJECT_COLORS.length];
}
