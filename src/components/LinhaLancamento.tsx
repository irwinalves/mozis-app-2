/**
 * Uma linha da lista de lançamentos.
 *
 * Mesmo desenho do `Form.html`: coluna de data estreita, descrição que trunca,
 * valor à direita e, abaixo dele, o efeito no acerto (C1). A foto do André
 * fica à ESQUERDA do valor — decisão de 22/08/2026, para a tag não desalinhar
 * a descrição de todas as outras linhas.
 */
import { Avatar } from './Avatar';
import { EfeitoNoAcerto } from './EfeitoNoAcerto';
import { brl, diaMes, rotuloParcela } from '@/lib/formato';
import type { Pessoa } from '@/lib/pessoas';

export interface ItemLancamento {
  id: number;
  data: string;
  descricao: string;
  categoria: string;
  tipo: string;
  fonte: string | null;
  valor: number;
  quemPagou: string | null;
  saldoIrwin: number | null;
  gastoDe: string | null;
  seq?: number | null;
  total?: number | null;
}

export function LinhaLancamento({
  item,
  eu,
  /** Apagada por estar fora do escopo de uma edição em lote. */
  fora = false,
  /** A linha de onde o usuário veio — ganha trilho e rótulo. */
  ancora = false,
  meta,
  onClick,
}: {
  item: ItemLancamento;
  eu: Pessoa | null;
  fora?: boolean;
  ancora?: boolean;
  /** Substitui a linha de metadados padrão (tipo · fonte). */
  meta?: string;
  onClick?: () => void;
}) {
  const { dia, mes } = diaMes(item.data);
  const parcela = item.seq ? rotuloParcela(item.seq, item.total ?? null) : '';

  return (
    <div
      className={`item-lanc${fora ? ' fora' : ''}${ancora ? ' ancora' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="col-data">
        <div className="dia">{dia}</div>
        <div className="mes">{mes}</div>
      </div>

      <div className="item-info">
        <div className="desc">
          {parcela && <span className="parc">{parcela}</span>}
          {item.descricao}
        </div>
        {ancora && <div className="ancora-rot">você veio daqui</div>}
        <div className="meta">{meta ?? [item.tipo, item.fonte].filter(Boolean).join(' · ')}</div>
      </div>

      {/* A tag do André à esquerda do valor: fora do fluxo da descrição, para
          não empurrar o texto das linhas que a têm. */}
      {item.gastoDe && <Avatar quem="André" tamanho={22} className="tag-andre" />}

      <div className="item-valor">
        <div className="v">{brl(item.valor)}</div>
        <div className="partes">
          <Avatar quem={item.quemPagou as never} tamanho={14} className="mini" />
          <EfeitoNoAcerto saldoIrwin={item.saldoIrwin} eu={eu} />
        </div>
      </div>
    </div>
  );
}
