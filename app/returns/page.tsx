import type { Metadata } from 'next';
import { ReturnsPage } from '../components/legal-page';

export const metadata: Metadata = {
  title: 'Delivery, Returns & Refunds — ÉLANE',
  description: 'ÉLANE return windows, item conditions, return shipping, exchanges, and refund timing.',
  alternates: { canonical: '/returns' },
};

export default ReturnsPage;
