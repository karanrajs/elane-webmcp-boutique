import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import {
  WEBMCP_BAG_PAGE_LIMIT,
  WEBMCP_CATALOG_PAGE_LIMIT,
  WEBMCP_OUTPUT_CHARACTER_LIMIT,
  WEBMCP_SAFE_OUTPUT_TARGET,
  WEBMCP_SEARCH_PAGE_LIMIT,
  WEBMCP_STATE_LIST_PAGE_LIMIT,
  enforceWebMcpOutputBudget,
  pageForWebMcp,
  webMcpOutputCharacters,
} from '../app/webmcp-contract.ts';
import {
  normalizeProductSearchTerms,
  productSearchScore,
  products,
  rankProductsBySearch,
  slotForProduct,
} from '../app/catalog.ts';
import { atelierPromotion, promotionApplicationState } from '../app/promotions.ts';
import {
  assessReturnEligibility,
  checkReturnWindowFromWebMcp,
  policySection,
  readPolicyFromWebMcp,
  returnDeadlineFor,
} from '../app/policies.ts';

const expectedTools = [
  'read_catalog',
  'read_style_state',
  'search_catalog',
  'stage_look',
  'stage_capsule',
  'replan_capsule',
  'set_look_size',
  'add_look_item',
  'remove_look_item',
  'replace_look_item',
  'read_bag',
  'read_promotions',
  'read_policy',
  'check_return_window',
  'apply_promotion',
  'add_item_to_bag',
  'adjust_bag_quantity',
  'set_bag_item_size',
  'remove_bag_items',
  'clear_bag',
  'add_look_to_bag',
];

const expectedPolicyPageTools = [
  'read_policy',
  'check_return_window',
];

const readOnlyTools = new Set([
  'read_catalog',
  'read_style_state',
  'search_catalog',
  'read_bag',
  'read_promotions',
  'read_policy',
  'check_return_window',
]);

const untrustedContentTools = new Set([
  'read_style_state',
  'search_catalog',
  'stage_capsule',
  'replan_capsule',
  'add_look_to_bag',
]);

const [adapter, policyAdapter, page, readme] = await Promise.all([
  readFile(new URL('../app/components/atelier-webmcp.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/components/policy-webmcp.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../README.md', import.meta.url), 'utf8'),
]);

const compilerOptions = {
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
};
const compiledPolicyAdapter = ts.transpileModule(policyAdapter, {
  compilerOptions,
}).outputText;
const policyPageRegistrations = [];
const policyCjsModule = { exports: {} };
const immediateReact = {
  useEffect(effect) { effect(); },
  useRef(current) { return { current }; },
};
const policyRequire = (specifier) => {
  if (specifier === 'react') return immediateReact;
  if (specifier === '../policies') {
    return { checkReturnWindowFromWebMcp, readPolicyFromWebMcp };
  }
  if (specifier === '../webmcp-contract') return { enforceWebMcpOutputBudget };
  throw new Error(`Unexpected policy verifier import: ${specifier}`);
};
const evaluatePolicy = new Function(
  'require', 'module', 'exports', 'document', 'AbortController', 'console',
  compiledPolicyAdapter,
);
evaluatePolicy(
  policyRequire,
  policyCjsModule,
  policyCjsModule.exports,
  { modelContext: { registerTool(tool, options) { policyPageRegistrations.push({ tool, options }); } } },
  AbortController,
  { error() {} },
);
policyCjsModule.exports.PolicyWebMCP();

const compiledAdapter = ts.transpileModule(adapter, {
  compilerOptions: {
    ...compilerOptions,
  },
}).outputText;
const storefrontRegistrations = [];
const cjsModule = { exports: {} };
const localRequire = (specifier) => {
  if (specifier === 'react') return immediateReact;
  if (specifier === './policy-webmcp') return policyCjsModule.exports;
  if (specifier === '../webmcp-contract') {
    return {
      WEBMCP_BAG_PAGE_LIMIT,
      WEBMCP_CATALOG_PAGE_LIMIT,
      WEBMCP_SEARCH_PAGE_LIMIT,
      WEBMCP_STATE_LIST_PAGE_LIMIT,
      enforceWebMcpOutputBudget,
    };
  }
  throw new Error(`Unexpected verifier import: ${specifier}`);
};
const evaluate = new Function(
  'require', 'module', 'exports', 'document', 'AbortController', 'console',
  compiledAdapter,
);
evaluate(
  localRequire,
  cjsModule,
  cjsModule.exports,
  { modelContext: { registerTool(tool, options) { storefrontRegistrations.push({ tool, options }); } } },
  AbortController,
  { error() {} },
);

const handler = async () => ({ status: 'verified' });
cjsModule.exports.AtelierWebMCP({
  read: handler,
  readState: handler,
  search: handler,
  stage: handler,
  stageJourney: handler,
  replanCapsule: handler,
  setAtelierSize: handler,
  readBag: handler,
  readPromotions: handler,
  readPolicy: handler,
  checkReturnWindow: handler,
  applyPromotion: handler,
  addCatalogItemToBag: handler,
  adjustBagItemQuantity: handler,
  setBagItemSize: handler,
  removeBagItems: handler,
  clearBag: handler,
  addStagedLook: handler,
  addStagedItem: handler,
  removeStagedItem: handler,
  replaceStagedItem: handler,
});

const registeredTools = storefrontRegistrations.map(({ tool }) => tool.name);
assert.deepEqual(registeredTools, expectedTools, 'The registered WebMCP tool inventory changed unexpectedly.');
assert.equal(new Set(registeredTools).size, registeredTools.length, 'WebMCP tool names must be unique.');
const registeredPolicyPageTools = policyPageRegistrations.map(({ tool }) => tool.name);
assert.deepEqual(
  registeredPolicyPageTools,
  expectedPolicyPageTools,
  'The Delivery & Returns WebMCP tool inventory changed unexpectedly.',
);
assert.equal(
  new Set(registeredPolicyPageTools).size,
  registeredPolicyPageTools.length,
  'Delivery & Returns WebMCP tool names must be unique.',
);

function verifySchemaDescriptions(schema, toolName, path = 'input') {
  if (!schema || typeof schema !== 'object') return;
  if (typeof schema.description === 'string') {
    assert.ok(
      schema.description.length <= 150,
      `${toolName} ${path} description is ${schema.description.length} characters; maximum is 150.`,
    );
  }
  if (schema.properties) {
    for (const [name, property] of Object.entries(schema.properties)) {
      assert.ok(name.length <= 30, `${toolName} parameter ${name} exceeds 30 characters.`);
      verifySchemaDescriptions(property, toolName, `${path}.${name}`);
    }
  }
  verifySchemaDescriptions(schema.items, toolName, `${path}[]`);
  for (const keyword of ['anyOf', 'allOf', 'oneOf']) {
    schema[keyword]?.forEach((entry, index) => {
      verifySchemaDescriptions(entry, toolName, `${path}.${keyword}[${index}]`);
    });
  }
}

function verifyRegistrations(registrations) {
  for (const { tool, options } of registrations) {
    assert.match(
      tool.name,
      /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u,
      `${tool.name} must use lowercase snake_case with an action verb first.`,
    );
    assert.ok(tool.name.length <= 24, `${tool.name} exceeds the project 24-character name maximum.`);
    assert.equal(
      tool.title,
      undefined,
      `${tool.name} must let the user agent display the concise tool identifier as its title.`,
    );
    assert.ok(tool.description.length <= 500, `${tool.name} description exceeds 500 characters.`);
    assert.equal(
      tool.annotations?.readOnlyHint,
      readOnlyTools.has(tool.name),
      `${tool.name} has an incorrect readOnlyHint.`,
    );
    assert.equal(
      tool.annotations?.untrustedContentHint,
      untrustedContentTools.has(tool.name),
      `${tool.name} has an incorrect untrustedContentHint.`,
    );
    assert.equal(
      tool.inputSchema?.additionalProperties,
      false,
      `${tool.name} must reject unknown top-level input fields.`,
    );
    assert.ok(options?.signal instanceof AbortSignal, `${tool.name} must share an AbortSignal.`);
    assert.equal(typeof tool.execute, 'function', `${tool.name} must provide an execute function.`);
    verifySchemaDescriptions(tool.inputSchema, tool.name);
  }
}

verifyRegistrations(storefrontRegistrations);
verifyRegistrations(policyPageRegistrations);

assert.match(adapter, /new AbortController\(\)/u, 'WebMCP registration must use an AbortController.');
assert.match(adapter, /return \(\) => lifecycle\.abort\(\)/u, 'WebMCP registrations must be cleaned up on unmount.');
assert.match(adapter, /enforceWebMcpOutputBudget\(tool\.name/u, 'Every tool output must enforce the shared character limit.');
assert.match(policyAdapter, /new AbortController\(\)/u, 'Policy WebMCP registration must use an AbortController.');
assert.match(policyAdapter, /return \(\) => lifecycle\.abort\(\)/u, 'Policy WebMCP registrations must be cleaned up on unmount.');
assert.match(policyAdapter, /enforceWebMcpOutputBudget\(tool\.name/u, 'Every policy tool output must enforce the shared character limit.');
const policyReadResult = await policyPageRegistrations.find(({ tool }) => tool.name === 'read_policy')
  .tool.execute({ section: 'delivery' });
assert.equal(policyReadResult.section, 'delivery', 'The Delivery & Returns policy tool must execute against the shared policy authority.');
const returnCheckResult = await policyPageRegistrations.find(({ tool }) => tool.name === 'check_return_window')
  .tool.execute({ deliveryDate: '2026-09-01', asOfDate: '2026-09-15' });
assert.equal(returnCheckResult.date.returnDeadline, '2026-10-01', 'The Delivery & Returns return checker must calculate the shared deadline.');
assert.doesNotMatch(page, /bagSnapshot/u, 'Bag responses must not return unbounded full snapshots.');
assert.match(page, /pageForWebMcp\(readyProducts/u, 'Catalog reads must be paginated.');
assert.match(
  page,
  /view = input\.view \?\? \(hasPagination \? 'products' : 'overview'\)/u,
  'Catalog reads must default to the compact overview while preserving paginated callers.',
);
assert.match(
  page,
  /input\.view === 'overview' && hasPagination/u,
  'Catalog overview reads must reject irrelevant pagination fields.',
);
assert.match(
  page,
  /useState<AudienceFilter>\('All'\)/u,
  'The storefront collection must load with all audiences instead of defaulting to women or men.',
);
assert.match(
  page,
  /useState<ModelId \| null>\(null\)/u,
  'The Style Studio must load without a women or men collection selected.',
);
assert.match(
  page,
  /useState<StyleSelections>\(\{\}\)/u,
  'The Style Studio must load without preselected garments.',
);
assert.match(
  page,
  /useState<'idle' \| 'ready' \| 'error'>\('idle'\)/u,
  'The initial garment-board preview must be idle.',
);
assert.match(page, /pageForWebMcp\(matches/u, 'Catalog search must be paginated.');
assert.match(page, /pageForWebMcp\(cart\.map\(bagLine\)/u, 'Bag reads must be paginated.');

const catalogRows = products.map((product) => ({
  id: product.id,
  name: product.name,
  audience: product.audience,
  slot: slotForProduct(product),
  category: product.category,
  color: product.color,
  priceCad: product.price,
}));
const catalogRules = {
  dress: 'Do not combine a dress with a top or bottom.',
  audience: 'All pieces must match the selected collection.',
  budget: 'Capsule budgets count each distinct piece once.',
  accessories: 'Up to four per look.',
};
const budgetFixtures = [];
const catalogOverview = {
  status: 'ready',
  view: 'overview',
  currency: 'CAD',
  scope: { model: 'all' },
  totalCount: catalogRows.length,
  facets: {
    audiences: ['Women', 'Men'].map((audience) => ({
      audience,
      count: products.filter((product) => product.audience === audience).length,
    })),
    slots: ['Top', 'Bottom', 'Dress', 'Layer', 'Accessory'].map((slot) => ({
      slot,
      count: products.filter((product) => slotForProduct(product) === slot).length,
    })),
    priceCad: {
      minimum: Math.min(...products.map((product) => product.price)),
      maximum: Math.max(...products.map((product) => product.price)),
    },
  },
  rules: catalogRules,
  routing: {
    ordinaryDiscovery: 'Use search_catalog with model, slot, and maximum price filters.',
    exhaustiveDiscovery: 'Use read_catalog with view products and follow page.nextOffset until null.',
  },
};
budgetFixtures.push(['catalog overview', catalogOverview]);
const recoveredCatalogIds = [];
for (let offset = 0; offset < catalogRows.length; offset += WEBMCP_CATALOG_PAGE_LIMIT) {
  const catalogPage = pageForWebMcp(catalogRows, offset, WEBMCP_CATALOG_PAGE_LIMIT);
  recoveredCatalogIds.push(...catalogPage.items.map(({ id }) => id));
  budgetFixtures.push(['catalog products page', {
    status: 'ready',
    view: 'products',
    currency: 'CAD',
    page: catalogPage,
  }]);
}
assert.deepEqual(recoveredCatalogIds, catalogRows.map(({ id }) => id), 'Catalog pagination must recover every product in order.');
assert.equal(new Set(recoveredCatalogIds).size, catalogRows.length, 'Catalog pagination must not duplicate products.');
assert.ok(
  Math.ceil(catalogRows.length / WEBMCP_CATALOG_PAGE_LIMIT) < Math.ceil(catalogRows.length / WEBMCP_SEARCH_PAGE_LIMIT),
  'Dense exhaustive pages must require fewer calls than ranked search pages.',
);

const longSearchQuery = ('stone knit and trousers '.repeat(4)).slice(0, 80);
const searchMatches = rankProductsBySearch(
  products.filter((product) => product.audience === 'Women'),
  longSearchQuery,
);
budgetFixtures.push(['long search page', {
  status: 'ready',
  query: longSearchQuery,
  normalizedTerms: normalizeProductSearchTerms(longSearchQuery),
  filters: { model: 'woman', slot: null, maxPriceCad: null },
  page: pageForWebMcp(searchMatches.map((product) => ({
    ...catalogRows.find((row) => row.id === product.id),
    relevanceScore: productSearchScore(product, longSearchQuery) ?? 0,
  })), 0, WEBMCP_SEARCH_PAGE_LIMIT),
  nextStep: 'Continue with page.nextOffset or use returned IDs in a staging tool.',
}]);

const maxTextList = (prefix) => Array.from(
  { length: 12 },
  (_, index) => (prefix + String(index).padStart(2, '0') + 'x'.repeat(29)).slice(0, 32),
);
budgetFixtures.push(['maximum constraints state', {
  status: 'ready',
  view: 'constraints',
  model: 'woman',
  size: 'XL',
  presentationMode: 'capsule',
  constraints: {
    budgetCad: 10000,
    size: 'XL',
    climate: 'c'.repeat(80),
    dressCode: 'd'.repeat(80),
    preferredColors: maxTextList('p'),
    excludedColors: maxTextList('x'),
  },
}]);

const longestBagLines = products.map((product) => ({
  productId: product.id,
  name: product.name,
  color: product.color,
  size: 'XL',
  quantity: 999,
  unitPriceCad: product.price,
  lineTotalCad: product.price * 999,
})).toSorted((left, right) => JSON.stringify(right).length - JSON.stringify(left).length);
budgetFixtures.push(['maximum bag page', {
  status: 'ready',
  bag: { currency: 'CAD', distinctItemCount: 88, itemCount: 87912, subtotalCad: 99999999 },
  page: pageForWebMcp(longestBagLines, 0, WEBMCP_BAG_PAGE_LIMIT),
  nextStep: 'Continue with page.nextOffset, configure a line, or stop before another shopping action.',
}]);

budgetFixtures.push(['maximum replan receipt', {
  status: 'replanned',
  model: 'woman',
  title: 't'.repeat(64),
  revisionNote: 'r'.repeat(180),
  changes: {
    preservedCount: 28,
    removedProductIds: Array.from({ length: 28 }, (_, index) => index + 1),
    addedProductIds: Array.from({ length: 28 }, (_, index) => index + 61),
    lockedCount: 28,
    ownedCount: 28,
    excludedCount: 28,
  },
  metrics: {
    outfitCount: 4,
    uniquePieceCount: 28,
    reusedPieceCount: 28,
    ownedPieceCount: 28,
    ownedPiecesReused: 28,
    newPieceCount: 28,
    totalSpendCad: 10000,
    costPerOccasionCad: 2500,
  },
  budgetDifferenceCad: 9900,
  spendDifferenceCad: 10000,
  reuseDifference: 28,
  bagChange: 'none',
  previewVisible: true,
  nextStep: 'Review the visible revision; read a state view for details before adding a chosen look.',
  message: 'The unlocked capsule pieces were replanned and the before/after revision is visible. Locked pieces and the shopping bag were preserved.',
}]);

budgetFixtures.push(['complete returns policy', policySection('returns')]);
budgetFixtures.push(['complete terms policy', policySection('terms')]);
budgetFixtures.push(['return eligibility assessment', assessReturnEligibility({
  deliveryDate: '2026-09-01',
  asOfDate: '2026-10-01',
  itemCondition: 'unused_unworn',
  tagsAttached: true,
  proofOfPurchase: true,
  itemType: 'standard',
})]);

for (const [label, fixture] of budgetFixtures) {
  const characters = webMcpOutputCharacters(fixture);
  assert.ok(
    characters <= WEBMCP_SAFE_OUTPUT_TARGET,
    `${label} uses ${characters} characters; safety target is ${WEBMCP_SAFE_OUTPUT_TARGET}.`,
  );
}
assert.throws(
  () => enforceWebMcpOutputBudget('oversized_fixture', 'x'.repeat(WEBMCP_OUTPUT_CHARACTER_LIMIT + 1)),
  /output exceeded/u,
  'The shared output limit must reject oversized responses.',
);

const documentedTools = Array.from(
  readme.matchAll(/\| `([a-z][a-z0-9]*(?:_[a-z0-9]+)*)` \|/gu),
  (match) => match[1],
);
assert.deepEqual(
  documentedTools.toSorted(),
  expectedTools.toSorted(),
  'README tool inventory must match the registered tools.',
);
assert.equal(new Set(documentedTools).size, documentedTools.length, 'README tool inventory must not contain duplicates.');
assert.doesNotMatch(readme, /github\.com\/your-account/u, 'README must not contain a placeholder repository URL.');

assert.equal(
  promotionApplicationState(0, atelierPromotion.code),
  'available',
  'An empty bag must return to the traditional reveal-offer state.',
);
assert.equal(
  promotionApplicationState(atelierPromotion.minimumSubtotalCad - 1, atelierPromotion.code),
  'available',
  'An ineligible bag must return to the traditional reveal-offer state.',
);
assert.equal(
  promotionApplicationState(atelierPromotion.minimumSubtotalCad, atelierPromotion.code),
  'applied',
  'An eligible saved promotion must be reported as applied.',
);
assert.equal(
  promotionApplicationState(atelierPromotion.minimumSubtotalCad, undefined),
  'available',
  'An eligible bag without a saved promotion must keep the offer available.',
);
assert.equal(
  returnDeadlineFor('2026-09-01'),
  '2026-10-01',
  'The return deadline must be 30 calendar days after delivery.',
);
assert.equal(
  assessReturnEligibility({ deliveryDate: '2026-09-01', asOfDate: '2026-10-01' }).date.dateStatus,
  'within-window',
  'The exact return deadline must remain inside the return window.',
);
assert.equal(
  assessReturnEligibility({ deliveryDate: '2026-09-01', asOfDate: '2026-10-02' }).outcome,
  'ineligible',
  'A return after the deadline must be reported as ineligible.',
);
assert.equal(
  assessReturnEligibility({ deliveryDate: '2026-09-01', asOfDate: '2026-09-15' }).outcome,
  'needs-more-information',
  'A date-only check must not imply full return approval.',
);
assert.doesNotMatch(
  page,
  /savedSession\.appliedPromotionCode/u,
  'Applied promotions must not be restored automatically from a previous page load.',
);
assert.match(
  page,
  /setAppliedPromotionCode\(undefined\)/u,
  'Dropping below the promotion threshold must clear the current application.',
);
assert.match(
  page,
  /Click to reveal offer/u,
  'The traditional reveal-offer call to action must be present.',
);

console.log(`Verified ${registeredTools.length} storefront and ${registeredPolicyPageTools.length} Delivery & Returns WebMCP contracts, plus ${budgetFixtures.length} output-budget boundary fixtures.`);
