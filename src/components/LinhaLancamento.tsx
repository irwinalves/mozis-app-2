/**
 * Uma linha da lista de lançamentos.
 *
 * Mesmo desenho do `Form.html`: coluna de data estreita, **a foto de quem
 * pagou logo ao lado da data** — o padrão do resto do app —, descrição que
 * trunca, valor à direita e, abaixo dele, o efeito no acerto (C1).
 *
 * A foto do dono fica à ESQUERDA do valor, decisão de 22/08/2026, para a tag
 * não desalinhar a descrição de todas as outras linhas.
 */
import Link from 'next/link';
import { Avatar, AvatarDono } from './Avatar';
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
  /** Já aconteceu. Diferente de `fora`: é estado do mundo, não da edição. */
  passada = false,
  /** A linha de onde o usuário veio — ganha trilho e rótulo. */
  ancora = false,
  /** Sobrepõe a etiqueta. Numa recorrência é `36ª`, não `36/36`. */
  rotuloPosicao,
  meta,
  href,
  onClick,
}: {
  item: ItemLancamento;
  eu: Pessoa | null;
  fora?: boolean;
  passada?: boolean;
  ancora?: boolean;
  rotuloPosicao?: string;
  /** Substitui a linha de metadados padrão (tipo · fonte). */
  meta?: string;
  href?: string;
  onClick?: () => void;
}) {
  const { dia, mes } = diaMes(item.data);
  const etiqueta =
    rotuloPosicao ?? (item.seq ? rotuloParcela(item.seq, item.total ?? null) : '');

  const miolo = (
    <>
      <div className="col-data">
        <div className="dia">{dia}</div>
        <div className="mes">{mes}</div>
      </div>

      {/* A foto de quem pagou ao lado da data — o padrão do resto do app. */}
      <Avatar quem={item.quemPagou as never} tamanho={22} className="quem-pagou" />

      <div className="item-info">
        <div className="desc">
          {etiqueta && <span className="parc">{etiqueta}</span>}
          {item.descricao}
        </div>
        {ancora && <div className="ancora-rot">você veio daqui</div>}
        <div className="meta">{meta ?? [item.tipo, item.fonte].filter(Boolean).join(' · ')}</div>
      </div>

      {item.gastoDe && <AvatarDono nome={item.gastoDe} tamanho={22} className="tag-andre" />}

      <div className="item-valor">
        <div className="v">{brl(item.valor)}</div>
        <div className="partes">
          <EfeitoNoAcerto saldoIrwin={item.saldoIrwin} eu={eu} />
        </div>
      </div>
    </>
  );

  const classe =
    `item-lanc${fora ? ' fora' : ''}${passada ? ' passada' : ''}${ancora ? ' ancora' : ''}`;

  if (href) {
    return (
      <Link href={href} className={classe}>
        {miolo}
      </Link>
    );
  }

  return (
    <div
      className={classe}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {miolo}
    </div>
  );
}
