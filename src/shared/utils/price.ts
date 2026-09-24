/**
 * Converte preços vindos das fontes em número com 2 casas.
 * Aceita number, "139.90", "139,90", "R$ 1.299,90".
 */
export function parsePrice(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? round2(value) : null;
  if (typeof value !== 'string') return null;

  let cleaned = value.replace(/[^\d.,]/g, '');
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > lastDot) {
    // Formato brasileiro: 1.299,90
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Formato internacional: 1,299.90
    cleaned = cleaned.replace(/,/g, '');
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? round2(parsed) : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
