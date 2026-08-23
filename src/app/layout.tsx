import type { Metadata, Viewport } from 'next';
import { Roboto } from 'next/font/google';
import './globals.css';

/**
 * Roboto, e não a fonte que veio no `create-next-app`: é a do `Form.html`, e
 * enquanto as duas telas convivem qualquer diferença de fonte entre elas é
 * visível na troca.
 */
const roboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Mozi's App",
  description: 'Gestão financeira do casal',
};

/**
 * `maximumScale: 1` e `userScalable: false` existem por um motivo medido: o
 * Safari do iPhone dá zoom automático ao focar um campo, e o zoom NÃO volta
 * sozinho — a tela fica deslocada até fechar e reabrir o app.
 *
 * A trava do zoom é a segunda metade da solução; a primeira é nenhum campo ter
 * fonte menor que 16px (ver `globals.css`). As duas juntas.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

/**
 * O tema escolhido vive no `localStorage`, e quem o grava é o botão do
 * `Form.html`. Sem ler isso aqui, a tela React cai no
 * `prefers-color-scheme` — e quem escolheu escuro num sistema claro vê a
 * tela nova acender na cara. Foi o primeiro defeito que apareceu no uso real.
 *
 * Roda ANTES da pintura, no `<head>`: aplicar depois da hidratação daria um
 * flash de tema errado a cada navegação.
 *
 * É o MESMO one-liner da linha 4 do `Form.html`, copiado como está. Quando o
 * front antigo sair, este vira o único; até lá, dois lugares com a mesma
 * lógica é o preço de as duas telas conviverem — e copiar verbatim é o que
 * impede que divirjam.
 */
const APLICAR_TEMA =
  "(function(){try{var t=localStorage.getItem('tema');" +
  "if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning`: o script acima escreve `data-theme` no
    // <html> ANTES da hidratação, então o HTML do servidor e o do cliente
    // divergem nesse atributo de propósito. É o único ponto onde divergir é o
    // comportamento certo — sem o script haveria flash de tema errado.
    <html lang="pt-BR" className={roboto.className} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APLICAR_TEMA }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
