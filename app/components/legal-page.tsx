import Link from 'next/link';
import { PolicyWebMCP } from './policy-webmcp';
import {
  deliveryPolicy,
  generalTerms,
  orderTerms,
  policyMeta,
  promotionTerms,
  refundPolicy,
  returnPolicy,
} from '../policies';

function LegalHeader() {
  return (
    <>
      <div className="announcement">Complimentary shipping and returns on all orders.</div>
      <header className="site-header legal-header">
        <Link className="wordmark" href="/" aria-label="ÉLANE home">ÉLANE</Link>
        <nav aria-label="Legal navigation">
          <Link href="/returns">Returns</Link>
          <Link href="/terms">Terms &amp; conditions</Link>
        </nav>
        <Link className="legal-shop-link" href="/#collection">Continue shopping</Link>
      </header>
    </>
  );
}

function LegalFooter() {
  return (
    <footer>
      <div><Link className="wordmark" href="/">ÉLANE</Link><p>Modern wardrobe. Timeless expression.</p><small>© 2026 ÉLANE. All rights reserved.</small></div>
      <div><strong>Shop</strong><Link href="/#collection">New arrivals</Link><Link href="/#atelier">Style Studio</Link></div>
      <div><strong>Client care</strong><Link href="/returns">Delivery &amp; returns</Link><Link href="/terms">Terms &amp; conditions</Link></div>
      <div><strong>About</strong><p>A considered wardrobe for modern life.</p></div>
    </footer>
  );
}

function DefinitionList({ values }: { values: Record<string, string> }) {
  return (
    <dl className="legal-definition-list">
      {Object.entries(values).map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

export function ReturnsPage() {
  return (
    <main className="legal-route">
      <PolicyWebMCP />
      <LegalHeader />
      <article className="legal-document">
        <header className="legal-title">
          <p>Client care · Effective {policyMeta.effectiveDate}</p>
          <h1>Delivery, returns<br />&amp; refunds.</h1>
          <span>A clear guide to return dates, item conditions, shipping, exchanges, and refund timing.</span>
        </header>

        <section className="legal-highlight" aria-label="Return window summary">
          <strong>{returnPolicy.windowDays}</strong>
          <div><h2>calendar days after delivery</h2><p>Start an eligible return by the calculated deadline. The delivery date is day zero.</p></div>
        </section>

        <section id="return-conditions" className="legal-section">
          <p className="section-index">01 · Return conditions</p>
          <h2>What can be returned.</h2>
          <DefinitionList values={{
            'Return window': returnPolicy.deadlineRule,
            'Item condition': returnPolicy.eligibleCondition,
            'Proof of purchase': returnPolicy.proofOfPurchase,
            'Packaging': returnPolicy.originalPackaging,
            'How to start': returnPolicy.returnMethod,
          }} />
        </section>

        <section id="exceptions" className="legal-section">
          <p className="section-index">02 · Exceptions</p>
          <h2>Items we cannot accept.</h2>
          <ul className="legal-list">{returnPolicy.excludedItemTypes.map((item) => <li key={item}>{item}</li>)}</ul>
          <p className="legal-note"><strong>Damaged, defective, or incorrect?</strong> {returnPolicy.defectiveItems}</p>
        </section>

        <section id="shipping" className="legal-section">
          <p className="section-index">03 · Return shipping &amp; exchanges</p>
          <h2>Sending it back.</h2>
          <DefinitionList values={{
            'Returns from Canada': returnPolicy.canadaReturnShipping,
            'Returns from outside Canada': returnPolicy.internationalReturnShipping,
            'Exchanges': returnPolicy.exchanges,
          }} />
        </section>

        <section id="refunds" className="legal-section">
          <p className="section-index">04 · Refunds</p>
          <h2>After your return arrives.</h2>
          <DefinitionList values={{
            'Refund method': refundPolicy.method,
            'Processing time': refundPolicy.processing,
            'Non-refundable charges': refundPolicy.deductions,
          }} />
        </section>

        <section id="delivery" className="legal-section">
          <p className="section-index">05 · Delivery</p>
          <h2>Before and after arrival.</h2>
          <DefinitionList values={{
            'Estimates and availability': deliveryPolicy.availability,
            'Confirmed delivery': deliveryPolicy.risk,
            'Delivery address': deliveryPolicy.address,
          }} />
        </section>

        <p className="legal-statutory-note">These policies do not limit rights available under applicable consumer-protection law.</p>
      </article>
      <LegalFooter />
    </main>
  );
}

export function TermsPage() {
  return (
    <main className="legal-route">
      <LegalHeader />
      <article className="legal-document">
        <header className="legal-title">
          <p>Legal · Last updated {policyMeta.lastUpdated}</p>
          <h1>Terms &amp;<br />conditions.</h1>
          <span>These terms govern use of the ÉLANE storefront and any purchase accepted by ÉLANE.</span>
        </header>

        <section className="legal-section">
          <p className="section-index">01 · Orders</p>
          <h2>Pricing, availability &amp; acceptance.</h2>
          <DefinitionList values={{
            'Prices and errors': orderTerms.pricing,
            'Order acceptance': orderTerms.acceptance,
            'Availability': orderTerms.availability,
            'Current checkout': orderTerms.checkoutNotice,
          }} />
        </section>

        <section className="legal-section">
          <p className="section-index">02 · Promotions</p>
          <h2>Offer conditions.</h2>
          <DefinitionList values={{
            'Applying an offer': promotionTerms.application,
            'Offer limits': promotionTerms.limits,
            'Returns after a promotion': promotionTerms.returns,
          }} />
        </section>

        {generalTerms.map((section, index) => (
          <section id={section.id} className="legal-section" key={section.id}>
            <p className="section-index">{String(index + 3).padStart(2, '0')} · {section.title}</p>
            <h2>{section.title}.</h2>
            <p>{section.body}</p>
          </section>
        ))}

        <section className="legal-note legal-governing-law">
          <strong>Governing law</strong>
          <p>These terms are governed by the laws of {policyMeta.governingLaw}, without limiting mandatory consumer rights that apply where you live.</p>
        </section>

        <p className="legal-statutory-note">Read our <Link href="/returns">Delivery, returns &amp; refunds policy</Link> for the complete return window and item conditions.</p>
      </article>
      <LegalFooter />
    </main>
  );
}
