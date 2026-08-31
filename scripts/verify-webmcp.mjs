import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import {
  WEBMCP_BAG_PAGE_LIMIT,
  WEBMCP_CATALOG_PAGE_LIMIT,
  WEBMCP_OUTPUT_CHARACTER_LIMIT,
  WEBMCP_SAFE_OUTPUT_TARGET,
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

const expectedTools = [
  'elane_read_atelier_catalog',
  'elane_read_atelier_state',
  'elane_search_atelier_catalog',
  'elane_stage_atelier_look',
  'elane_stage_capsule_journey',
  'elane_replan_capsule',
  'elane_set_atelier_size',
  'elane_add_staged_item',
  'elane_remove_staged_item',
  'elane_replace_staged_item',
  'elane_read_shopping_bag',
  'elane_read_promotions',
  'elane_apply_promotion',
  'elane_add_catalog_item_to_bag',
  'elane_adjust_bag_item_quantity',
  'elane_set_bag_item_size',
  'elane_remove_bag_items',
  'elane_clear_shopping_bag',
  'elane_add_staged_look_to_bag',
];

const readOnlyTools = new Set([
  'elane_read_atelier_catalog',
  'elane_read_atelier_state',
  'elane_search_atelier_catalog',
  'elane_read_shopping_bag',
  'elane_read_promotions',
]);

const untrustedContentTools = new Set([
  'elane_read_atelier_state',
  'elane_search_atelier_catalog',
  'elane_stage_capsule_journey',
  'elane_replan_capsule',
  'elane_add_staged_look_to_bag',
]);

const [adapter, page, readme] = await Promise.all([
  readFile(new URL('../app/components/atelier-webmcp.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../README.md', import.meta.url), 'utf8'),
]);

const compiledAdapter = ts.transpileModule(adapter, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const registrations = [];
const cjsModule = { exports: {} };
const immediateReact = {
  useEffect(effect) { effect(); },
  useRef(current) { return { current }; },
};
const localRequire = (specifier) => {
  if (specifier === 'react') return immediateReact;
  if (specifier === '../webmcp-contract') {
    return {
      WEBMCP_BAG_PAGE_LIMIT,
      WEBMCP_CATALOG_PAGE_LIMIT,
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
  { modelContext: { registerTool(tool, options) { registrations.push({ tool, options }); } } },
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

const registeredTools = registrations.map(({ tool }) => tool.name);
assert.deepEqual(registeredTools, expectedTools, 'The registered WebMCP tool inventory changed unexpectedly.');
assert.equal(new Set(registeredTools).size, registeredTools.length, 'WebMCP tool names must be unique.');

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

for (const { tool, options } of registrations) {
  assert.ok(tool.name.length <= 30, `${tool.name} exceeds the 30-character name maximum.`);
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

assert.match(adapter, /new AbortController\(\)/u, 'WebMCP registration must use an AbortController.');
assert.match(adapter, /return \(\) => lifecycle\.abort\(\)/u, 'WebMCP registrations must be cleaned up on unmount.');
assert.match(adapter, /enforceWebMcpOutputBudget\(tool\.name/u, 'Every tool output must enforce the shared character limit.');
assert.doesNotMatch(page, /bagSnapshot/u, 'Bag responses must not return unbounded full snapshots.');
assert.match(page, /pageForWebMcp\(readyProducts/u, 'Catalog reads must be paginated.');
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
for (let offset = 0; offset < catalogRows.length; offset += WEBMCP_CATALOG_PAGE_LIMIT) {
  budgetFixtures.push(['catalog page', {
    status: 'ready',
    currency: 'CAD',
    rules: catalogRules,
    page: pageForWebMcp(catalogRows, offset, WEBMCP_CATALOG_PAGE_LIMIT),
    nextStep: 'Continue with page.nextOffset, or read atelier state before staging.',
  }]);
}

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
  })), 0, WEBMCP_CATALOG_PAGE_LIMIT),
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

const documentedTools = Array.from(readme.matchAll(/\| `(elane_[a-z_]+)` \|/gu), (match) => match[1]);
assert.deepEqual(
  documentedTools.toSorted(),
  expectedTools.toSorted(),
  'README tool inventory must match the registered tools.',
);
assert.equal(new Set(documentedTools).size, documentedTools.length, 'README tool inventory must not contain duplicates.');
assert.doesNotMatch(readme, /github\.com\/your-account/u, 'README must not contain a placeholder repository URL.');

console.log(`Verified ${registeredTools.length} secure WebMCP contracts and ${budgetFixtures.length} output-budget boundary fixtures.`);
