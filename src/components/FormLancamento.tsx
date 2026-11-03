'use client';

/**
 * O formulário de lançamento — UM, para todas as telas que o precisam.
 *
 * POR QUE ELE EXISTE
 *
 * Até aqui havia TRÊS formulários do mesmo objeto: o do `Form.html` (completo,
 * em JS solto), o da edição de série e o da revisão de importação — estes dois
 * reconstruídos em React, cada um com um subconjunto diferente dos campos.
 * Não foi escolha: como o original vive em HTML servido byte a byte, não havia
 * o que reusar. O custo apareceu na primeira pergunta do Irwin — por que a
 * tela de editar série não deixa editar o lançamento inteiro.
 *
 * É a regra nº 3 (uma implementação, nunca duas) em três cópias. Este arquivo
 * fecha isso: a tela de Lançar usa ele agora, e série e importação passam a
 * usar em seguida, com `modo` trocando só o que muda.
 *
 * O QUE MUDOU EM RELAÇÃO AO FORMULÁRIO ANTIGO, e por quê
 *
 * - A barra de porcentagem da divisão `Custom` virou **dois campos de valor**.
 *   Medido: `Custom` é 951 de 3.802 lançamentos — um quarto da base foi
 *   digitado arrastando uma barrinha para acertar um número.
 * - "Quem pagou" e "Como dividir" ficaram **numeradas e explicadas**: são duas
 *   perguntas diferentes, e o acerto é exatamente a subtração entre elas. O
 *   próprio Irwin só percebeu isso vendo o protótipo.
 * - Categoria **não muda mais o tipo sozinha**. Nem tudo de casa é fixo.
 * - `Variável` passa a ser o padrão, por ser o caso comum.
 * - A prévia de parcelas e de ocorrências vem do SERVIDOR, das mesmas funções
 *   que gravam (`montarParcelas` / `montarRecorrencias`). Recalcular as datas
 *   aqui seria a quarta cópia da regra de clamp de fim de mês.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { rpc, ErroRpc } from '@/lib/rpc';
import { brl, lerMoeda, mascaraMoeda, numero } from '@/lib/formato';

export type Opcoes = Awaited<ReturnType<typeof import('@/lib/api').getOpcoes>>;

/** Divisões que a tela oferece. A ordem é a da tela, e `Renda` fecha a lista:
 *  ainda não foi usada nenhuma vez em 3.802 lançamentos, mas é para ser. */
const DIVISOES = ['50/50', '100% Irwin', '100% Maria', 'Custom', 'Renda', 'De fora'] as const;
type Divisao = (typeof DIVISOES)[number];

const ROTULO_DIVISAO: Record<Divisao, string> = {
  '50/50': '50/50',
  '100% Irwin': '100% Irwin',
  '100% Maria': '100% Maria',
  Custom: 'Valor exato',
  Renda: 'Por renda',
  'De fora': 'De fora',
};

/** Quem, fora do casal, pode ser dono de um gasto que passou pelo cartão. */
const DE_FORA = ['Mãe do Irwin', 'Avô da Maria', 'Outra pessoa'];

type Repeticao = 'nao' | 'parcelado' | 'recorrente';

/** A cor é da CATEGORIA, não do estado do botão: é ela que volta nos gráficos
 *  do mês, então mudar aqui desalinha o relatório. */
const COR_CATEGORIA: Record<string, string> = {
  '1 Casa': '#2F5597',
  '2 Carro': '#1F7A6B',
  '3 Comida': '#4E8C2A',
  '4 Saúde': '#B23A3A',
  '5 Lazer & Pessoal': '#B5407A',
  '6 Viagem': '#1B7FA8',
  '7 Outros': '#6E6E6E',
  '8 Investimentos': '#2E6B2E',
  '9 Acerto de Contas': '#8A6D00',
};

/** O mesmo leitor do `Form.html`, pelo mesmo motivo: uma implementação só. */
const paraNumero = lerMoeda;

function arred(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A fração do Irwin para cada divisão. `Custom` não entra aqui porque é
 *  justamente a que o usuário define — ela vem do estado. */
function fracaoDe(divisao: Divisao, pctRenda: number): number | null {
  if (divisao === '50/50') return 0.5;
  if (divisao === '100% Irwin') return 1;
  if (divisao === '100% Maria') return 0;
  if (divisao === 'Renda') return pctRenda;
  if (divisao === 'De fora') return 0;
  return null;
}

interface Props {
  opcoes: Opcoes;
  /** Para onde voltar depois de salvar. */
  aoSalvar?: () => void;
}

export default function FormLancamento({ opcoes, aoSalvar }: Props) {
  const router = useRouter();
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [data, setData] = useState(opcoes.hoje);
  const [categoria, setCategoria] = useState('');
  const [tipo, setTipo] = useState('Variável');
  const [origem, setOrigem] = useState('Cartão');
  const [pagador, setPagador] = useState<string>(opcoes.eu ?? 'Irwin');
  const [divisao, setDivisao] = useState<Divisao>('50/50');
  const [fracao, setFracao] = useState(0.5);
  const [ehAndre, setEhAndre] = useState(false);
  const [quemDeFora, setQuemDeFora] = useState(DE_FORA[0]);
  const [obs, setObs] = useState('');

  const [repeticao, setRepeticao] = useState<Repeticao>('nao');
  const [parcelas, setParcelas] = useState('12');
  const [tipoValor, setTipoValor] = useState<'total' | 'parcela'>('total');
  const [freq, setFreq] = useState('mensal');
  const [fimRec, setFimRec] = useState('');

  /** `null` = cada um pôs a própria parte, que é o padrão e NÃO gera dívida. */
  const [pagoIrwinManual, setPagoIrwinManual] = useState<number | null>(null);

  const [previa, setPrevia] = useState<{ data: string; descricao: string; valor: number }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [avisoValor, setAvisoValor] = useState(false);

  /**
   * O texto cru do campo que está sob o dedo.
   *
   * Sem isto, reescrever os dois lados a cada tecla faz o cursor pular e
   * atropela o que está sendo digitado — `1` vira `1,00` antes de virar `10`.
   * O outro lado continua derivado da fração, que é a verdade.
   */
  const [digitando, setDigitando] = useState<{ lado: 'irwin' | 'maria'; texto: string } | null>(null);
  const totalAnterior = useRef(0);

  const total = paraNumero(valor);
  const parteIrwin = arred(total * fracao);
  const parteMaria = arred(total - parteIrwin);

  const pagoIrwin =
    pagador === 'Irwin' ? total
    : pagador === 'Maria' ? 0
    : (pagoIrwinManual ?? parteIrwin);

  /** O acerto é esta subtração, e nada mais: o que a pessoa desembolsou menos
   *  o que lhe cabe. Mostrar aqui é a C1 aplicada ao formulário. */
  const efeito = arred(pagoIrwin - parteIrwin);

  function escolherDivisao(d: Divisao) {
    setDivisao(d);
    const f = fracaoDe(d, opcoes.pctIrwinRenda);
    if (f !== null) setFracao(f);
    setDigitando(null);
  }

  /**
   * Mudar o total mantém a PROPORÇÃO, não o valor digitado — foi a decisão de
   * 22/10, e é o que o banco guarda. A tela avisa, em vez de deixar o número
   * em reais mudar em silêncio debaixo do dedo.
   */
  function mudouValor(texto: string) {
    const novo = paraNumero(texto);
    if (divisao === 'Custom' && totalAnterior.current > 0 && novo > 0 && novo !== totalAnterior.current) {
      setAvisoValor(true);
      setTimeout(() => setAvisoValor(false), 4500);
    }
    totalAnterior.current = novo;
    setValor(texto);
  }

  const buscarPrevia = useCallback(async () => {
    if (repeticao === 'nao' || total <= 0 || !descricao) {
      setPrevia([]);
      return;
    }
    try {
      const base = { data, descricao, valor: total };
      const r =
        repeticao === 'parcelado'
          ? await rpc('previewParcelas', { ...base, parcelado: true, parcelas, tipoValor })
          : await rpc('previewRecorrencia', {
              ...base,
              repetir: true,
              freqRec: freq,
              semFimRec: !fimRec,
              fimRec: fimRec || null,
            });
      setPrevia(r);
    } catch {
      setPrevia([]);
    }
  }, [repeticao, total, descricao, data, parcelas, tipoValor, freq, fimRec]);

  useEffect(() => {
    const t = setTimeout(buscarPrevia, 250);
    return () => clearTimeout(t);
  }, [buscarPrevia]);

  function digitouParte(qual: 'irwin' | 'maria', texto: string) {
    setDigitando({ lado: qual, texto });
    if (total <= 0) return;
    const v = Math.min(Math.max(paraNumero(texto), 0), total);
    setFracao((qual === 'irwin' ? v : total - v) / total);
  }

  const categorias = useMemo(
    () => opcoes.gruposLancar.map((g) => g.nome),
    [opcoes.gruposLancar],
  );

  const ehQuitacao = categoria === '9 Acerto de Contas';
  const ehFora = divisao === 'De fora';

  async function salvar() {
    setErro('');
    if (!descricao.trim()) return setErro('Informe a descrição.');
    if (total <= 0) return setErro('Informe um valor maior que zero.');
    if (!categoria) return setErro('Escolha a categoria.');

    setSalvando(true);
    try {
      await rpc('salvarLancamento', {
        data,
        descricao: descricao.trim(),
        grupo: categoria,
        tipo,
        fonte: origem,
        valor: total,
        divisao,
        deFora: ehFora,
        // A coluna guarda FRAÇÃO; a API converte de percentual. Mandar
        // percentual aqui é o contrato — ver `salvarLancamento`.
        pctIrwinCustom: divisao === 'Custom' ? fracao * 100 : null,
        quemPagou: pagador,
        pagoIrwin: pagador === 'Ambos' ? pagoIrwin : null,
        obs: obs.trim() || null,
        gastoDe: ehFora ? quemDeFora : ehAndre ? 'André' : null,
        parcelado: repeticao === 'parcelado',
        /**
         * `parcelas` SÓ vai quando é parcelado.
         *
         * `montarParcelas` lê este campo sem olhar para `parcelado` — mandar
         * "12" com `parcelado: false` cria doze parcelas em silêncio. Pego no
         * primeiro lançamento de verdade: a tela dizia "Nenhuma" e o banco
         * recebeu `1/12` a `12/12`. É a E1 inteira num caso só — a tela não
         * prova nada, o que foi gravado prova.
         */
        parcelas: repeticao === 'parcelado' ? parcelas : 1,
        tipoValor,
        repetir: repeticao === 'recorrente',
        freqRec: freq,
        fimRec: fimRec || null,
        semFimRec: repeticao === 'recorrente' && !fimRec,
      });
      if (aoSalvar) aoSalvar();
      else router.push('/');
    } catch (e) {
      setErro(e instanceof ErroRpc ? e.message : 'Não deu para salvar.');
      setSalvando(false);
    }
  }

  return (
    <div className="form-lanc">
      <div className="card">
        <div className="linha-desc">
          <label className="campo">
            <span>Descrição</span>
            <input
              type="text"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: Supermercado"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="btn-andre"
            aria-pressed={ehAndre}
            title="Gasto do André"
            onClick={() => setEhAndre((v) => !v)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/avatar-andre.jpg" alt="André" />
          </button>
        </div>
        <div className="linha" style={{ marginTop: 12 }}>
          <label className="campo">
            <span>Valor</span>
            <input
              type="text"
              inputMode="decimal"
              value={valor}
              onChange={(e) => mudouValor(mascaraMoeda(e.target.value))}
              placeholder="0,00"
            />
          </label>
          <label className="campo">
            <span>Data</span>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
        </div>
        {ehAndre && (
          <p className="nota">
            Marcado como gasto do <b>André</b>. Isso classifica de quem é o custo —{' '}
            <b>não muda a divisão nem o acerto</b>.
          </p>
        )}
      </div>

      <div className="card">
        <div className="rot">Categoria</div>
        <div className="chips">
          {categorias.map((c) => (
            <button
              key={c}
              type="button"
              className="chip cat"
              style={{ '--c': COR_CATEGORIA[c] ?? '#6E6E6E' } as React.CSSProperties}
              aria-pressed={categoria === c}
              onClick={() => setCategoria(c)}
            >
              <i className="pt" />
              {c}
            </button>
          ))}
        </div>
        {ehQuitacao && (
          <p className="aviso">
            Acerto de contas <b>não é despesa</b>: não entra no resultado do mês. Só abate o que
            um deve ao outro.
          </p>
        )}

        <div className="rot sep">Tipo</div>
        <div className="chips">
          {['Variável', 'Fixa'].map((t) => (
            <button
              key={t}
              type="button"
              className="chip"
              aria-pressed={tipo === t}
              onClick={() => setTipo(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="rot sep">Origem</div>
        <div className="chips">
          {opcoes.origens.map((o) => (
            <button
              key={o}
              type="button"
              className="chip"
              aria-pressed={origem === o}
              onClick={() => setOrigem(o)}
            >
              {o}
            </button>
          ))}
        </div>
        <p className="nota">Banco cobre tudo que sai da conta: Pix, TED, débito automático, boleto.</p>
      </div>

      <div className="card">
        <p className="duas">
          São <b>duas perguntas diferentes</b>, e as duas mexem no acerto de jeitos opostos: de
          quem <b>saiu o dinheiro</b>, e de quem <b>é o gasto</b>.
        </p>

        <div className="rot">
          1 · Quem pagou <span className="leve">de quem saiu o dinheiro</span>
        </div>
        <div className="chips">
          {opcoes.pagadoresLancar.map((p) => (
            <button
              key={p}
              type="button"
              className="chip"
              aria-pressed={pagador === p}
              onClick={() => {
                setPagador(p);
                setPagoIrwinManual(null);
              }}
            >
              <i className={'pt ' + (p === 'Irwin' ? 'i' : p === 'Maria' ? 'm' : 'duo')} />
              {p === 'Ambos' ? 'Os dois' : p}
            </button>
          ))}
        </div>

        {pagador === 'Ambos' && (
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
                    onChange={(e) => setPagoIrwinManual(Math.min(lerMoeda(mascaraMoeda(e.target.value)), total))}
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
                      setPagoIrwinManual(
                        arred(total - Math.min(lerMoeda(mascaraMoeda(e.target.value)), total)),
                      )
                    }
                  />
                </div>
              </div>
            </div>
            <p className="nota">
              Por padrão cada um paga a própria parte, e aí <b>não nasce dívida</b>. Mexa aqui se
              um cobriu o outro.
            </p>
          </>
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
              aria-pressed={divisao === d}
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
              <select value={quemDeFora} onChange={(e) => setQuemDeFora(e.target.value)}>
                {DE_FORA.map((q) => (
                  <option key={q}>{q}</option>
                ))}
              </select>
            </label>
            <p className="aviso">
              Fica <b>registrado e fora das duas contas</b>: não entra no gasto do mês nem no
              acerto entre vocês. O registro serve para a compra não ser confundida com despesa de
              vocês toda vez que reaparecer na fatura.
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
                disabled={divisao !== 'Custom'}
                value={digitando?.lado === 'irwin' ? digitando.texto : numero(parteIrwin)}
                aria-label="Parte do Irwin"
                onChange={(e) => digitouParte('irwin', mascaraMoeda(e.target.value))}
                onBlur={() => setDigitando(null)}
              />
            </div>
            <div className="pct">{total > 0 ? (fracao * 100).toFixed(1) : '0,0'}%</div>
          </div>
          <div className="parte m">
            <div className="quem">Parte da Maria</div>
            <div className="moeda">
              <span className="cifra">R$</span>
              <input
                inputMode="decimal"
                disabled={divisao !== 'Custom'}
                value={digitando?.lado === 'maria' ? digitando.texto : numero(parteMaria)}
                aria-label="Parte da Maria"
                onChange={(e) => digitouParte('maria', mascaraMoeda(e.target.value))}
                onBlur={() => setDigitando(null)}
              />
            </div>
            <div className="pct">{total > 0 ? ((1 - fracao) * 100).toFixed(1) : '0,0'}%</div>
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

        {divisao === 'Renda' && (
          <p className="aviso">
            A proporção de renda está em <b>{(opcoes.pctIrwinRenda * 100).toFixed(2)}%</b> para o
            Irwin, herdada da planilha. Enquanto vocês não definirem a de agora, confira o número
            antes de salvar.
          </p>
        )}
        {avisoValor && (
          <p className="aviso">
            O valor total mudou. A proporção que você definiu foi mantida, então os reais
            acompanharam.
          </p>
        )}
      </div>

      <div className="card">
        <div className="rot">Repetição</div>
        <div className="chips">
          {(
            [
              ['nao', 'Nenhuma'],
              ['parcelado', 'Parcelado'],
              ['recorrente', 'Recorrente'],
            ] as const
          ).map(([v, r]) => (
            <button
              key={v}
              type="button"
              className="chip"
              aria-pressed={repeticao === v}
              onClick={() => setRepeticao(v)}
            >
              {r}
            </button>
          ))}
        </div>

        {repeticao === 'parcelado' && (
          <div className="linha" style={{ marginTop: 13 }}>
            <label className="campo">
              <span>Parcelas</span>
              <input
                type="number"
                min={2}
                max={48}
                value={parcelas}
                onChange={(e) => setParcelas(e.target.value)}
              />
            </label>
            <label className="campo">
              <span>O valor digitado é</span>
              <select value={tipoValor} onChange={(e) => setTipoValor(e.target.value as 'total' | 'parcela')}>
                <option value="total">o total da compra</option>
                <option value="parcela">o de cada parcela</option>
              </select>
            </label>
          </div>
        )}

        {repeticao === 'recorrente' && (
          <div className="linha" style={{ marginTop: 13 }}>
            <label className="campo">
              <span>Frequência</span>
              <select value={freq} onChange={(e) => setFreq(e.target.value)}>
                <option value="mensal">mensal</option>
                <option value="quinzenal">quinzenal</option>
                <option value="semanal">semanal</option>
              </select>
            </label>
            <label className="campo">
              <span>Até quando</span>
              <input type="date" value={fimRec} onChange={(e) => setFimRec(e.target.value)} />
            </label>
          </div>
        )}

        {repeticao !== 'nao' && previa.length > 0 && (
          <div className="previa">
            <div className="cab">
              <span>
                {repeticao === 'parcelado'
                  ? `${previa.length} parcelas`
                  : `${previa.length} ${previa.length === 1 ? 'ocorrência agora' : 'ocorrências agora'}`}
              </span>
            </div>
            <ul>
              {previa.map((p, i) => (
                <li key={i}>
                  <span className="dt">{p.data}</span>
                  {/* O NOME é metade da prévia: é a descrição que vai ser
                      gravada, com o `N/N` que o servidor monta. Sem ele a
                      lista é só um calendário de valores, e não dá para
                      conferir o que vai nascer. */}
                  <span className="nm">{p.descricao}</span>
                  <span className="vl">{brl(p.valor)}</span>
                </li>
              ))}
            </ul>
            <div className="pe">
              {repeticao === 'parcelado'
                ? 'A última parcela absorve o arredondamento.'
                : 'Entram agora só as ocorrências até o fim deste mês. As demais são geradas automaticamente, uma por vez, no dia 1º de cada mês — o app nunca adianta o futuro.'}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <details className="mais">
          <summary>Mais detalhes</summary>
          <div className="detalhes">
            <label className="campo">
              <span>Observação</span>
              <textarea
                rows={2}
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder="De onde veio o número, por que o valor é esse…"
              />
            </label>
          </div>
        </details>
      </div>

      {erro && <p className="erro">{erro}</p>}

      <div className="rodape">
        <div className="dentro">
          <div className="resumo">
            <b>R$ {numero(total)}</b>
            {ehFora
              ? 'de fora'
              : repeticao === 'parcelado'
                ? 'parcelado'
                : repeticao === 'recorrente'
                  ? 'recorrente'
                  : 'à vista'}
          </div>
          <button type="button" className="salvar" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
