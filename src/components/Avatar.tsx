/**
 * A foto de quem pagou — C2 do `docs/INVARIANTES.md`.
 *
 * Duas coisas que esta regra obriga e que são fáceis de perder numa reescrita:
 *
 * 1. **Foto, não texto.** Reconhecer uma cara é mais rápido que ler um nome, e
 *    o caso "os dois" precisa de representação PRÓPRIA — no app antigo ele caía
 *    num círculo cinza vazio, idêntico ao de um lançamento SEM pagador, que é
 *    coisa completamente diferente.
 *
 * 2. **Por URL, nunca embutida.** O `Form.html` embute ~6 KB de base64 em cada
 *    linha da lista; com 50 linhas são ~300 KB de duplicação. Aqui o arquivo é
 *    baixado uma vez e o navegador cacheia.
 */
import type { CSSProperties } from 'react';

export type Quem = 'Irwin' | 'Maria' | 'Ambos' | 'Conjunta' | 'André' | null | undefined;

const ARQUIVO: Record<string, string> = {
  Irwin: '/avatar-irwin.jpg',
  Maria: '/avatar-maria.jpg',
  André: '/avatar-andre.jpg',
  // 'Conjunta' é o rótulo legado de antes de 'Ambos' (A15): a leitura continua
  // tolerando, senão uma linha antiga aparece sem pagador — que significa
  // outra coisa.
  Ambos: '/avatar-ambos-192.png',
  Conjunta: '/avatar-ambos-192.png',
};

export function Avatar({
  quem,
  tamanho = 26,
  className = '',
  style,
}: {
  quem: Quem;
  tamanho?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const src = quem ? ARQUIVO[quem] : undefined;
  const base: CSSProperties = {
    width: tamanho,
    height: tamanho,
    flex: `0 0 ${tamanho}px`,
    borderRadius: 999,
    objectFit: 'cover',
    ...style,
  };

  // Sem pagador é um estado real e diferente de 'Ambos' — precisa de desenho
  // próprio, não do mesmo círculo.
  if (!src) {
    return (
      <span
        className={`avatar-vazio ${className}`}
        style={base}
        title="Sem pagador definido"
        aria-label="Sem pagador definido"
      />
    );
  }

  // `<img>` e não `next/image`: são três arquivos estáticos de ~5 KB, exibidos
  // sempre no mesmo tamanho. O otimizador não tem o que melhorar, e passaria a
  // exigir uma rota de imagem a mais atrás do middleware.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`avatar ${className}`} style={base} src={src} alt={quem ?? ''} />
  );
}
