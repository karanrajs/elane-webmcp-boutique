export const policyMeta = {
  effectiveDate: '2026-09-01',
  lastUpdated: '2026-09-01',
  currency: 'CAD',
  commerceTimeZone: 'America/Toronto',
  governingLaw: 'Ontario, Canada',
} as const;

export const returnPolicy = {
  windowDays: 30,
  windowStarts: 'Delivery date',
  deadlineRule: 'Start the return within 30 calendar days after the delivery date.',
  eligibleCondition: 'Items must be unused, unworn, unwashed, unaltered, and returned with original tags attached.',
  proofOfPurchase: 'A receipt, order confirmation, or other proof of purchase is required.',
  originalPackaging: 'Keep original packaging for protective or hygiene items.',
  excludedItemTypes: [
    'Gift cards',
    'Personalized or altered items',
    'Items marked final sale',
    'Intimate goods with a removed or broken hygiene seal',
  ],
  defectiveItems: 'Report a damaged, defective, or incorrect item within 7 calendar days of delivery for priority review. Statutory rights are not limited.',
  returnMethod: 'Start the return with ÉLANE customer care before sending the item. Unapproved parcels may be delayed or returned to sender.',
  canadaReturnShipping: 'Eligible Canadian returns receive a complimentary prepaid return label.',
  internationalReturnShipping: 'For returns sent from outside Canada, the customer pays return shipping, duties, and taxes unless the item was defective or incorrect.',
  exchanges: 'Exchanges are subject to stock availability. If the requested replacement is unavailable, a refund will be issued instead.',
} as const;

export const refundPolicy = {
  method: 'Approved refunds are issued to the original payment method.',
  processing: 'Allow 5 to 10 business days after inspection for ÉLANE to process an approved refund; the payment provider may need additional time.',
  deductions: 'Original delivery charges, duties, and taxes are non-refundable unless the item was defective, incorrect, or applicable law requires otherwise.',
} as const;

export const deliveryPolicy = {
  availability: 'Delivery estimates and inventory are shown for guidance and may change before an order is accepted.',
  risk: 'Responsibility for the parcel transfers on confirmed delivery, except where applicable consumer law provides otherwise.',
  address: 'Customers are responsible for providing a complete delivery address and promptly reporting delivery problems.',
} as const;

export const orderTerms = {
  pricing: 'Prices are shown in CAD before applicable taxes. ÉLANE may correct obvious pricing or product-description errors before accepting an order.',
  acceptance: 'A submitted order is an offer to purchase. An order is accepted only when ÉLANE sends an acceptance or dispatch confirmation.',
  availability: 'All products are subject to availability. ÉLANE may cancel or limit quantities and will refund amounts collected for cancelled items.',
  checkoutNotice: 'This current storefront checkout is a preview: submitting it does not place an order, collect payment, or create a shipment.',
} as const;

export const promotionTerms = {
  application: 'Promotion codes must be entered and applied before checkout is completed.',
  limits: 'Unless an offer states otherwise, promotions cannot be combined, have no cash value, and may be changed or withdrawn before an order is accepted.',
  returns: 'If a return makes the remaining order ineligible for an applied promotion, the refund may be adjusted to reflect the promotion terms and the amount actually paid.',
} as const;

export const generalTerms = [
  {
    id: 'site-use',
    title: 'Using this site',
    body: 'Use the storefront only for lawful personal shopping. Do not interfere with the site, misuse automated access, attempt to bypass security, or copy content beyond uses permitted by law.',
  },
  {
    id: 'product-information',
    title: 'Product information',
    body: 'We aim to describe products accurately, but colours and proportions may vary by display. Style Studio garment boards are editorial planning aids and are not fit simulations or guarantees of appearance.',
  },
  {
    id: 'intellectual-property',
    title: 'Intellectual property',
    body: 'ÉLANE names, imagery, text, designs, and software are protected by applicable intellectual-property laws and may not be reused commercially without permission.',
  },
  {
    id: 'liability',
    title: 'Liability',
    body: 'Nothing in these terms excludes rights or remedies that cannot legally be excluded. To the extent permitted by law, ÉLANE is not responsible for indirect loss or loss caused by misuse, third parties, or events outside reasonable control.',
  },
  {
    id: 'changes',
    title: 'Changes and severability',
    body: 'The terms in effect when an order is accepted apply to that order. If one provision is unenforceable, the remaining provisions continue to apply.',
  },
] as const;

export type PolicySection = 'all' | 'returns' | 'refunds' | 'delivery' | 'orders' | 'promotions' | 'terms';
export type ReturnItemCondition = 'unused_unworn' | 'opened_or_worn' | 'defective_or_incorrect';
export type ReturnItemType = 'standard' | 'gift_card' | 'personalized_or_altered' | 'final_sale' | 'intimate_seal_broken';

const DAY_MS = 86_400_000;
const policySections = new Set<PolicySection>(['all', 'returns', 'refunds', 'delivery', 'orders', 'promotions', 'terms']);
const returnItemConditions = new Set<ReturnItemCondition>(['unused_unworn', 'opened_or_worn', 'defective_or_incorrect']);
const returnItemTypes = new Set<ReturnItemType>(['standard', 'gift_card', 'personalized_or_altered', 'final_sale', 'intimate_seal_broken']);
const excludedReturnItemTypes = new Set<ReturnItemType>([
  'gift_card',
  'personalized_or_altered',
  'final_sale',
  'intimate_seal_broken',
]);

function isoDateToUtc(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error(`Invalid date ${date}. Use YYYY-MM-DD.`);
  const [year, month, day] = date.split('-').map(Number);
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date ${date}.`);
  }
  return time;
}

function utcToIsoDate(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

export function currentPolicyDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: policyMeta.commerceTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function returnDeadlineFor(deliveryDate: string) {
  return utcToIsoDate(isoDateToUtc(deliveryDate) + returnPolicy.windowDays * DAY_MS);
}

export function policySection(section: PolicySection) {
  const base = { status: 'ready', section, effectiveDate: policyMeta.effectiveDate, lastUpdated: policyMeta.lastUpdated };
  if (section === 'returns') return {
    ...base,
    returns: {
      window: { days: returnPolicy.windowDays, rule: returnPolicy.deadlineRule },
      condition: returnPolicy.eligibleCondition,
      proof: returnPolicy.proofOfPurchase,
      packaging: returnPolicy.originalPackaging,
      exclusions: returnPolicy.excludedItemTypes,
      defective: returnPolicy.defectiveItems,
      start: returnPolicy.returnMethod,
      shipping: {
        canada: returnPolicy.canadaReturnShipping,
        international: returnPolicy.internationalReturnShipping,
      },
      exchanges: returnPolicy.exchanges,
    },
  };
  if (section === 'refunds') return { ...base, refunds: refundPolicy };
  if (section === 'delivery') return { ...base, delivery: deliveryPolicy };
  if (section === 'orders') return { ...base, orders: orderTerms };
  if (section === 'promotions') return { ...base, promotions: promotionTerms };
  if (section === 'terms') return {
    ...base,
    governingLaw: policyMeta.governingLaw,
    terms: generalTerms.map(({ title, body }) => ({ title, body })),
  };
  return {
    ...base,
    currency: policyMeta.currency,
    governingLaw: policyMeta.governingLaw,
    summary: {
      returns: `${returnPolicy.windowDays} calendar days after delivery; unused, unworn, unwashed, unaltered, with original tags and proof of purchase.`,
      refunds: 'Original payment method; normally processed 5 to 10 business days after inspection.',
      delivery: 'Estimates and inventory may change before order acceptance.',
      orders: orderTerms.checkoutNotice,
      promotions: 'Apply before checkout; offers are normally non-stackable and have no cash value.',
    },
    nextStep: 'Read a specific section for full conditions, or check_return_window with a delivery date.',
  };
}

export function assessReturnEligibility(input: {
  deliveryDate: string;
  asOfDate?: string;
  itemCondition?: ReturnItemCondition;
  tagsAttached?: boolean;
  proofOfPurchase?: boolean;
  itemType?: ReturnItemType;
}) {
  const asOfDate = input.asOfDate ?? currentPolicyDate();
  const delivered = isoDateToUtc(input.deliveryDate);
  const assessed = isoDateToUtc(asOfDate);
  const deadline = delivered + returnPolicy.windowDays * DAY_MS;
  const daysRemaining = Math.floor((deadline - assessed) / DAY_MS);
  const dateStatus = assessed < delivered
    ? 'not-yet-delivered'
    : assessed <= deadline ? 'within-window' : 'expired';
  const checks = [
    { condition: 'return-window', status: dateStatus === 'within-window' ? 'pass' : 'fail' },
  ];

  if (input.itemType) {
    checks.push({ condition: 'item-type', status: excludedReturnItemTypes.has(input.itemType) ? 'fail' : 'pass' });
  }
  if (input.itemCondition) {
    checks.push({
      condition: 'item-condition',
      status: input.itemCondition === 'opened_or_worn' ? 'fail' : 'pass',
    });
  }
  if (typeof input.tagsAttached === 'boolean') {
    checks.push({ condition: 'original-tags', status: input.tagsAttached ? 'pass' : 'fail' });
  }
  if (typeof input.proofOfPurchase === 'boolean') {
    checks.push({ condition: 'proof-of-purchase', status: input.proofOfPurchase ? 'pass' : 'fail' });
  }

  const suppliedConditionFacts = Boolean(
    input.itemType
    && input.itemCondition
    && typeof input.tagsAttached === 'boolean'
    && typeof input.proofOfPurchase === 'boolean'
  );
  const hasFailure = checks.some((check) => check.status === 'fail');
  const outcome = dateStatus === 'not-yet-delivered'
    ? 'not-yet-delivered'
    : hasFailure ? 'ineligible'
      : suppliedConditionFacts ? 'eligible' : 'needs-more-information';

  return {
    status: 'assessed',
    outcome,
    date: {
      deliveryDate: input.deliveryDate,
      asOfDate,
      returnDeadline: utcToIsoDate(deadline),
      windowDays: returnPolicy.windowDays,
      dateStatus,
      daysRemaining: Math.max(0, daysRemaining),
      daysPastDeadline: Math.max(0, -daysRemaining),
    },
    checks,
    missingFacts: suppliedConditionFacts ? [] : [
      ...(!input.itemType ? ['itemType'] : []),
      ...(!input.itemCondition ? ['itemCondition'] : []),
      ...(typeof input.tagsAttached !== 'boolean' ? ['tagsAttached'] : []),
      ...(typeof input.proofOfPurchase !== 'boolean' ? ['proofOfPurchase'] : []),
    ],
    policyNotice: 'This is a policy check, not return authorization. Defective or incorrect items and statutory rights may require customer-care review.',
  };
}

export function readPolicyFromWebMcp(rawInput: unknown) {
  if (rawInput !== undefined && (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput))) {
    throw new Error('Expected an optional policy section object.');
  }
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const unknownKey = Object.keys(input).find((key) => key !== 'section');
  if (unknownKey) throw new Error(`Unknown policy read field: ${unknownKey}.`);
  const section = input.section ?? 'all';
  if (typeof section !== 'string' || !policySections.has(section as PolicySection)) {
    throw new Error('section must be all, returns, refunds, delivery, orders, promotions, or terms.');
  }
  return policySection(section as PolicySection);
}

export function checkReturnWindowFromWebMcp(rawInput: unknown) {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('Expected an object containing a deliveryDate.');
  }
  const input = rawInput as Record<string, unknown>;
  const allowedKeys = new Set(['deliveryDate', 'asOfDate', 'itemCondition', 'tagsAttached', 'proofOfPurchase', 'itemType']);
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Unknown return check field: ${unknownKey}.`);
  if (typeof input.deliveryDate !== 'string') throw new Error('deliveryDate is required in YYYY-MM-DD format.');
  if (input.asOfDate !== undefined && typeof input.asOfDate !== 'string') throw new Error('asOfDate must use YYYY-MM-DD format.');
  if (input.itemCondition !== undefined && (
    typeof input.itemCondition !== 'string'
    || !returnItemConditions.has(input.itemCondition as ReturnItemCondition)
  )) throw new Error('itemCondition is not a supported return condition.');
  if (input.itemType !== undefined && (
    typeof input.itemType !== 'string'
    || !returnItemTypes.has(input.itemType as ReturnItemType)
  )) throw new Error('itemType is not a supported return category.');
  if (input.tagsAttached !== undefined && typeof input.tagsAttached !== 'boolean') throw new Error('tagsAttached must be true or false.');
  if (input.proofOfPurchase !== undefined && typeof input.proofOfPurchase !== 'boolean') throw new Error('proofOfPurchase must be true or false.');

  return assessReturnEligibility({
    deliveryDate: input.deliveryDate,
    asOfDate: input.asOfDate as string | undefined,
    itemCondition: input.itemCondition as ReturnItemCondition | undefined,
    tagsAttached: input.tagsAttached as boolean | undefined,
    proofOfPurchase: input.proofOfPurchase as boolean | undefined,
    itemType: input.itemType as ReturnItemType | undefined,
  });
}
