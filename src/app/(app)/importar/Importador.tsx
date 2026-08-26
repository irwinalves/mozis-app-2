'use client';

/**
 * A importação da fatura, em duas etapas na mesma rota.
 *
 * POR QUE UMA ROTA SÓ
 *
 * A análise de 154 linhas nasce de um arquivo do aparelho e não existe no
 * banco até o botão do fim. Passá-la para uma segunda rota exigiria serializar
 * tudo em `sessionStorage` — mais uma cópia da verdade, que é exatamente o que
 * a regra nº 3 proíbe. Duas etapas, um estado.
 *
 * O CRUZAMENTO INFORMA, NUNCA DECIDE
 *
 * Nenhuma linha é lançada nem descartada por ter casado. O que o casamento faz
 * é ORDENAR o trabalho em três abas e escolher o padrão de cada uma — e todas
 * as três aparecem, com o que casou visível, para a validação acontecer sobre
 * o conjunto inteiro. Qualquer linha pode ser tirada da aba onde caiu.
 *
 * A ordem das abas é a ordem do esforço: o que já está no app é conferência, o
 * que é parcelado tem consequência futura, e o que é novo é o volume.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { rpc } from '@/lib/rpc';
import type { analisarFatura, previewConciliacao, LinhaParaLancar } from '@/lib/api';
import { brl, comSinal, dataBR, diaMes } from '@/lib/formato';
import { Avatar } from '@/components/Avatar';
import type { Pessoa } from '@/lib/pessoas';

type Analise = Awaited<ReturnType<typeof analisarFatura>>;
type Linha = Analise['linhas'][number];
type Preview = Awaited<ReturnType<typeof previewConciliacao>>;

interface Opcoes {
  gruposLancar: { nome: string; tipo: string }[];
  divisoes: string[];
  pagadores: string[];
}

/** O que o app já tem para uma linha que casou. */
interface LadoApp {
  id: number;
  data: string;
  descricao: string;
  categoria: string;
  tipo: string;
  valor: number;
  divisao: string;
  quemPagou: string | null;
  serieId: number | null;
}
const ladoApp = (a: Linha['app']): LadoApp | null => (a as unknown as LadoApp) ?? null;

const ABAS = [
  { id: 'app', rotulo: 'Já no app' },
  { id: 'parc', rotulo: 'Parcelados' },
  { id: 'novos', rotulo: 'Novos' },
] as const;
type Aba = (typeof ABAS)[number]['id'];

/**
 * A divisão com que cada linha nasce.
 *
 * O padrão é `100% de quem pagou`: a fatura é de cartão individual e a maioria
 * esmagadora é compra de um só. Dividir tudo meio a meio por omissão criaria
 * dívida entre os dois em 111 linhas de uma vez — e o erro seria silencioso,
 * porque cada linha isolada parece plausível.
 */
const PADRAO_PAGADOR = 'pagador';

interface Estado {
  marcada: boolean;
  grupo: string;
  divisao: string;
  quemPagou: string;
  aberta: boolean;
  /** Tirada da aba onde o cruzamento a pôs: passa a valer como gasto novo. */
  forcadaNova: boolean;
  /** O valor que o app tem agora — muda quando se adota o da fatura. */
  valorApp: number | null;
}

export function Importador({ opcoes, eu }: { opcoes: Opcoes; eu: Pessoa | null }) {
  const router = useRouter();

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [padraoDivisao, setPadraoDivisao] = useState<string>(PADRAO_PAGADOR);
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [est, setEst] = useState<Record<number, Estado>>({});
  const [aba, setAba] = useState<Aba>('app');
  const [ocupado, setOcupado] = useState('');
  const [erro, setErro] = useState('');

  const tipoDoGrupo = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of opcoes.gruposLancar) m.set(g.nome, g.tipo);
    return m;
  }, [opcoes.gruposLancar]);

  // -------------------------------------------------------------------------
  // Etapa 1 — o arquivo
  // -------------------------------------------------------------------------

  async function analisar() {
    if (!arquivo) return;
    setErro('');
    setOcupado('Lendo a fatura…');
    try {
      const b64 = await paraBase64(arquivo);
      const a = await rpc('analisarFatura', b64, arquivo.name);
      const inicial: Record<number, Estado> = {};
      for (const l of a.linhas) {
        const quemPagou = l.quemPagou ?? '';
        inicial[l.i] = {
          // Só nasce marcado o que o cruzamento não achou no app. O que casou
          // entra desmarcado — inclusive a suspeita, que é palpite (C7) e
          // marcar por palpite é como se duplica um gasto.
          marcada: l.situacao.tipo === 'nova' || l.situacao.tipo === 'novaSerie',
          grupo: l.categoriaSugerida,
          divisao: divisaoInicial(padraoDivisao, quemPagou),
          quemPagou,
          aberta: false,
          forcadaNova: false,
          valorApp: ladoApp(l.app)?.valor ?? null,
        };
      }
      setEst(inicial);
      setAnalise(a);
      setAba('app');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui ler o arquivo.');
    } finally {
      setOcupado('');
    }
  }

  // -------------------------------------------------------------------------
  // Etapa 2 — a revisão
  // -------------------------------------------------------------------------

  // `est` entra na dependência porque `forcadaNova` muda a aba de uma linha.
  const porAba = useMemo(() => {
    const m: Record<Aba, Linha[]> = { app: [], parc: [], novos: [] };
    for (const l of analise?.linhas ?? []) {
      const s = l.situacao;
      const a: Aba = est[l.i]?.forcadaNova
        ? 'novos'
        : s.tipo === 'jaLancado' || s.tipo === 'suspeita'
          ? 'app'
          : s.tipo === 'novaSerie'
            ? 'parc'
            : 'novos';
      m[a].push(l);
    }
    return m;
  }, [analise, est]);

  const marcadas = (analise?.linhas ?? []).filter((l) => est[l.i]?.marcada);

  /** Quantos LANÇAMENTOS saem: uma parcelada marcada vira N, não uma. */
  const quantosLancamentos = marcadas.reduce(
    (n, l) => n + (parcelasDe(l, est[l.i]) ?? 1),
    0,
  );
  const somaMarcadas = marcadas.reduce(
    (s, l) => s + l.valor * (parcelasDe(l, est[l.i]) ?? 1),
    0,
  );
  const semPagador = marcadas.filter((l) => !est[l.i]?.quemPagou || !est[l.i]?.divisao);

  const trocar = (i: number, mud: Partial<Estado>) =>
    setEst((s) => ({ ...s, [i]: { ...s[i], ...mud } }));

  function marcarAba(a: Aba, valor: boolean) {
    setEst((s) => {
      const novo = { ...s };
      for (const l of porAba[a]) novo[l.i] = { ...novo[l.i], marcada: valor };
      return novo;
    });
  }

  async function lancar() {
    if (!analise || !marcadas.length) return;
    setErro('');
    setOcupado('Lançando…');
    try {
      const linhas: LinhaParaLancar[] = marcadas.map((l) => {
        const e = est[l.i];
        return {
          data: l.data,
          descricao: l.descricao,
          valor: l.valor,
          grupo: e.grupo,
          tipo: tipoDoGrupo.get(e.grupo),
          quemPagou: e.quemPagou,
          divisao: e.divisao,
          parcelas: parcelasDe(l, e),
        };
      });
      const r = await rpc('lancarFatura', linhas, {
        titulo: tituloDa(analise),
        arquivo: analise.arquivo,
        criadaPor: eu,
      });
      router.push(`/importacao/${r.importacaoId}`);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui lançar.');
      setOcupado('');
    }
  }

  // -------------------------------------------------------------------------

  if (!analise) {
    return (
      <>
        <div className="conteudo">
          <div className="pad">
            {erro && <div className="msg-erro">{erro}</div>}

            <div className="card">
              <div className="campo">
                <label>O que é este arquivo</label>
                <div className="seg">
                  <button type="button" className="on">
                    Cartão de crédito
                  </button>
                  <button type="button" disabled title="Ainda não">
                    Conta corrente
                  </button>
                </div>
                {/* C7 — a tela pergunta em vez de adivinhar. No cartão o gasto
                    é POSITIVO; no extrato de conta é negativo. Aplicar a regra
                    errada não dá erro: descarta tudo que interessa, calado. */}
                <div className="dica">
                  O extrato de conta ainda não entra — ele vem em <code>.xls</code> antigo, que
                  precisa de outra biblioteca.
                </div>
              </div>

              <div className="campo">
                <label>Arquivo da fatura</label>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(ev) => setArquivo(ev.target.files?.[0] ?? null)}
                />
                {arquivo && <div className="dica">{arquivo.name}</div>}
              </div>

              <div className="campo">
                <label>Divisão padrão das linhas</label>
                <div className="seg seg-quebra">
                  {[
                    { v: PADRAO_PAGADOR, r: 'De quem pagou' },
                    { v: '50/50', r: '50/50' },
                    { v: '100% Irwin', r: '100% Irwin' },
                    { v: '100% Maria', r: '100% Maria' },
                  ].map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      className={padraoDivisao === o.v ? 'on' : ''}
                      onClick={() => setPadraoDivisao(o.v)}
                    >
                      {o.r}
                    </button>
                  ))}
                </div>
                <div className="dica">
                  Cada linha pode ser mudada depois. O padrão é <b>de quem pagou</b> porque o
                  cartão é individual e a maioria é compra de um só.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="barra-acao">
          <button
            className={`btn-full ${arquivo && !ocupado ? 'valido' : ''}`}
            disabled={!arquivo || !!ocupado}
            onClick={analisar}
          >
            {ocupado || 'Analisar fatura'}
          </button>
        </div>
      </>
    );
  }

  const lista = porAba[aba];

  return (
    <>
      <div className="conteudo">
        <div className="pad">
          {erro && <div className="msg-erro">{erro}</div>}

          <div className="card suave resumo-fat">
            <div className="nome">{analise.arquivo}</div>
            <div className="l2">
              <b>{brl(analise.total)}</b> · {analise.linhas.length} linhas
            </div>
            {analise.descartadas.length > 0 && (
              <div className="l3">
                {analise.descartadas.length} descartadas: pagamento da fatura, estorno e crédito
                não são gasto novo.
              </div>
            )}
          </div>

          <div className="abas">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={aba === a.id ? 'on' : ''}
                onClick={() => setAba(a.id)}
              >
                {a.rotulo}
                <b>{porAba[a.id].length}</b>
              </button>
            ))}
          </div>

          {aba === 'app' && (
            <div className="dica dica-aba">
              Nada aqui será lançado de novo. Confira, e onde o valor divergir você pode adotar o
              da fatura — isso muda o acerto do mês.
            </div>
          )}
          {aba === 'parc' && (
            <div className="dica dica-aba">
              Cada uma vira a série inteira, com as parcelas futuras já lançadas. É o que faz a
              fatura do mês que vem reconhecer a parcela 2 em vez de duplicar.
            </div>
          )}
          {aba === 'novos' && (
            <div className="dica dica-aba">
              A categoria é palpite pelo texto e erra bastante — toque na linha para mudar.
            </div>
          )}

          <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
            <div className="titulo-lista">
              <span>{lista.filter((l) => est[l.i]?.marcada).length} marcadas</span>
              <span className="acoes-lista">
                <button type="button" onClick={() => marcarAba(aba, true)}>
                  todas
                </button>
                <button type="button" onClick={() => marcarAba(aba, false)}>
                  nenhuma
                </button>
              </span>
            </div>

            {lista.length === 0 ? (
              <div className="vazio">Nada nesta aba.</div>
            ) : (
              lista.map((l) => (
                <LinhaFatura
                  key={l.i}
                  linha={l}
                  estado={est[l.i]}
                  opcoes={opcoes}
                  eu={eu}
                  onTrocar={(m) => trocar(l.i, m)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <div className="barra-acao">
        {semPagador.length > 0 && (
          <div className="aviso" style={{ marginTop: 0, marginBottom: 9 }}>
            <span>⚠</span>
            <div>
              {semPagador.length === 1 ? 'Uma linha marcada está' : `${semPagador.length} linhas marcadas estão`}{' '}
              <b>sem pagador ou sem divisão</b>. Sem isso a linha fica fora do acerto sem aviso
              nenhum, e o servidor recusa.
            </div>
          </div>
        )}
        <button
          className={`btn-full ${marcadas.length && !semPagador.length && !ocupado ? 'valido' : ''}`}
          disabled={!marcadas.length || semPagador.length > 0 || !!ocupado}
          onClick={lancar}
        >
          {ocupado || `Lançar ${marcadas.length} · ${brl(somaMarcadas)}`}
          {!ocupado && quantosLancamentos !== marcadas.length && (
            <b>{quantosLancamentos} lançamentos, contando as parcelas futuras</b>
          )}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// A linha
// ---------------------------------------------------------------------------

function LinhaFatura({
  linha: l,
  estado: e,
  opcoes,
  eu,
  onTrocar,
}: {
  linha: Linha;
  estado: Estado;
  opcoes: Opcoes;
  eu: Pessoa | null;
  onTrocar: (m: Partial<Estado>) => void;
}) {
  const { dia, mes } = diaMes(l.data);
  const app = ladoApp(l.app);
  const s = l.situacao;
  const casou = !e.forcadaNova && (s.tipo === 'jaLancado' || s.tipo === 'suspeita');
  const serie = !e.forcadaNova && s.tipo === 'novaSerie' ? s.parcelas : null;

  // A divergência é medida contra o valor que o app tem AGORA — depois de uma
  // conciliação ela some, e some sozinha.
  const dif = e.valorApp === null ? null : arred(l.valor - e.valorApp);

  return (
    <div className={`linha-fat${e.marcada ? ' marcada' : ''}`}>
      <div className="topo" onClick={() => onTrocar({ aberta: !e.aberta })} role="button" tabIndex={0}>
        <input
          type="checkbox"
          checked={e.marcada}
          onClick={(ev) => ev.stopPropagation()}
          onChange={(ev) => onTrocar({ marcada: ev.target.checked })}
          aria-label={`Lançar ${l.descricao}`}
        />
        <div className="col-data">
          <div className="dia">{dia}</div>
          <div className="mes">{mes}</div>
        </div>
        <Avatar quem={(e.quemPagou || null) as never} tamanho={22} className="quem-pagou" />
        <div className="item-info">
          <div className="desc">
            {l.parcela && <span className="parc">{l.parcela.n}/{l.parcela.de}</span>}
            {l.descricao}
          </div>
          <div className="meta">
            {casou
              ? s.tipo === 'jaLancado'
                ? `já no app · ${s.serieDescricao} ${s.seq}/${s.total}`
                : 'pode já estar no app'
              : serie
                ? `vira ${serie} parcelas de ${brl(l.valor)}`
                : [e.grupo.replace(/^\d+\s/, ''), e.divisao].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="item-valor">
          <div className="v">{brl(l.valor)}</div>
          {dif !== null && Math.abs(dif) >= 0.005 && (
            <div className="partes">
              <span className="efeito neg">{comSinal(dif)} vs. app</span>
            </div>
          )}
        </div>
      </div>

      {e.aberta && (
        <div className="corpo-fat">
          {/* O lado da FATURA em tom de observação, e os campos preenchidos com
              o que o app já tem: a tela mostra de onde veio cada número. */}
          <div className="da-fatura">
            na fatura · {dataBR(l.data)} · {l.nomeCartao || 'sem nome'}
            {l.cartao ? ` · ${l.cartao}` : ''}
            {l.tipoCartao ? ` · ${l.tipoCartao.toLowerCase()}` : ''}
          </div>

          {casou && app ? (
            <Conciliacao
              linha={l}
              app={app}
              valorApp={e.valorApp}
              suspeita={s.tipo === 'suspeita'}
              eu={eu}
              onConciliou={(v) => onTrocar({ valorApp: v })}
              onNova={() => onTrocar({ forcadaNova: true, marcada: true, aberta: true })}
            />
          ) : (
            <>
              {serie && (
                <div className="aviso" style={{ marginTop: 0 }}>
                  <span>⚠</span>
                  <div>
                    Vira uma série de <b>{serie} parcelas</b> de {brl(l.valor)}, uma por mês a
                    partir de {dataBR(l.data)}. As futuras já entram lançadas.
                  </div>
                </div>
              )}
              <div className="campo">
                <label>Categoria</label>
                <select value={e.grupo} onChange={(ev) => onTrocar({ grupo: ev.target.value })}>
                  {opcoes.gruposLancar.map((g) => (
                    <option key={g.nome} value={g.nome}>
                      {g.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grade">
                <div className="campo">
                  <label>Quem pagou</label>
                  <select
                    value={e.quemPagou}
                    onChange={(ev) => onTrocar({ quemPagou: ev.target.value })}
                  >
                    <option value="">—</option>
                    {opcoes.pagadores.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="campo">
                  <label>Divisão</label>
                  <select value={e.divisao} onChange={(ev) => onTrocar({ divisao: ev.target.value })}>
                    <option value="">—</option>
                    {opcoes.divisoes
                      .filter((d) => d !== 'Custom')
                      .map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              {e.forcadaNova && (
                <div className="dica">
                  Tirada da aba &ldquo;Já no app&rdquo; por você: vai ser lançada como gasto novo.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conciliação — adotar o valor da fatura num lançamento que já existe
// ---------------------------------------------------------------------------

function Conciliacao({
  linha: l,
  app,
  valorApp,
  suspeita,
  eu,
  onConciliou,
  onNova,
}: {
  linha: Linha;
  app: LadoApp;
  valorApp: number | null;
  suspeita: boolean;
  eu: Pessoa | null;
  onConciliou: (v: number) => void;
  onNova: () => void;
}) {
  const [prev, setPrev] = useState<Preview | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const dif = valorApp === null ? 0 : arred(l.valor - valorApp);

  async function pedirPreview() {
    setErro('');
    setOcupado(true);
    try {
      setPrev(await rpc('previewConciliacao', app.id, l.valor));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui calcular.');
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar() {
    setErro('');
    setOcupado(true);
    try {
      await rpc('conciliarValor', app.id, l.valor);
      onConciliou(l.valor);
      setPrev(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui gravar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      {suspeita && (
        <div className="aviso" style={{ marginTop: 0 }}>
          <span>⚠</span>
          <div>
            <b>É palpite.</b> Casou só por valor e data próxima — a descrição não bate. Confira
            antes de tratar como o mesmo gasto.
          </div>
        </div>
      )}

      <div className="no-app">
        <div className="rot">no app</div>
        <div className="ln">
          <span className="q">Descrição</span>
          <b>{app.descricao}</b>
        </div>
        <div className="ln">
          <span className="q">Data</span>
          <b>{dataBR(app.data)}</b>
        </div>
        <div className="ln">
          <span className="q">Categoria</span>
          <b>{app.categoria}</b>
        </div>
        <div className="ln">
          <span className="q">Divisão</span>
          <b>
            {app.divisao} · {app.quemPagou ?? 'sem pagador'}
          </b>
        </div>
        <div className="ln">
          <span className="q">Valor</span>
          <b>{brl(valorApp ?? app.valor)}</b>
        </div>
      </div>

      {erro && <div className="msg-erro" style={{ marginTop: 9 }}>{erro}</div>}

      {Math.abs(dif) >= 0.005 ? (
        <>
          <div className="dica" style={{ marginTop: 9 }}>
            A fatura diz <b>{brl(l.valor)}</b>, o app tem <b>{brl(valorApp ?? 0)}</b> —{' '}
            {comSinal(dif)}. Costuma ser arredondamento na hora de lançar à mão.
          </div>

          {!prev ? (
            <button type="button" className="btn-linha" disabled={ocupado} onClick={pedirPreview}>
              {ocupado ? 'Calculando…' : 'Adotar o valor da fatura'}
            </button>
          ) : (
            <div className="prev">
              <h4>o que muda</h4>
              <div className="fim">
                <span>Valor</span>
                <span className="num">
                  <s>{brl(prev.antes.valor)}</s> {brl(prev.depois.valor)}
                </span>
              </div>
              <div className="fim">
                <span>No acerto deste mês</span>
                <span
                  className={`num ${prev.deltaAcerto > 0 ? 'pos' : prev.deltaAcerto < 0 ? 'neg' : ''}`}
                >
                  {Math.abs(prev.deltaAcerto) < 0.005
                    ? 'sem impacto'
                    : comSinal(eu === 'Maria' ? -prev.deltaAcerto : prev.deltaAcerto)}
                </span>
              </div>
              <button type="button" className="btn-linha forte" disabled={ocupado} onClick={confirmar}>
                {ocupado ? 'Gravando…' : 'Confirmar'}
              </button>
              <button type="button" className="btn-linha" onClick={() => setPrev(null)}>
                Cancelar
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="dica" style={{ marginTop: 9 }}>
          Mesmo valor nos dois lados. Nada a conciliar.
        </div>
      )}

      <button type="button" className="btn-linha" onClick={onNova}>
        Não é o mesmo gasto — lançar como novo
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

function divisaoInicial(padrao: string, quemPagou: string): string {
  if (padrao !== PADRAO_PAGADOR) return padrao;
  // Sem nome reconhecido no cartão não se inventa pagador nem divisão: pela A4
  // a linha fica travada até alguém escolher.
  return quemPagou === 'Irwin' || quemPagou === 'Maria' ? `100% ${quemPagou}` : '';
}

/** Quantas parcelas a linha vira. `null` = uma linha só. */
function parcelasDe(l: Linha, e: Estado | undefined): number | null {
  if (!e || e.forcadaNova) return null;
  return l.situacao.tipo === 'novaSerie' ? l.situacao.parcelas : null;
}

const arred = (v: number) => Math.round(v * 100) / 100;

/** `fatura-paga-final 8607-agosto2026.xlsx` → um título legível para o lote. */
function tituloDa(a: Analise): string {
  const datas = a.linhas.map((l) => l.data).sort();
  const ultima = datas[datas.length - 1] ?? '';
  const mes = ultima ? dataBR(ultima).slice(3) : '';
  return `Fatura do cartão${mes ? ` · ${mes}` : ''}`;
}

/**
 * O arquivo em base64, em pedaços.
 *
 * `String.fromCharCode(...bytes)` com 100 KB estoura a pilha de chamadas do
 * navegador — o argumento vira uma lista de 100 mil itens.
 */
async function paraBase64(f: File): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
