/**
 * Formatação — as mesmas funções que o `Form.html` tem em JavaScript solto.
 *
 * Existem aqui para não serem reescritas em cada tela. Toda divergência de
 * formatação entre duas telas do mesmo app é ruído que o usuário nota.
 */

const MESES_ABREV = [
  'JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN',
  'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ',
];

export function brl(v: number | string): string {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Sem o `R$`, para onde o cifrão já apareceu ou atrapalha. */
export function numero(v: number | string): string {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Valor com sinal explícito — o `+` é tão informativo quanto o `−` quando o
 * número responde "quanto isso mexeu no que um deve ao outro" (C1).
 */
export function comSinal(v: number): string {
  return (v > 0 ? '+' : v < 0 ? '−' : '') + brl(Math.abs(v));
}

/**
 * 'yyyy-MM-dd' → { dia, mes }.
 *
 * Fatiando a string, não construindo `Date`: `new Date('2026-08-20')` é
 * interpretado como UTC e em fuso negativo volta um dia. É a mesma armadilha
 * da regra 6, do outro lado da junta.
 */
export function diaMes(iso: string): { dia: string; mes: string } {
  return { dia: iso.slice(8, 10), mes: MESES_ABREV[Number(iso.slice(5, 7)) - 1] ?? '' };
}

/** 'yyyy-MM-dd' → 'dd/MM/yyyy'. */
export function dataBR(iso: string): string {
  return iso.slice(0, 10).split('-').reverse().join('/');
}

/** 'yyyy-MM-dd' → 'ago/26'. */
export function mesAno(iso: string): string {
  const m = MESES_ABREV[Number(iso.slice(5, 7)) - 1] ?? '';
  return m.charAt(0) + m.slice(1).toLowerCase() + '/' + iso.slice(2, 4);
}

/** O `9` de `Seguro Carro 09/12` vira `09/12`, com a largura do total. */
export function rotuloParcela(seq: number, total: number | null): string {
  if (!total) return '';
  const largura = String(total).length;
  return `${String(seq).padStart(largura, '0')}/${total}`;
}
