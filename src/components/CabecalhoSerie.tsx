/**
 * O cabeçalho de uma série — a mesma forma em parcelamento e recorrência.
 *
 * Está num componente só, e não copiado nas duas telas, porque a simetria é o
 * requisito: se as duas divergirem, quem aprendeu numa não sabe a outra. Um
 * componente compartilhado torna divergir difícil.
 *
 *     1ª  nome, com `Editar ›` no canto
 *     2ª  valor unitário (16px negrito) · quantas · valor total
 *     3ª  período · cadência
 *     4ª  classificação
 *
 * À direita, sob o `Editar`, a foto de **quem paga a série hoje**.
 *
 * Ela precisou existir por um engano meu: eu tinha tirado quem paga daqui
 * dizendo que já estava no topo da tela — mas o avatar do topo é de **quem
 * entrou**, não de quem paga. Eram informações diferentes com a mesma cara, e
 * a tela de série ficou sem dizer de quem é o gasto.
 *
 * Foto e não texto, pela C2: reconhecer uma cara é mais rápido que ler um
 * nome, e aqui ela ainda economiza a linha que o nome gastaria.
 */
import Link from 'next/link';
import { brl, mesAno, dataBR } from '@/lib/formato';
import { Avatar } from './Avatar';
import { EfeitoNoAcerto } from './EfeitoNoAcerto';
import type { Pessoa } from '@/lib/pessoas';

const FREQ: Record<string, string> = {
  mensal: 'mensal',
  quinzenal: 'quinzenal',
  semanal: 'semanal',
};

export interface DadosCabecalho {
  tipo: string;
  descricao: string;
  total: number | null;
  lancamentos: number;
  futuras: number;
  primeira: string | null;
  ultima: string | null;
  valorUnitario: number;
  totalValor: number;
  saldoIrwin: number | null;
  classificacao: {
    categoria: string;
    tipo: string;
    fonte: string | null;
    divisao: string;
    quemPagou: string | null;
  };
  variam: { campo: string; rotulo: string; valores: { valor: string; qtd: number }[] }[];
  regra: {
    frequencia: string;
    ativo: boolean;
    dataFim: string | null;
    proxima: string | null;
  } | null;
}

/** `mensal, dia 28 · indefinidamente` — a cadência e até quando vale. */
function cadencia(s: DadosCabecalho): string {
  const dia = s.ultima ? Number(s.ultima.slice(8, 10)) : null;
  if (s.tipo === 'recorrencia' && s.regra) {
    const f = FREQ[s.regra.frequencia] ?? s.regra.frequencia;
    const quando = s.regra.frequencia === 'mensal' && dia ? `${f}, dia ${dia}` : f;
    return quando;
  }
  return dia ? `mensal, dia ${dia}` : 'mensal';
}

export function CabecalhoSerie({
  serie,
  eu,
  href,
}: {
  serie: DadosCabecalho;
  eu: Pessoa | null;
  /** Para onde o toque leva. Sem isto o cabeçalho é só leitura. */
  href?: string;
}) {
  const ehParcelamento = serie.tipo === 'parcelamento';
  const lancadas = serie.lancamentos - serie.futuras;
  const progresso = serie.total ? Math.min(1, lancadas / serie.total) : 0;
  const c = serie.classificacao;

  const quantas = `${serie.lancamentos} ${ehParcelamento ? 'parcelas' : 'ocorrências'}`;
  const periodo =
    serie.primeira && serie.ultima ? `${mesAno(serie.primeira)} a ${mesAno(serie.ultima)}` : '—';

  // Só os campos de classificação contam para o aviso. `Valor` varia em quase
  // toda série de parcelas por causa do arredondamento da última (A7), e
  // apontar isso como divergência seria ruído — a regra manda ser honesto, não
  // alarmista.
  const variamClassif = serie.variam.filter((v) => v.campo !== 'valor_total');

  const miolo = (
    <>
      <div className="serie-topo">
        <div className="serie-corpo">
          <div className="nome">{serie.descricao}</div>

          <div className="serie-l2">
            <b className="unit">{brl(serie.valorUnitario)}</b>
            <span className="ponto">·</span>
            {quantas}
            <span className="ponto">·</span>
            {brl(serie.totalValor)}
          </div>

          <div className="serie-l3">
            {periodo} <span className="ponto">·</span> {cadencia(serie)}
            {serie.tipo === 'recorrencia' && (
              <>
                {' '}
                <span className="ponto">·</span>{' '}
                <b>
                  {serie.regra?.dataFim
                    ? `até ${dataBR(serie.regra.dataFim)}`
                    : 'indefinidamente'}
                </b>
              </>
            )}
          </div>

          <div className="serie-l4">
            {[c.categoria.replace(/^\d+\s/, ''), c.tipo, c.fonte, c.divisao]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>

        {/* Quem paga hoje. Quando o pagador varia entre as linhas, esta é a
            mais recente — e o aviso de campos que variam já diz que é
            simplificação. */}
        <div className="serie-lado">
          {href && (
            <span className="editar">
              <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
                <path
                  d="M4 20h4L19 9l-4-4L4 16v4zM15 5l4 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Editar
            </span>
          )}
          <Avatar quem={c.quemPagou as never} tamanho={38} className="serie-pagador" />
        </div>
      </div>

      {variamClassif.length > 0 && (
        <div className="serie-varia">
          {variamClassif.length} {variamClassif.length === 1 ? 'campo varia' : 'campos variam'}{' '}
          entre as {ehParcelamento ? 'parcelas' : 'ocorrências'}
        </div>
      )}

      {serie.tipo === 'recorrencia' && serie.regra && (
        <div className="serie-prox">
          {serie.regra.ativo ? (
            <>
              Próxima em <b>{serie.regra.proxima ? dataBR(serie.regra.proxima) : '—'}</b>
            </>
          ) : (
            <>Pausada — nada novo é gerado</>
          )}
        </div>
      )}

      {serie.total ? (
        <>
          <div className="serie-barra">
            <i style={{ width: `${progresso * 100}%` }} />
          </div>
          <div className="serie-linha">
            <span>{lancadas} lançadas</span>
            {serie.futuras > 0 && <span className="fut">{serie.futuras} futuras</span>}
          </div>
        </>
      ) : null}

      {serie.lancamentos > 0 && (
        <div className="serie-linha" style={{ marginTop: serie.total ? 7 : 9 }}>
          <span>Efeito acumulado no acerto</span>
          <EfeitoNoAcerto saldoIrwin={serie.saldoIrwin} eu={eu} />
        </div>
      )}
    </>
  );

  return (
    <div className="card suave">
      {href ? (
        <Link href={href} className="serie-cab">
          {miolo}
        </Link>
      ) : (
        <div className="serie-cab" style={{ cursor: 'default' }}>
          {miolo}
        </div>
      )}
    </div>
  );
}
