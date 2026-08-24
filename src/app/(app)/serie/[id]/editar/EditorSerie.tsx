'use client';

/**
 * O editor de série. Escopo, campos, prévia.
 *
 * A ordem da tela é a ordem da decisão: primeiro QUANTAS linhas, depois O QUE
 * muda, depois o que vai acontecer. A prévia é sempre a última coisa, e o botão
 * só acende quando algo mudou de fato — é essa trava que impede a unificação
 * de uma série heterogênea de acontecer sem querer, com os campos apenas
 * pré-preenchidos.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { rpc } from '@/lib/rpc';
import type { obterSerie, EscopoSerie, MudancasSerie } from '@/lib/api';
import { brl, comSinal, dataBR, numero } from '@/lib/formato';
import { Avatar } from '@/components/Avatar';
import type { Pessoa } from '@/lib/pessoas';

type Serie = Awaited<ReturnType<typeof obterSerie>>;
type Opcoes = { gruposLancar: { nome: string }[]; origens: string[]; divisoes: string[]; pagadores: string[] };
type Preview = Awaited<ReturnType<typeof import('@/lib/api').previewEdicaoSerie>>;

const MES_EXT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export function EditorSerie({
  serie,
  opcoes,
  eu,
  ancoraId,
}: {
  serie: Serie;
  opcoes: Opcoes;
  eu: Pessoa | null;
  ancoraId: number | null;
}) {
  const router = useRouter();
  const ehParcelamento = serie.tipo === 'parcelamento';
  const itens = serie.itens;
  const ancora = ancoraId ? itens.find((i) => i.id === ancoraId) : undefined;
  const c = serie.classificacao;

  // Os dois pares de escopo. Pela linha o padrão é "esta e as seguintes";
  // pelo cabeçalho, "da atual em diante" — o passado exige escolher.
  const opcoesEscopo: { valor: EscopoSerie; rotulo: string; qtd: number }[] = ancora
    ? [
        { valor: 'soEsta', rotulo: 'Só esta', qtd: 1 },
        {
          valor: 'estaEseguintes',
          rotulo: 'Esta e as seguintes',
          qtd: serie.itens.filter((i) => i.data >= ancora.data).length,
        },
      ]
    : [
        { valor: 'daAtual', rotulo: 'Da atual em diante', qtd: serie.futuras },
        { valor: 'todas', rotulo: 'Todas', qtd: serie.lancamentos },
      ];

  const [escopo, setEscopo] = useState<EscopoSerie>(ancora ? 'estaEseguintes' : 'daAtual');
  const [modoValor, setModoValor] = useState<'parcela' | 'total'>('parcela');

  // Estado inicial = o que a série já é. Assim abrir a tela não propõe
  // mudança nenhuma, e o botão nasce apagado.
  const [f, setF] = useState({
    descricao: serie.descricao,
    grupo: c.categoria,
    tipo: c.tipo,
    fonte: c.fonte ?? '',
    divisao: c.divisao,
    quemPagou: c.quemPagou ?? '',
    valor: String(numero(serie.valorUnitario)),
    valorTotal: '',
    dataFim: serie.regra?.dataFim ?? '',
    ativo: serie.regra?.ativo ?? true,
  });

  const [preview, setPreview] = useState<Preview | null>(null);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState('');

  const paraNumero = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

  /** Só o que DIFERE do estado atual entra — o que não se toca, não muda. */
  const mudancas = useMemo<MudancasSerie>(() => {
    const m: MudancasSerie = {};
    if (f.descricao !== serie.descricao) m.descricao = f.descricao;
    if (f.grupo !== c.categoria) m.grupo = f.grupo;
    if (f.tipo !== c.tipo) m.tipo = f.tipo;
    if (f.fonte !== (c.fonte ?? '')) m.fonte = f.fonte || null;
    if (f.divisao !== c.divisao) m.divisao = f.divisao;
    if (f.quemPagou !== (c.quemPagou ?? '')) m.quemPagou = f.quemPagou;
    if (modoValor === 'total') {
      if (f.valorTotal.trim()) m.valorTotal = paraNumero(f.valorTotal);
    } else if (Math.abs(paraNumero(f.valor) - serie.valorUnitario) >= 0.005) {
      m.valor = paraNumero(f.valor);
    }
    if (serie.regra) {
      if ((f.dataFim || null) !== (serie.regra.dataFim ?? null)) m.dataFim = f.dataFim || null;
      if (f.ativo !== serie.regra.ativo) m.ativo = f.ativo;
    }
    return m;
  }, [f, modoValor, serie, c]);

  const temMudanca = Object.keys(mudancas).length > 0;

  // A prévia vem do SERVIDOR a cada mudança: é ele que sabe recalcular
  // `pct_irwin`, `pago_irwin` e o efeito no acerto. Refazer essa conta aqui
  // seria a segunda implementação da regra — exatamente o que a regra nº 3
  // proíbe.
  useEffect(() => {
    if (!temMudanca) return;
    let cancelado = false;
    const t = setTimeout(() => {
      rpc('previewEdicaoSerie', serie.id, escopo, ancoraId, mudancas)
        .then((p) => {
          if (!cancelado) {
            setPreview(p as Preview);
            setErro('');
          }
        })
        .catch((e: Error) => {
          if (!cancelado) setErro(e.message);
        });
    }, 250);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [mudancas, temMudanca, escopo, ancoraId, serie.id]);

  // A prévia só vale enquanto há mudança. Derivar isso na renderização, em vez
  // de limpar o estado dentro do efeito, evita um render com a prévia velha ao
  // lado de "Nada alterado" — e é o que o lint pede.
  const previewAtual = temMudanca ? preview : null;
  const escopoAtual = opcoesEscopo.find((o) => o.valor === escopo);
  const qtd = previewAtual?.qtd ?? escopoAtual?.qtd ?? 0;

  // Contado AQUI, e não lido da prévia, porque a prévia só existe depois que
  // algo muda — e o aviso de que o escopo alcança meses já fechados tem que
  // aparecer no instante em que o escopo é escolhido, não depois. Um aviso de
  // segurança que chega tarde não é aviso.
  const jaLancadas = useMemo(() => {
    const dentro = (i: Serie['itens'][number]) => {
      if (escopo === 'todas') return true;
      if (escopo === 'daAtual') return i.futura;
      if (escopo === 'soEsta') return i.id === ancoraId;
      return !!ancora && i.data >= ancora.data;
    };
    return itens.filter((i) => dentro(i) && !i.futura).length;
  }, [escopo, itens, ancora, ancoraId]);

  async function gravar() {
    setGravando(true);
    setErro('');
    try {
      await rpc('atualizarSerie', serie.id, escopo, ancoraId, mudancas);
      router.push(`/serie/${serie.id}`);
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
      setGravando(false);
    }
  }

  const unidade = ehParcelamento ? 'parcelas' : 'ocorrências';

  return (
    <>
      <header className="cabecalho">
        <div className="titulo">
          <Link href={`/serie/${serie.id}`} className="voltar" aria-label="Fechar">
            ✕
          </Link>
          <h1>Editar série</h1>
        </div>
        {eu && <Avatar quem={eu} tamanho={28} />}
      </header>

      <div className="conteudo">
        <div className="pad">
          {/* Cabeçalho curto. Vindo de uma linha: nome e data, valor e posição.
              Pelo cabeçalho: nome, e a mesma 2ª linha da leitura. */}
          <div className="card suave de-onde">
            <div className="qual">
              {ancora
                ? `${serie.descricao} · ${Number(ancora.data.slice(8, 10))} de ${MES_EXT[Number(ancora.data.slice(5, 7)) - 1]}`
                : serie.descricao}
            </div>
            <div className="val">
              <b>{brl(ancora ? ancora.valor : serie.valorUnitario)}</b>
              <span className="ponto">·</span>
              {ancora
                ? ehParcelamento
                  ? `parcela ${ancora.seq}/${serie.total}`
                  : `${ancora.posicao}ª ocorrência`
                : `${serie.lancamentos} ${unidade}`}
              {!ancora && (
                <>
                  <span className="ponto">·</span>
                  {brl(serie.totalValor)}
                </>
              )}
            </div>
          </div>

          {/* 1 — quantas linhas */}
          <div className="card">
            <div className="campo">
              <label>Aplicar a</label>
              <div className="seg">
                {opcoesEscopo.map((o) => (
                  <button
                    key={o.valor}
                    type="button"
                    className={escopo === o.valor ? 'on' : ''}
                    onClick={() => setEscopo(o.valor)}
                  >
                    {o.rotulo}
                    <b>{o.qtd}</b>
                  </button>
                ))}
              </div>
            </div>

            {jaLancadas > 0 ? (
              <div className="aviso">
                <span>⚠</span>
                <div>
                  Inclui <b>{jaLancadas} já lançada{jaLancadas > 1 ? 's' : ''}</b>. O acerto
                  desses meses vai mudar.
                </div>
              </div>
            ) : (
              !ancora &&
              escopo === 'daAtual' &&
              serie.lancamentos - serie.futuras > 0 && (
                <div className="nota-regra">
                  As <b>{serie.lancamentos - serie.futuras} já lançadas</b> não são tocadas.
                </div>
              )
            )}

            {previewAtual?.mudaRegra && (
              <div className="nota-regra">
                Como o escopo alcança o futuro, a <b>regra</b> muda junto — senão a próxima
                gerada voltaria ao valor antigo.
              </div>
            )}
          </div>

          {/* 2 — o que muda */}
          <div className="card">
            <div className="campo">
              <label>Descrição</label>
              <input
                type="text"
                value={f.descricao}
                onChange={(e) => setF({ ...f, descricao: e.target.value })}
              />
            </div>

            <div className="campo">
              {ehParcelamento ? (
                <div className="rot-alt">
                  <label>Valor</label>
                  <span className="alt">
                    <button
                      type="button"
                      className={modoValor === 'parcela' ? 'on' : ''}
                      onClick={() => setModoValor('parcela')}
                    >
                      da parcela
                    </button>
                    <button
                      type="button"
                      className={modoValor === 'total' ? 'on' : ''}
                      onClick={() => setModoValor('total')}
                    >
                      total
                    </button>
                  </span>
                </div>
              ) : (
                <label>Valor</label>
              )}
              {modoValor === 'total' ? (
                <>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={mudancas.valorTotal !== undefined ? 'mudado' : ''}
                    placeholder={numero(serie.valorUnitario * qtd)}
                    value={f.valorTotal}
                    onChange={(e) => setF({ ...f, valorTotal: e.target.value })}
                  />
                  <div className="dica">
                    Dividido por {qtd} · a última absorve o arredondamento
                  </div>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={mudancas.valor !== undefined ? 'mudado' : ''}
                    value={f.valor}
                    onChange={(e) => setF({ ...f, valor: e.target.value })}
                  />
                  {qtd > 0 && (
                    <div className="dica">
                      Total de {qtd}: {brl(paraNumero(f.valor) * qtd)}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="grade">
              <div className="campo">
                <label>Categoria</label>
                <select value={f.grupo} onChange={(e) => setF({ ...f, grupo: e.target.value })}>
                  {opcoes.gruposLancar.map((g) => (
                    <option key={g.nome} value={g.nome}>
                      {g.nome.replace(/^\d+\s/, '')}
                    </option>
                  ))}
                </select>
              </div>
              <div className="campo">
                <label>Tipo</label>
                <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
                  {['Fixa', 'Variável', 'Investimento'].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="campo">
                <label>Origem</label>
                <select value={f.fonte} onChange={(e) => setF({ ...f, fonte: e.target.value })}>
                  {[...new Set([f.fonte, ...opcoes.origens].filter(Boolean))].map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              <div className="campo">
                <label>Como dividir</label>
                <select value={f.divisao} onChange={(e) => setF({ ...f, divisao: e.target.value })}>
                  {opcoes.divisoes.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="campo" style={{ marginTop: 9 }}>
              <label>Quem paga</label>
              <select
                value={f.quemPagou}
                onChange={(e) => setF({ ...f, quemPagou: e.target.value })}
              >
                {opcoes.pagadores.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            {serie.regra && (
              <div className="grade" style={{ marginTop: 9 }}>
                <div className="campo">
                  <label>Repete até</label>
                  <input
                    type="date"
                    className={mudancas.dataFim !== undefined ? 'mudado' : ''}
                    value={f.dataFim}
                    onChange={(e) => setF({ ...f, dataFim: e.target.value })}
                  />
                  <div className="dica">{f.dataFim ? '' : 'Vazio = indefinidamente'}</div>
                </div>
                <div className="campo">
                  <label>Situação</label>
                  <select
                    className={mudancas.ativo !== undefined ? 'mudado' : ''}
                    value={f.ativo ? 'ativa' : 'pausada'}
                    onChange={(e) => setF({ ...f, ativo: e.target.value === 'ativa' })}
                  >
                    <option value="ativa">Ativa</option>
                    <option value="pausada">Pausada</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* 3 — o que vai acontecer */}
          {erro && <div className="msg-erro">{erro}</div>}

          {previewAtual && previewAtual.qtd > 0 && (
            <div className="prev">
              <h4>
                Antes e depois · {previewAtual.qtd} {unidade}
                {previewAtual.mudaRegra ? ' + a regra' : ''}
              </h4>
              <div className="rolo">
                {previewAtual.linhas.map((l) => (
                  <div className="ln" key={l.id}>
                    <span>{dataBR(l.antes.data).slice(0, 5)}</span>
                    <div className="par">
                      <span className="de">{ladoDoDiff(l.antes, l.depois, 'antes')}</span>
                      <b>{ladoDoDiff(l.antes, l.depois, 'depois')}</b>
                    </div>
                  </div>
                ))}
              </div>
              <div className="fim">
                <span>Efeito no seu acerto</span>
                <span
                  className={`num ${deltaMeu(previewAtual.deltaAcerto, eu) > 0.005 ? 'pos' : deltaMeu(previewAtual.deltaAcerto, eu) < -0.005 ? 'neg' : ''}`}
                >
                  {Math.abs(previewAtual.deltaAcerto) < 0.005
                    ? 'sem impacto'
                    : comSinal(deltaMeu(previewAtual.deltaAcerto, eu))}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="barra-acao">
        <button
          className={`btn-full ${temMudanca ? 'valido' : ''}`}
          disabled={!temMudanca || gravando}
          onClick={gravar}
        >
          {gravando
            ? 'Gravando…'
            : !temMudanca
              ? 'Nada alterado'
              : `Aplicar a ${qtd} ${qtd === 1 ? unidade.slice(0, -1) : unidade}`}
        </button>
      </div>
    </>
  );
}

/** O delta é sempre do lado do Irwin; a Maria vê o espelho (C1). */
function deltaMeu(delta: number, eu: Pessoa | null): number {
  return eu === 'Maria' ? -delta : delta;
}

/**
 * O que mostrar de cada lado do antes/depois.
 *
 * Mostra os campos que MUDARAM naquela linha, não um resumo fixo: com um
 * resumo fixo, mudar a categoria exibia "R$ 44,90 → R$ 44,90" nas três linhas,
 * que não informa nada. Quando nada muda naquela linha — acontece quando o
 * escopo alcança linhas que já estavam com o valor novo — diz isso.
 */
function ladoDoDiff(
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
  lado: 'antes' | 'depois',
): string {
  const campos: [string, (v: unknown) => string][] = [
    ['valor', (v) => brl(Number(v))],
    ['categoria', (v) => String(v).replace(/^\d+\s/, '')],
    ['tipo', (v) => String(v)],
    ['fonte', (v) => String(v ?? '—')],
    ['divisao', (v) => String(v)],
    ['quemPagou', (v) => String(v ?? '—')],
    ['descricao', (v) => String(v)],
  ];

  const mudaram = campos.filter(([k, fmt]) => fmt(antes[k]) !== fmt(depois[k]));
  if (!mudaram.length) return lado === 'antes' ? '' : 'sem mudança';

  const fonte = lado === 'antes' ? antes : depois;
  return mudaram.map(([k, fmt]) => fmt(fonte[k])).join(' · ');
}
