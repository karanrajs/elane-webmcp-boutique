import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://elane-clothing-boutique.karanrajs.chatgpt.site'),
  title: 'ÉLANE — Modern wardrobe, timeless expression',
  description: 'Premium clothing for women and men, with an interactive, agent-operable Style Studio.',
  alternates: { canonical: '/' },
  icons: { icon: '/favicon.svg' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'ÉLANE — Dress for the life in motion.',
    description: 'Premium clothing for women and men, with an interactive, agent-operable Style Studio.',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: 'ÉLANE — Dress for the life in motion.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ÉLANE — Dress for the life in motion.',
    description: 'Premium clothing for women and men, with an interactive, agent-operable Style Studio.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
