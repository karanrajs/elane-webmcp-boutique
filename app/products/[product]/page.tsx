import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { productById } from '../../catalog';
import { Boutique } from '../../page';

type ProductPageProps = {
  params: Promise<{ product: string }>;
};

function productIdFromRoute(value: string) {
  const [id] = value.split('-');
  const parsed = Number(id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { product: productRoute } = await params;
  const productId = productIdFromRoute(productRoute);
  const product = productId ? productById.get(productId) : undefined;
  if (!product) return {};

  const title = `${product.name}, ${product.color} — ÉLANE`;
  const description = `Explore ${product.name} in ${product.color}, select a size, and add it to your ÉLANE bag.`;

  return {
    title,
    description,
    alternates: { canonical: `/products/${productRoute}` },
    openGraph: { title, description, images: [] },
    twitter: { card: 'summary', title, description, images: [] },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { product: productRoute } = await params;
  const productId = productIdFromRoute(productRoute);
  if (!productId || !productById.has(productId)) notFound();
  return <Boutique initialProductId={productId} />;
}
