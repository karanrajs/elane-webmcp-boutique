import type { Metadata } from 'next';
import { TermsPage } from '../components/legal-page';

export const metadata: Metadata = {
  title: 'Terms & Conditions — ÉLANE',
  description: 'Terms governing the ÉLANE storefront, orders, promotions, product information, and site use.',
  alternates: { canonical: '/terms' },
};

export default TermsPage;
