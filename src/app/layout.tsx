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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={roboto.className}>
      <body>{children}</body>
    </html>
  );
}
