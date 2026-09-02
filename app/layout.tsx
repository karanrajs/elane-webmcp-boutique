import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://elane-clothing-boutique.karanrajs.chatgpt.site'),
  title: 'ÉLANE — Modern wardrobe, timeless expression',
  description: 'Premium clothing with an agent-operable Style Studio and bring-your-own-agent outfit previews.',
  alternates: { canonical: '/' },
  icons: { icon: '/favicon.svg' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'ÉLANE — Dress for the life in motion.',
    description: 'Premium clothing with an agent-operable Style Studio and bring-your-own-agent outfit previews.',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: 'ÉLANE — Dress for the life in motion.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ÉLANE — Dress for the life in motion.',
    description: 'Premium clothing with an agent-operable Style Studio and bring-your-own-agent outfit previews.',
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
