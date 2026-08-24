/**
 * Quanto uma linha mexeu no que um deve ao outro — C1 do `PARA-O-APP-2.0.md`.
 *
 * **Não é a fatia do gasto.** Mostrar "parte de cada um" parece informativo e
 * não é: as duas partes são sempre positivas e somam o total, então duas
 * transações idênticas aparecem idênticas mesmo quando o efeito no saldo é
 * exatamente OPOSTO. Um gasto de R$ 200 meio a meio mostra "100 e 100" tenha
 * pago um ou tenha pago o outro — e quem pagou é a única coisa que muda o saldo.
 *
 * Dois detalhes que a regra manda copiar:
 *
 * - Os dois lados são **espelho exato**. O servidor manda um número só; o outro
 *   é o negativo. Trazer os dois seria duas verdades para a mesma coisa.
 * - Efeito **zero** — quem pagou é dono de 100% do gasto, ou cada um pôs a
 *   própria parte — vira "sem impacto". Escrever "+0 · −0" é ruído.
 *
 * E a personalização, decidida em 22/08/2026: **cada um vê só o seu lado**.
 * O mesmo lançamento mostra `+R$ 99,89` para o Irwin e `−R$ 99,89` para a
 * Maria. Sem sessão, mostra os dois.
 */
import { comSinal } from '@/lib/formato';
import type { Pessoa } from '@/lib/pessoas';

/** Meio centavo: o piso do que a aritmética de ponto flutuante promete. */
const ZERO = 0.005;

export function EfeitoNoAcerto({
  saldoIrwin,
  eu,
  className = '',
}: {
  /** Positivo = Maria deve ao Irwin. É a coluna `saldo_irwin` da view. */
  saldoIrwin: number | null;
  eu: Pessoa | null;
  className?: string;
}) {
  if (saldoIrwin === null) {
    return <span className={`efeito nulo ${className}`}>sem pagador</span>;
  }
  if (Math.abs(saldoIrwin) < ZERO) {
    return <span className={`efeito nulo ${className}`}>sem impacto</span>;
  }

  if (eu === 'Irwin' || eu === 'Maria') {
    const meu = eu === 'Irwin' ? saldoIrwin : -saldoIrwin;
    return (
      <span className={`efeito ${meu > 0 ? 'pos' : 'neg'} ${className}`}>{comSinal(meu)}</span>
    );
  }

  // Sem sessão: os dois lados, e o segundo é o espelho do primeiro.
  return (
    <span className={`efeito ${className}`}>
      <span className={saldoIrwin > 0 ? 'pos' : 'neg'}>{comSinal(saldoIrwin)}</span>
      <span className="sep"> · </span>
      <span className={saldoIrwin > 0 ? 'neg' : 'pos'}>{comSinal(-saldoIrwin)}</span>
    </span>
  );
}
