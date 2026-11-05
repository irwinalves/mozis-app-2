'use client';

/**
 * As duas perguntas do rateio — UMA implementação, para toda tela que as faz.
 *
 * POR QUE ELE EXISTE, SEPARADO DO FORMULÁRIO
 *
 * "Quem pagou" e "como dividir" são perguntas diferentes, e o acerto é
 * exatamente a subtração entre as respostas. Essa dupla aparece em quatro
 * lugares: lançar, editar um lançamento, editar uma série e revisar uma
 * importação. As duas últimas tinham versões reduzidas — a de série só tinha
 * "Como dividir" num `select`, sem valor exato, sem `De fora`, sem a conta.
 *
 * Juntar as telas inteiras seria errado: a de série tem mecânica própria
 * (escopo de quantas linhas, prévia do diff, botão que só acende se algo
 * mudou). O que se repete é ESTE bloco. Então é ele que vira componente, e
 * não a tela.
 *
 * É CONTROLADO: não guarda a resposta, devolve. Quem guarda é a tela, porque
 * cada uma grava num lugar diferente — `salvarLancamento`,
 * `atualizarLancamento`, `aplicarEdicaoSerie`. O único estado daqui é o
 * rascunho do campo sob o dedo, que é detalhe de digitação e de mais ninguém.
 */

import { useState } from 'react';
import { lerMoeda, mascaraMoeda, numero } from '@/lib/formato';

export const DIVISOES = [
  '50/50',
  '100% Irwin',
  '100% Maria',
  'Custom',
  'Renda',
  'De fora',
] as const;

export type Divisao = (typeof DIVISOES)[number];

export const ROTULO_DIVISAO: Record<Divisao, string> = {
  '50/50': '50/50',
  '100% Irwin': '100% Irwin',
  '100% Maria': '100% Maria',
  Custom: 'Valor exato',
  Renda: 'Por renda',
  'De fora': 'De fora',
};

/** Quem pode ser dono de um gasto que não é do casal. */
export const DE_FORA = ['Mãe do Irwin', 'Avô da Maria', 'Outra pessoa'];

const arred = (v: number) => Math.round(v * 100) / 100;

/**
 * A fração fixa de cada divisão — ou `null` quando ela não tem uma.
 *
 * `Custom` devolve `null` de propósito: a fração vem do que foi digitado, não
 * do rótulo. Quem chama precisa saber a diferença entre "esta divisão define a
 * fração" e "esta divisão aceita qualquer fração".
 */
export function fracaoDe(divisao: Divisao, pctRenda: number): number | null {
  if (divisao === '50/50') return 0.5;
  if (divisao === '100% Irwin') return 1;
  if (divisao === '100% Maria') return 0;
  if (divisao === 'Renda') return pctRenda;
  if (divisao === 'De fora') return 0;
  return null;
}

/** As respostas das duas perguntas, juntas — é isto que a tela guarda. */
export interface Reparticao {
  /** 'Irwin' · 'Maria' · 'Ambos'. */
  pagador: string;
  divisao: Divisao;
  /** Quanto do custo é do Irwin, de 0 a 1. */
  fracao: number;
  /** De quem é o gasto, quando a divisão é `De fora`. */
  quemDeFora: string;
  /** `null` = cada um pôs a própria parte, que é o padrão e NÃO gera dívida. */
  pagoIrwinManual: number | null;
}

/** Quanto o Irwin desembolsou, conforme as duas respostas. */
export function pagoIrwinDe(r: Reparticao, total: number, parteIrwin: number): number {
  if (r.pagador === 'Irwin') return total;
  if (r.pagador === 'Maria') return 0;
  return r.pagoIrwinManual ?? parteIrwin;
}

interface Props {
  /** O valor total do lançamento, já em número. */
  total: number;
  valor: Reparticao;
  aoMudar: (r: Reparticao) => void;
  /** Quem pode ter pagado. Vem de `getOpcoes`, fonte única. */
  pagadores: string[];
  pctIrwinRenda: number;
  /**
   * Avisa que o total mudou e a PROPORÇÃO foi mantida — decisão de 22/10, e é
   * o que o banco guarda. A tela avisa em vez de deixar o número em reais
   * mudar em silêncio debaixo do dedo.
   */
  avisoValor?: boolean;
  /**
   * Mostra "quanto cada um pagou" quando o pagador é `Ambos`. Padrão: sim.
   *
   * A edição de SÉRIE passa `false`, e não por economia de tela: o rateio
   * manual é um valor em reais de UMA linha, e a série tem N linhas com
   * valores possivelmente diferentes. Um número só não se reparte entre elas
   * sem inventar uma regra — então `aplicarMudancas` mantém "cada um pagou a
   * sua parte" em cada linha, e a tela não oferece o que não vai cumprir.
   */
  permitePagoManual?: boolean;
}

export default function DivisaoEPagador({
  total,
  valor: r,
  aoMudar,
  pagadores,
  pctIrwinRenda,
  avisoValor,
  permitePagoManual = true,
}: Props) {
  /**
   * O texto cru do campo que está sob o dedo.
   *
   * Sem isto, reescrever os dois lados a cada tecla faz o cursor pular e
   * atropela o que está sendo digitado — `1` vira `1,00` antes de virar `10`.
   * O outro lado continua derivado da fração, que é a verdade.
   */
  const [digitando, setDigitando] = useState<{ lado: 'irwin' | 'maria'; texto: string } | null>(
    null,
  );

  const parteIrwin = arred(total * r.fracao);
  const parteMaria = arred(total - parteIrwin);
  const pagoIrwin = pagoIrwinDe(r, total, parteIrwin);

  /** O acerto é esta subtração, e nada mais: o que a pessoa desembolsou menos
   *  o que lhe cabe. Mostrar aqui é a C1 aplicada ao formulário. */
  const efeito = arred(pagoIrwin - parteIrwin);
  const ehFora = r.divisao === 'De fora';

  function escolherDivisao(d: Divisao) {
    const f = fracaoDe(d, pctIrwinRenda);
    setDigitando(null);
    aoMudar({ ...r, divisao: d, fracao: f ?? r.fracao });
  }

  function digitouParte(qual: 'irwin' | 'maria', texto: string) {
    setDigitando({ lado: qual, texto });
    if (total <= 0) return;
    const v = Math.min(Math.max(lerMoeda(texto), 0), total);
    aoMudar({ ...r, fracao: (qual === 'irwin' ? v : total - v) / total });
  }

  return (
    <div className="card">
      <p className="duas">
        São <b>duas perguntas diferentes</b>, e as duas mexem no acerto de jeitos opostos: de quem{' '}
        <b>saiu o dinheiro</b>, e de quem <b>é o gasto</b>.
      </p>

      <div className="rot">
        1 · Quem pagou <span className="leve">de quem saiu o dinheiro</span>
      </div>
      <div className="chips">
        {pagadores.map((p) => (
          <button
            key={p}
            type="button"
            className="chip"
            aria-pressed={r.pagador === p}
            onClick={() => aoMudar({ ...r, pagador: p, pagoIrwinManual: null })}
          >
            <i className={'pt ' + (p === 'Irwin' ? 'i' : p === 'Maria' ? 'm' : 'duo')} />
            {p === 'Ambos' ? 'Os dois' : p}
          </button>
        ))}
      </div>

      {r.pagador === 'Ambos' && permitePagoManual && (
        <>
          <div className="rot sep">Quanto cada um pagou</div>
          <div className="partes">
            <div className="parte i">
              <div className="quem">Irwin pagou</div>
              <div className="moeda">
                <span className="cifra">R$</span>
                <input
                  inputMode="decimal"
                  value={numero(pagoIrwin)}
                  aria-label="Quanto o Irwin pagou"
                  onChange={(e) =>
                    aoMudar({
                      ...r,
                      pagoIrwinManual: Math.min(lerMoeda(mascaraMoeda(e.target.value)), total),
                    })
                  }
                />
              </div>
            </div>
            <div className="parte m">
              <div className="quem">Maria pagou</div>
              <div className="moeda">
                <span className="cifra">R$</span>
                <input
                  inputMode="decimal"
                  value={numero(arred(total - pagoIrwin))}
                  aria-label="Quanto a Maria pagou"
                  onChange={(e) =>
                    aoMudar({
                      ...r,
                      pagoIrwinManual: arred(
                        total - Math.min(lerMoeda(mascaraMoeda(e.target.value)), total),
                      ),
                    })
                  }
                />
              </div>
            </div>
          </div>
          <p className="nota">
            Por padrão cada um paga a própria parte, e aí <b>não nasce dívida</b>. Mexa aqui se um
            cobriu o outro.
          </p>
        </>
      )}

      {r.pagador === 'Ambos' && !permitePagoManual && (
        <p className="nota">
          Em cada linha, <b>cada um paga a própria parte</b>. Para dizer que um cobriu o outro em
          uma parcela específica, abra aquela linha.
        </p>
      )}

      <div className="rot sep">
        2 · De quem é o gasto <span className="leve">como dividir o custo</span>
      </div>
      <div className="chips">
        {DIVISOES.map((d) => (
          <button
            key={d}
            type="button"
            className="chip"
            aria-pressed={r.divisao === d}
            onClick={() => escolherDivisao(d)}
          >
            {ROTULO_DIVISAO[d]}
            {d === 'Renda' && <small>a definir</small>}
          </button>
        ))}
      </div>

      {ehFora && (
        <>
          <label className="campo" style={{ marginTop: 12 }}>
            <span>De quem é esse gasto</span>
            <select
              value={r.quemDeFora}
              onChange={(e) => aoMudar({ ...r, quemDeFora: e.target.value })}
            >
              {DE_FORA.map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </label>
          <p className="aviso">
            Fica <b>registrado e fora das duas contas</b>: não entra no gasto do mês nem no acerto
            entre vocês. O registro serve para a compra não ser confundida com despesa de vocês
            toda vez que reaparecer na fatura.
          </p>
        </>
      )}

      {!ehFora && (
        <div className="partes">
          <div className="parte i">
            <div className="quem">Parte do Irwin</div>
            <div className="moeda">
              <span className="cifra">R$</span>
              <input
                inputMode="decimal"
                disabled={r.divisao !== 'Custom'}
                value={digitando?.lado === 'irwin' ? digitando.texto : numero(parteIrwin)}
                aria-label="Parte do Irwin"
                onChange={(e) => digitouParte('irwin', mascaraMoeda(e.target.value))}
                onBlur={() => setDigitando(null)}
              />
            </div>
            <div className="pct">{total > 0 ? (r.fracao * 100).toFixed(1) : '0,0'}%</div>
          </div>
          <div className="parte m">
            <div className="quem">Parte da Maria</div>
            <div className="moeda">
              <span className="cifra">R$</span>
              <input
                inputMode="decimal"
                disabled={r.divisao !== 'Custom'}
                value={digitando?.lado === 'maria' ? digitando.texto : numero(parteMaria)}
                aria-label="Parte da Maria"
                onChange={(e) => digitouParte('maria', mascaraMoeda(e.target.value))}
                onBlur={() => setDigitando(null)}
              />
            </div>
            <div className="pct">{total > 0 ? ((1 - r.fracao) * 100).toFixed(1) : '0,0'}%</div>
          </div>
        </div>
      )}

      {!ehFora && (
        <div className="conta">
          <div className="cab">
            <span>A conta das duas respostas</span>
            <span>Irwin</span>
          </div>
          <div>
            <span>Irwin pagou</span>
            <span className="n">R$ {numero(pagoIrwin)}</span>
          </div>
          <div>
            <span>Ele deve</span>
            <span className="n">− R$ {numero(parteIrwin)}</span>
          </div>
          <div className="fecho">
            <span>
              {efeito === 0
                ? 'Não mexe no acerto'
                : efeito > 0
                  ? 'A Maria passa a dever'
                  : 'O Irwin passa a dever'}
            </span>
            <span className="n">R$ {numero(Math.abs(efeito))}</span>
          </div>
        </div>
      )}

      {r.divisao === 'Renda' && (
        <p className="aviso">
          A proporção de renda está em <b>{(pctIrwinRenda * 100).toFixed(2)}%</b> para o Irwin,
          herdada da planilha. Enquanto vocês não definirem a de agora, confira o número antes de
          salvar.
        </p>
      )}
      {avisoValor && (
        <p className="aviso">
          O valor total mudou. A proporção que você definiu foi mantida, então os reais
          acompanharam.
        </p>
      )}
    </div>
  );
}
