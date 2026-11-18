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

/**
 * De quem é o gasto — outra pergunta que "quem pagou", e por isso outro
 * componente.
 *
 * Só o André tem foto. Os outros donos (`Mãe do Irwin`, `Avô da Maria`)
 * recebiam a foto DELE com o nome do outro no `title`, e o olho acredita na
 * foto: gasto do avô da Maria aparecia na lista como gasto do filho. Quem não
 * tem foto vira iniciais, no mesmo lugar e com o mesmo anel.
 */
export function AvatarDono({
  nome,
  tamanho = 22,
  className = '',
}: {
  nome: string;
  tamanho?: number;
  className?: string;
}) {
  const base: CSSProperties = {
    width: tamanho,
    height: tamanho,
    flex: `0 0 ${tamanho}px`,
    borderRadius: 999,
    objectFit: 'cover',
  };
  const titulo = `Gasto de ${nome}`;
  if (ARQUIVO[nome]) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={`avatar ${className}`}
        style={base}
        src={ARQUIVO[nome]}
        alt={nome}
        title={titulo}
      />
    );
  }
  return (
    <span
      className={`avatar tag-inicial ${className}`}
      style={{ ...base, fontSize: Math.round(tamanho * 0.41) }}
      title={titulo}
      aria-label={titulo}
    >
      {iniciaisDe(nome)}
    </span>
  );
}

/**
 * 'Avô da Maria' vira 'AM' e 'Mãe do Irwin' vira 'MI'.
 *
 * As preposições saem: sem isso os dois comecariam por uma letra que não
 * distingue ninguém. A mesma regra existe em `public/Form.html`, porque lá é
 * JavaScript puro — é a MESMA regra, e mudar aqui é mudar lá.
 */
export function iniciaisDe(nome: string): string {
  const palavras = String(nome)
    .trim()
    .split(/\s+/)
    .filter((w) => !/^(d[aeo]s?|e)$/i.test(w));
  const letras = palavras
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join('');
  return (letras || String(nome).charAt(0) || '?').toUpperCase();
}
