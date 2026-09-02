'use client';

/* eslint-disable @next/next/no-img-element, @next/next/no-html-link-for-pages -- Vinext currently duplicates the React renderer when Next client primitives are introduced in this client surface. */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  AtelierWebMCP,
  type AddCatalogItemToBagInput,
  type AddStagedItemInput,
  type AddStagedLookInput,
  type AdjustBagItemQuantityInput,
  type AtelierToolInput,
  type AtelierToolResult,
  type CapsuleJourneyInput,
  type RemoveStagedItemInput,
  type ReplanCapsuleInput,
  type ReplaceStagedItemInput,
  type SetBagItemSizeInput,
} from './components/atelier-webmcp';
import {
  defaultSelectionsByModel,
  normalizeProductSearchTerms,
  productById,
  productSearchScore,
  products,
  rankProductsBySearch,
  slotForProduct,
  styleGroupLabels,
  type ModelId,
  type Product,
  type StyleSelections,
  type StyleSlot,
} from './catalog';
import {
  WEBMCP_BAG_PAGE_LIMIT,
  WEBMCP_CATALOG_PAGE_LIMIT,
  WEBMCP_SEARCH_PAGE_LIMIT,
  WEBMCP_STATE_LIST_PAGE_LIMIT,
  pageForWebMcp,
} from './webmcp-contract';
import { atelierPromotion, promotionApplicationState, promotionSavingsCad } from './promotions';
import {
  checkReturnWindowFromWebMcp,
  readPolicyFromWebMcp,
} from './policies';

type CartItem = Product & { quantity: number; size: string };
type AudienceFilter = 'All' | Product['audience'];
const categoryOrderList = ['Outerwear', 'Knitwear', 'Tailoring', 'Dresses', 'Tops', 'Trousers', 'Skirts', 'Denim', 'Accessories'] as const;
type CategoryName = (typeof categoryOrderList)[number];
type CategoryFilter = 'All' | CategoryName;
const categoryLabels: Record<AudienceFilter, Partial<Record<CategoryName, string>>> = {
  All: {},
  Women: { Tops: 'Tops & blouses' },
  Men: { Tops: 'Shirts & polos' },
};
const audienceFilters = new Set<AudienceFilter>(['All', 'Women', 'Men']);
const categoryFilters = new Set<CategoryFilter>(['All', ...categoryOrderList]);
const atelierSizes = ['XS', 'S', 'M', 'L', 'XL'] as const;
type AtelierSize = (typeof atelierSizes)[number];

const styleSlots: StyleSlot[] = ['Top', 'Bottom', 'Dress', 'Layer', 'Accessory'];
const categoryOrder = new Map<string, number>(categoryOrderList.map((item, index) => [item, index]));

function currency(value: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
}

function productHref(product: Product) {
  const slug = product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `/products/${product.id}-${slug}`;
}

function collectionHref(audience: AudienceFilter = 'All', category: CategoryFilter = 'All') {
  const params = new URLSearchParams();
  if (audience !== 'All') params.set('audience', audience);
  if (category !== 'All') params.set('category', category);
  const query = params.toString();
  return `/${query ? `?${query}` : ''}#collection`;
}

function productDescription(product: Product) {
  const descriptions: Record<string, string> = {
    Outerwear: `A considered outer layer with a clean, architectural line. The ${product.color.toLowerCase()} tone is designed to settle easily over tailoring, knitwear, and everyday separates.`,
    Knitwear: `A refined knit designed for comfortable layering and a polished drape. Its ${product.color.toLowerCase()} tone brings quiet depth to an everyday wardrobe.`,
    Tailoring: `Modern tailoring with an easy, composed silhouette. Designed to sharpen softer layers while remaining comfortable from morning through evening.`,
    Dresses: `An effortless one-piece silhouette with considered proportion and movement. Dress it up with tailoring or keep the line clean and understated.`,
    Tops: `A versatile foundation piece with a clean neckline and an easy fit. Designed to work alone or sit smoothly beneath knitwear and tailoring.`,
    Trousers: `A polished trouser with a fluid line and considered proportion. Made to pair naturally with both relaxed knitwear and structured layers.`,
    Skirts: `A modern skirt with an easy line and graceful movement. Its restrained shape makes room for both soft knitwear and sharper tailoring.`,
    Denim: `A refined approach to denim with a clean silhouette and versatile finish. Designed for repeat wear across casual and polished looks.`,
    Accessories: `A finishing piece selected for proportion, texture, and everyday versatility. The ${product.color.toLowerCase()} colourway is designed to work across the ÉLANE wardrobe.`,
  };
  return descriptions[product.category] ?? 'A considered ÉLANE piece designed for a modern, versatile wardrobe.';
}

function productMaterial(product: Product) {
  const materialNames = ['Cashmere', 'Merino', 'Wool', 'Leather', 'Cotton', 'Linen', 'Denim', 'Suede', 'Alpaca', 'Silk', 'Satin', 'Jersey', 'Corduroy', 'Velvet', 'Poplin', 'Georgette', 'Boucle'];
  return materialNames.find((material) => product.name.toLowerCase().includes(material.toLowerCase()))
    ?? ({
      Outerwear: 'Structured woven fabric',
      Knitwear: 'Fine-gauge knit',
      Tailoring: 'Tailoring-weight fabric',
      Dresses: 'Draped atelier fabric',
      Tops: 'Soft shirting fabric',
      Trousers: 'Tailoring-weight fabric',
      Skirts: 'Fluid woven fabric',
      Denim: 'Cotton denim',
      Accessories: 'Selected leather or textile',
    }[product.category] ?? 'Selected atelier fabric');
}

function productFit(product: Product) {
  if (product.category === 'Accessories') return 'One size';
  if (product.category === 'Outerwear' || product.category === 'Tailoring') return 'Easy layering fit · take your usual size';
  if (product.category === 'Trousers' || product.category === 'Skirts' || product.category === 'Denim') return 'Designed to sit naturally at the waist · take your usual size';
  if (product.category === 'Dresses') return 'Considered, fluid fit · take your usual size';
  return 'True to size with an easy silhouette';
}

function bagSummary(items: CartItem[]) {
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotalCad = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return {
    currency: 'CAD',
    distinctItemCount: items.length,
    itemCount,
    subtotalCad,
  };
}

function bagLine(item: CartItem) {
  return {
    productId: item.id,
    name: item.name,
    color: item.color,
    size: item.size,
    quantity: item.quantity,
    unitPriceCad: item.price,
    lineTotalCad: item.price * item.quantity,
  };
}

function validatePaginationInput(
  input: Record<string, unknown>,
  maximum: number,
): { offset: number; limit: number } {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? maximum;
  if (!Number.isInteger(offset) || (offset as number) < 0) {
    throw new Error('offset must be a non-negative integer.');
  }
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > maximum) {
    throw new Error(`limit must be an integer between 1 and ${maximum}.`);
  }
  return { offset: offset as number, limit: limit as number };
}

function validateAtelierSizeInput(rawInput: unknown): AtelierSize {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('Expected an object containing a size.');
  }
  const input = rawInput as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'size') {
    throw new Error('Only size is supported when setting the Style Studio size.');
  }
  if (!atelierSizes.includes(input.size as AtelierSize)) {
    throw new Error(`size must be one of: ${atelierSizes.join(', ')}.`);
  }
  return input.size as AtelierSize;
}

function validateBagRemovalInput(rawInput: unknown) {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('Expected an object containing productIds.');
  }
  const input = rawInput as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'productIds') {
    throw new Error('Only productIds is supported when removing bag items.');
  }
  if (!Array.isArray(input.productIds) || !input.productIds.length || input.productIds.length > 50) {
    throw new Error('productIds must contain between 1 and 50 catalog product IDs.');
  }
  if (input.productIds.some((id) => !Number.isInteger(id) || (id as number) < 1)) {
    throw new Error('Every productIds entry must be a positive integer.');
  }
  const productIds = input.productIds as number[];
  if (new Set(productIds).size !== productIds.length) {
    throw new Error('productIds cannot contain duplicates.');
  }
  return productIds;
}

function validateAddCatalogItemToBagInput(rawInput: unknown): AddCatalogItemToBagInput {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('Expected an object containing a catalog product ID and optional size.');
  }
  const input = rawInput as Record<string, unknown>;
  const allowedKeys = new Set(['productId', 'size']);
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (unknownKey || !Object.hasOwn(input, 'productId')) {
    throw new Error('Provide productId and, optionally, size.');
  }
  if (!Number.isInteger(input.productId) || (input.productId as number) < 1) {
    throw new Error('productId must be a positive catalog product ID.');
  }
  if (input.size !== undefined && !atelierSizes.includes(input.size as AtelierSize)) {
    throw new Error(`size must be one of: ${atelierSizes.join(', ')}.`);
  }
  return {
    productId: input.productId as number,
    ...(input.size ? { size: input.size as AtelierSize } : {}),
  };
}

function validateBagQuantityAdjustmentInput(rawInput: unknown): AdjustBagItemQuantityInput {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('Expected an object containing a bag product ID and quantity delta.');
  }
  const input = rawInput as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes('productId') || !keys.includes('delta')) {
    throw new Error('Provide only productId and delta.');
  }
  if (!Number.isInteger(input.productId) || (input.productId as number) < 1) {
    throw new Error('productId must be a positive catalog product ID.');
  }
  if (input.delta !== -1 && input.delta !== 1) {
    throw new Error('delta must be 1 to add one unit or -1 to remove one unit.');
  }
  return { productId: input.productId as number, delta: input.delta };
}

function validateSetBagItemSizeInput(rawInput: unknown): SetBagItemSizeInput {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('Expected an object containing a bag product ID and size.');
  }
  const input = rawInput as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes('productId') || !keys.includes('size')) {
    throw new Error('Provide only productId and size.');
  }
  if (!Number.isInteger(input.productId) || (input.productId as number) < 1) {
    throw new Error('productId must be a positive catalog product ID.');
  }
  if (!atelierSizes.includes(input.size as AtelierSize)) {
    throw new Error(`size must be one of: ${atelierSizes.join(', ')}.`);
  }
  return { productId: input.productId as number, size: input.size as AtelierSize };
}

function validateStagedItemMutationInput(
  rawInput: unknown,
  replacementRequired: false,
): RemoveStagedItemInput;
function validateStagedItemMutationInput(
  rawInput: unknown,
  replacementRequired: true,
): ReplaceStagedItemInput;
function validateStagedItemMutationInput(
  rawInput: unknown,
  replacementRequired: boolean,
): RemoveStagedItemInput | ReplaceStagedItemInput {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('Expected an object containing a staged product ID.');
  }
  const input = rawInput as Record<string, unknown>;
  const allowedKeys = replacementRequired
    ? new Set(['productId', 'replacementProductId'])
    : new Set(['productId']);
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (unknownKey || Object.keys(input).length !== allowedKeys.size) {
    throw new Error(replacementRequired
      ? 'Provide only productId and replacementProductId.'
      : 'Provide only productId.');
  }
  if (!Number.isInteger(input.productId) || (input.productId as number) < 1) {
    throw new Error('productId must be a positive catalog product ID.');
  }
  if (!replacementRequired) {
    return { productId: input.productId as number };
  }
  if (!Number.isInteger(input.replacementProductId) || (input.replacementProductId as number) < 1) {
    throw new Error('replacementProductId must be a positive catalog product ID.');
  }
  return {
    productId: input.productId as number,
    replacementProductId: input.replacementProductId as number,
  };
}

function validateEmptyToolInput(rawInput: unknown, action: string) {
  if (rawInput === undefined) return;
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput) || Object.keys(rawInput).length) {
    throw new Error(`${action} does not accept input.`);
  }
}

function productIdsForSlot(selections: StyleSelections, slot: StyleSlot) {
  if (slot === 'Accessory') return selections.Accessory ?? [];
  const id = selections[slot];
  return typeof id === 'number' ? [id] : [];
}

function selectedProductIds(selections: StyleSelections) {
  return styleSlots.flatMap((slot) => productIdsForSlot(selections, slot));
}

function selectedProducts(selections: StyleSelections) {
  return selectedProductIds(selections).flatMap((id) => {
    const product = productById.get(id);
    return product ? [product] : [];
  });
}

function productsToBuyForLook(
  pieces: Product[],
  capsuleJourney: boolean,
  ownedProductIds: readonly number[],
) {
  if (!capsuleJourney || !ownedProductIds.length) return pieces;
  const ownedIds = new Set(ownedProductIds);
  return pieces.filter((product) => !ownedIds.has(product.id));
}

function stagedLookSnapshot(selections: StyleSelections) {
  const pieces = selectedProducts(selections);
  return {
    selectedProductIds: pieces.map((product) => product.id),
    selectedPieces: pieces.map((product) => ({
      id: product.id,
      name: product.name,
      color: product.color,
      slot: slotForProduct(product),
      priceCad: product.price,
    })),
    lookTotalCad: pieces.reduce((sum, product) => sum + product.price, 0),
  };
}

function cloneSelections(selections: StyleSelections): StyleSelections {
  return {
    ...selections,
    ...(selections.Accessory ? { Accessory: [...selections.Accessory] } : {}),
  };
}

function selectionIncludes(selections: StyleSelections, product: Product) {
  return productIdsForSlot(selections, slotForProduct(product)).includes(product.id);
}

function removeProductFromSelections(selections: StyleSelections, product: Product) {
  const slot = slotForProduct(product);
  const nextSelections = cloneSelections(selections);
  if (slot === 'Accessory') {
    const remainingAccessories = (nextSelections.Accessory ?? []).filter((id) => id !== product.id);
    if (remainingAccessories.length) nextSelections.Accessory = remainingAccessories;
    else delete nextSelections.Accessory;
  } else {
    delete nextSelections[slot];
  }
  return nextSelections;
}

function replaceProductInSelections(
  selections: StyleSelections,
  product: Product,
  replacement: Product,
) {
  const slot = slotForProduct(product);
  const nextSelections = cloneSelections(selections);
  if (slot === 'Accessory') {
    nextSelections.Accessory = (nextSelections.Accessory ?? []).map((id) => (
      id === product.id ? replacement.id : id
    ));
  } else {
    nextSelections[slot] = replacement.id;
  }
  return nextSelections;
}

function addProductToSelections(selections: StyleSelections, product: Product) {
  const slot = slotForProduct(product);
  const nextSelections = cloneSelections(selections);
  if (slot === 'Accessory') {
    nextSelections.Accessory = [...(nextSelections.Accessory ?? []), product.id];
  } else {
    nextSelections[slot] = product.id;
  }
  return nextSelections;
}

function slotHasSelection(selections: StyleSelections, slot: StyleSlot) {
  return productIdsForSlot(selections, slot).length > 0;
}

type PreviewCompositionResult = {
  status: 'idle' | 'composed' | 'error';
  message?: string;
};

type ValidatedToolLook = {
  model: ModelId;
  selections: StyleSelections;
  pieces: Product[];
};

type CapsuleJourneyLook = {
  name: string;
  moment: string;
  stylingNote: string;
  selections: StyleSelections;
};

type CapsuleJourney = {
  model: ModelId;
  title: string;
  brief: string;
  budgetCad?: number;
  looks: CapsuleJourneyLook[];
};

type CapsuleConstraints = {
  climate: string;
  dressCode: string;
  preferredColors: string[];
  excludedColors: string[];
};

type CapsuleMetrics = {
  outfitCount: number;
  uniquePieceCount: number;
  reusedPieceCount: number;
  ownedPieceCount: number;
  ownedPiecesReused: number;
  newPieceCount: number;
  totalSpendCad: number;
  costPerOccasionCad: number;
};

type CapsuleRevision = {
  note: string;
  preservedProductIds: number[];
  removedProductIds: number[];
  addedProductIds: number[];
  reasons: Array<{ productId: number; action: 'added' | 'removed'; reason: string }>;
  beforeMetrics: CapsuleMetrics;
  afterMetrics: CapsuleMetrics;
  beforeBudgetCad?: number;
  afterBudgetCad?: number;
};

type PersistedElaneSession = {
  version: 1;
  styleCollection: ModelId | null;
  model: ModelId;
  isCapsuleJourney: boolean;
  activeJourneyIndex: number;
  journey: CapsuleJourney;
  selections: StyleSelections;
  size: AtelierSize;
  capsuleConstraints: CapsuleConstraints;
  ownedProductIds: number[];
  excludedProductIds: number[];
  lockedProductIds: number[];
  bag: Array<{
    productId: number;
    quantity: number;
    size: AtelierSize;
  }>;
};

const elaneSessionStorageKey = 'elane:working-session:v1';

const garmentBoardOrder: Record<StyleSlot, number> = {
  Layer: 1,
  Dress: 1,
  Top: 2,
  Bottom: 3,
  Accessory: 4,
};

const webMcpSlotFields: Array<[
  keyof Omit<AtelierToolInput, 'model' | 'accessoryIds'>,
  Exclude<StyleSlot, 'Accessory'>,
]> = [
  ['topId', 'Top'],
  ['bottomId', 'Bottom'],
  ['dressId', 'Dress'],
  ['layerId', 'Layer'],
];

const curatedJourneys: Record<ModelId, CapsuleJourney> = {
  woman: {
    model: 'woman',
    title: 'Toronto wedding weekend',
    brief: 'November ceremony and brunch · under $2,000',
    budgetCad: 2000,
    looks: [
      {
        name: 'Ceremony colour',
        moment: '15:00 · Ceremony',
        stylingNote: 'Deep teal anchors the occasion while the camel coat adds November warmth and a softly formal finish.',
        selections: { Dress: 28, Layer: 17, Accessory: [73] },
      },
      {
        name: 'Brunch ease',
        moment: '11:00 · Brunch',
        stylingNote: 'Stone merino and navy tailoring create an easy second look; the coat and bag carry the capsule across both occasions.',
        selections: { Top: 18, Bottom: 21, Layer: 17, Accessory: [73] },
      },
    ],
  },
  man: {
    model: 'man',
    title: 'A week in motion',
    brief: 'Client meeting, late dinner, weekend train · under $2,000',
    budgetCad: 2000,
    looks: [
      {
        name: 'Quiet authority',
        moment: '09:30 · Meeting',
        stylingNote: 'Soft tailoring sharpens the poplin shirt and single-pleat trouser without feeling formal.',
        selections: { Top: 10, Bottom: 13, Layer: 14, Accessory: [79] },
      },
      {
        name: 'Evening texture',
        moment: '20:00 · Dinner',
        stylingNote: 'The merino mock neck and alpaca scarf shift the tailored base into a richer evening register.',
        selections: { Top: 12, Bottom: 13, Layer: 14, Accessory: [79, 78] },
      },
      {
        name: 'Platform ease',
        moment: '11:00 · Away',
        stylingNote: 'Relaxed denim and poplin travel easily, finished with a warm scarf and cashmere beanie.',
        selections: { Top: 10, Bottom: 56, Accessory: [78, 80] },
      },
    ],
  },
};

const curatedConstraints: Record<ModelId, CapsuleConstraints> = {
  woman: {
    climate: 'Toronto · November · cool weather',
    dressCode: 'Wedding ceremony and smart brunch',
    preferredColors: ['Deep Teal', 'Camel'],
    excludedColors: [],
  },
  man: {
    climate: 'Toronto · transitional weather',
    dressCode: 'Business to smart casual',
    preferredColors: ['Camel', 'Espresso'],
    excludedColors: [],
  },
};

function cloneJourney(journey: CapsuleJourney): CapsuleJourney {
  return {
    ...journey,
    looks: journey.looks.map((look) => ({ ...look, selections: cloneSelections(look.selections) })),
  };
}

function cloneConstraints(constraints: CapsuleConstraints): CapsuleConstraints {
  return {
    ...constraints,
    preferredColors: [...constraints.preferredColors],
    excludedColors: [...constraints.excludedColors],
  };
}

function capsuleProductIds(journey: CapsuleJourney) {
  return Array.from(new Set(journey.looks.flatMap((look) => selectedProductIds(look.selections))));
}

function calculateCapsuleMetrics(journey: CapsuleJourney, ownedProductIds: Iterable<number>): CapsuleMetrics {
  const owned = new Set(ownedProductIds);
  const usage = new Map<number, number>();
  journey.looks.forEach((look) => {
    selectedProductIds(look.selections).forEach((id) => usage.set(id, (usage.get(id) ?? 0) + 1));
  });
  const uniqueIds = Array.from(usage.keys());
  const totalSpendCad = uniqueIds.reduce((sum, id) => (
    owned.has(id) ? sum : sum + (productById.get(id)?.price ?? 0)
  ), 0);
  return {
    outfitCount: journey.looks.length,
    uniquePieceCount: uniqueIds.length,
    reusedPieceCount: Array.from(usage.values()).filter((count) => count > 1).length,
    ownedPieceCount: uniqueIds.filter((id) => owned.has(id)).length,
    ownedPiecesReused: uniqueIds.filter((id) => owned.has(id) && (usage.get(id) ?? 0) > 1).length,
    newPieceCount: uniqueIds.filter((id) => !owned.has(id)).length,
    totalSpendCad,
    costPerOccasionCad: journey.looks.length ? Math.round(totalSpendCad / journey.looks.length) : 0,
  };
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function waitForTransitionEnd(element: Element | null, timeoutMs: number) {
  if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      element.removeEventListener('transitionend', finish);
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, timeoutMs);
    element.addEventListener('transitionend', finish, { once: true });
  });
}

function lookName(selections: StyleSelections) {
  const pieces = selectedProducts(selections);
  if (!pieces.length) return 'Unstyled canvas';
  if (pieces.length === 1) return pieces[0].name;
  return `${pieces[0].color} / ${pieces[pieces.length - 1].color}`;
}

function selectedGarmentsBrief(pieces: Product[], total: number) {
  if (!pieces.length) return 'No garments selected in this look';
  const visibleNames = pieces.slice(0, 3).map((product) => product.name).join(', ');
  const remainingCount = pieces.length - 3;
  return `${visibleNames}${remainingCount > 0 ? ` + ${remainingCount} more` : ''} · ${currency(total)}`;
}

function styleSlotPlural(slot: StyleSlot) {
  if (slot === 'Accessory') return 'accessories';
  if (slot === 'Dress') return 'dresses';
  return `${slot.toLowerCase()}s`;
}

const productImageSurfaceBySheet: Record<string, string> = {
  '/elane-men-products.jpg': '#f9efe2',
  '/elane-men-products-02.jpg': '#f7efe5',
  '/elane-men-products-03.jpg': '#f6efe7',
  '/elane-men-products-04.jpg': '#f8f0e7',
  '/elane-women-products.jpg': '#f6ede1',
  '/elane-women-products-02.jpg': '#f7eee5',
  '/elane-women-products-03.jpg': '#ece4da',
  '/elane-women-products-04.jpg': '#fcf3ea',
  '/elane-women-products-05.jpg': '#f7eee5',
};

function ProductVisual({ product, className = '', decorative = false }: {
  product: Product;
  className?: string;
  decorative?: boolean;
}) {
  const spriteAspect = product.image === '/elane-women-products.jpg' ? '2 / 3' : '3 / 4';
  const style = {
    '--product-image': `url(${product.image})`,
    '--product-x': `${(product.spriteColumn / 3) * 100}%`,
    '--product-y': `${product.spriteRow * 100}%`,
    '--product-aspect': spriteAspect,
    '--product-surface': productImageSurfaceBySheet[product.image] ?? '#f7efe5',
  } as React.CSSProperties;

  return (
    <span
      className={`product-visual ${className}`}
      style={style}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `${product.name}, ${product.color}`}
    >
      <span className="product-visual-sprite" aria-hidden="true" />
    </span>
  );
}

const spriteImageCache = new Map<string, Promise<HTMLImageElement>>();
const accessoryInteriorSeeds: Partial<Record<number, Array<[number, number]>>> = {
  73: [[0.5, 0.28], [0.5, 0.4]],
  74: [[0.5, 0.31]],
  75: [[0.48, 0.55]],
  77: [[0.5, 0.25], [0.5, 0.42]],
  78: [[0.5, 0.29], [0.5, 0.36]],
  79: [[0.47, 0.55]],
  81: [[0.5, 0.29], [0.5, 0.4]],
  82: [[0.5, 0.3]],
  83: [[0.48, 0.55]],
  85: [[0.5, 0.28], [0.5, 0.36]],
  86: [[0.47, 0.55]],
  88: [[0.5, 0.25], [0.5, 0.42]],
};

function loadSpriteImage(src: string) {
  const cached = spriteImageCache.get(src);
  if (cached) return cached;

  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load garment board source ${src}.`));
    image.src = src;
  });
  spriteImageCache.set(src, pending);
  return pending;
}

function removeConnectedBackground(
  imageData: ImageData,
  interiorSeeds: Array<[number, number]> = [],
  background: 'checkerboard' | 'warm-cream' = 'checkerboard',
) {
  const { data, width, height } = imageData;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const isBackground = (pixel: number) => {
    const offset = pixel * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const tone = (red + green + blue) / 3;

    // Older sheets use a white/light-grey checkerboard; newer accessory
    // colourways use a warm studio sweep. Flood only from the crop edges and
    // known enclosed openings so light garments are preserved.
    const neutralChecker = maximum - minimum <= 5 && tone >= 215;
    const warmStudio = background === 'warm-cream'
      && red >= 215
      && green >= 200
      && blue >= 185
      && red >= green
      && green >= blue
      && red - blue <= 45;
    return neutralChecker || warmStudio;
  };
  const enqueue = (pixel: number) => {
    if (visited[pixel] || !isBackground(pixel)) return;
    visited[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  interiorSeeds.forEach(([xRatio, yRatio]) => {
    const x = Math.round((width - 1) * xRatio);
    const y = Math.round((height - 1) * yRatio);
    enqueue(y * width + x);
  });

  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    data[pixel * 4 + 3] = 0;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y + 1 < height) enqueue(pixel + width);
  }

  return imageData;
}

function keepLargestForegroundShape(imageData: ImageData) {
  const { data, width, height } = imageData;
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  let nextLabel = 0;
  let largestLabel = 0;
  let largestSize = 0;
  const enqueueForeground = (pixel: number) => {
    if (pixel < 0 || labels[pixel] || data[pixel * 4 + 3] === 0) return;
    labels[pixel] = nextLabel;
    queue[tail] = pixel;
    tail += 1;
  };
  let tail = 0;

  for (let start = 0; start < width * height; start += 1) {
    if (labels[start] || data[start * 4 + 3] === 0) continue;
    nextLabel += 1;
    let head = 0;
    let size = 0;
    tail = 0;
    labels[start] = nextLabel;
    queue[tail] = start;
    tail += 1;

    while (head < tail) {
      const pixel = queue[head];
      head += 1;
      size += 1;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (x > 0) enqueueForeground(pixel - 1);
      if (x + 1 < width) enqueueForeground(pixel + 1);
      if (y > 0) enqueueForeground(pixel - width);
      if (y + 1 < height) enqueueForeground(pixel + width);
    }

    if (size > largestSize) {
      largestSize = size;
      largestLabel = nextLabel;
    }
  }

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (data[pixel * 4 + 3] > 0 && labels[pixel] !== largestLabel) {
      data[pixel * 4 + 3] = 0;
    }
  }
  return imageData;
}

async function drawSpriteLayer(canvas: HTMLCanvasElement, product: Product) {
  const layer = product.garmentBoardAsset;
  if (!layer?.sprite) return;
  const image = await loadSpriteImage(layer.image);
  const sourceWidth = image.naturalWidth / 4;
  const sourceHeight = image.naturalHeight / 2;
  const crop = document.createElement('canvas');
  crop.width = Math.round(sourceWidth);
  crop.height = Math.round(sourceHeight);
  const cropContext = crop.getContext('2d', { willReadFrequently: true });
  if (!cropContext) throw new Error('The garment board canvas is unavailable.');

  cropContext.drawImage(
    image,
    layer.sprite.column * sourceWidth,
    layer.sprite.row * sourceHeight,
    sourceWidth,
    sourceHeight,
    0,
    0,
    crop.width,
    crop.height,
  );
  let cutout = removeConnectedBackground(
    cropContext.getImageData(0, 0, crop.width, crop.height),
    accessoryInteriorSeeds[product.id],
    layer.sprite.background,
  );
  if (slotForProduct(product) !== 'Accessory') cutout = keepLargestForegroundShape(cutout);
  cropContext.putImageData(cutout, 0, 0);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('The garment board canvas is unavailable.');
  context.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / crop.width, canvas.height / crop.height);
  const width = crop.width * scale;
  const height = crop.height * scale;
  context.drawImage(crop, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
}

function GarmentBoardVisual({ product }: { product: Product }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layer = product.garmentBoardAsset;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layer.sprite) return;
    let active = true;
    void drawSpriteLayer(canvas, product).catch((error) => {
      if (active) console.error('Unable to draw an ÉLANE garment layer.', error);
    });
    return () => { active = false; };
  }, [layer.sprite, product]);

  if (layer.sprite) {
    return (
      <canvas
        aria-hidden="true"
        className="garment-board-canvas"
        height={560}
        ref={canvasRef}
        width={448}
      />
    );
  }

  return (
    <img
      aria-hidden="true"
      className="garment-board-image"
      src={layer.image}
      alt=""
    />
  );
}

function validateToolLook(rawInput: unknown): ValidatedToolLook {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('Expected an object containing a model and at least one catalog product ID.');
  }

  const input = rawInput as Partial<AtelierToolInput>;
  const allowedKeys = new Set([
    'model', 'topId', 'bottomId', 'dressId', 'layerId', 'accessoryIds',
  ]);
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Unknown look field: ${unknownKey}.`);
  if (input.model !== 'woman' && input.model !== 'man') {
    throw new Error('Model must be either "woman" or "man".');
  }

  const expectedAudience = input.model === 'woman' ? 'Women' : 'Men';
  const nextSelections: StyleSelections = {};
  for (const [field, slot] of webMcpSlotFields) {
    const id = input[field];
    if (id === undefined) continue;
    if (!Number.isInteger(id)) throw new Error(`${field} must be a catalog product ID.`);
    const product = productById.get(id);
    if (!product) throw new Error(`Product ${id} is not in the ÉLANE catalog.`);
    if (product.audience !== expectedAudience) {
      throw new Error(`${product.name} is a ${product.audience.toLowerCase()} product and cannot be used with the selected collection.`);
    }
    if (slotForProduct(product) !== slot) {
      throw new Error(`${product.name} cannot be selected as ${slot.toLowerCase()}.`);
    }
    nextSelections[slot] = product.id;
  }

  if (input.accessoryIds !== undefined) {
    if (!Array.isArray(input.accessoryIds) || input.accessoryIds.length < 1 || input.accessoryIds.length > 4) {
      throw new Error('accessoryIds must contain between one and four catalog product IDs when supplied.');
    }
    const accessoryIds = input.accessoryIds.map((id) => {
      if (!Number.isInteger(id)) throw new Error('Every accessoryIds entry must be a catalog product ID.');
      const product = productById.get(id);
      if (!product) throw new Error(`Product ${id} is not in the ÉLANE catalog.`);
      if (product.audience !== expectedAudience) {
        throw new Error(`${product.name} is a ${product.audience.toLowerCase()} product and cannot be used with the selected collection.`);
      }
      if (slotForProduct(product) !== 'Accessory') {
        throw new Error(`${product.name} cannot be selected as an accessory.`);
      }
      return id;
    });
    if (new Set(accessoryIds).size !== accessoryIds.length) {
      throw new Error('accessoryIds cannot contain duplicates.');
    }
    if (accessoryIds.length) nextSelections.Accessory = accessoryIds;
  }

  const pieces = selectedProducts(nextSelections);
  if (!pieces.length) throw new Error('Select at least one catalog product prepared for the garment board.');
  if (nextSelections.Dress && (nextSelections.Top || nextSelections.Bottom)) {
    throw new Error('Choose either a dress or a top/bottom combination, not both.');
  }

  return { model: input.model, selections: nextSelections, pieces };
}

function validatedText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function validateCapsuleJourney(rawInput: unknown): CapsuleJourney {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('Expected a capsule journey object.');
  }

  const input = rawInput as Partial<CapsuleJourneyInput>;
  const allowedKeys = new Set(['model', 'title', 'brief', 'budgetCad', 'looks']);
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Unknown capsule journey field: ${unknownKey}.`);
  if (input.model !== 'woman' && input.model !== 'man') {
    throw new Error('Model must be either "woman" or "man".');
  }
  if (!Array.isArray(input.looks) || input.looks.length < 2 || input.looks.length > 4) {
    throw new Error('A capsule journey must contain between two and four looks.');
  }
  if (input.budgetCad !== undefined && (
    !Number.isInteger(input.budgetCad) || input.budgetCad < 100 || input.budgetCad > 10000
  )) {
    throw new Error('budgetCad must be a whole CAD amount between 100 and 10,000.');
  }

  const looks = input.looks.map((rawLook, index) => {
    if (!rawLook || typeof rawLook !== 'object' || Array.isArray(rawLook)) {
      throw new Error(`Look ${index + 1} must be an object.`);
    }
    const look = rawLook as CapsuleJourneyInput['looks'][number];
    const allowedLookKeys = new Set([
      'name', 'moment', 'stylingNote', 'topId', 'bottomId', 'dressId', 'layerId',
      'accessoryIds',
    ]);
    const unknownLookKey = Object.keys(look).find((key) => !allowedLookKeys.has(key));
    if (unknownLookKey) {
      throw new Error(`Unknown field in look ${index + 1}: ${unknownLookKey}.`);
    }
    if (look.stylingNote !== undefined && typeof look.stylingNote !== 'string') {
      throw new Error(`Look ${index + 1} styling note must be a string.`);
    }
    const validated = validateToolLook({
      model: input.model,
      topId: look.topId,
      bottomId: look.bottomId,
      dressId: look.dressId,
      layerId: look.layerId,
      accessoryIds: look.accessoryIds,
    });
    return {
      name: validatedText(look.name, `Look ${index + 1} name`, 48),
      moment: validatedText(look.moment, `Look ${index + 1} moment`, 48),
      stylingNote: typeof look.stylingNote === 'string' && look.stylingNote.trim()
        ? validatedText(look.stylingNote, `Look ${index + 1} styling note`, 180)
        : '',
      selections: validated.selections,
    };
  });

  const uniqueIds = new Set(looks.flatMap((look) => selectedProductIds(look.selections)));
  const capsuleValue = Array.from(uniqueIds).reduce((sum, id) => {
    const product = productById.get(id);
    return sum + (product?.price ?? 0);
  }, 0);
  if (input.budgetCad !== undefined && capsuleValue > input.budgetCad) {
    throw new Error(`The proposed capsule is ${currency(capsuleValue)}, above the ${currency(input.budgetCad)} budget.`);
  }

  return {
    model: input.model,
    title: validatedText(input.title, 'Journey title', 64),
    brief: validatedText(input.brief, 'Journey brief', 180),
    budgetCad: input.budgetCad,
    looks,
  };
}

function validateStringList(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 12) {
    throw new Error(`${label} must be an array containing up to 12 values.`);
  }
  const items = value.map((item) => validatedText(item, label, 32));
  if (new Set(items.map((item) => item.toLowerCase())).size !== items.length) {
    throw new Error(`${label} cannot contain duplicates.`);
  }
  return items;
}

function validateCapsuleProductIds(value: unknown, label: string, model: ModelId) {
  if (!Array.isArray(value) || value.length > products.length) {
    throw new Error(`${label} must be an array of catalog product IDs.`);
  }
  const expectedAudience = model === 'woman' ? 'Women' : 'Men';
  const ids = value.map((id) => {
    if (!Number.isInteger(id)) throw new Error(`Every ${label} entry must be a catalog product ID.`);
    const product = productById.get(id as number);
    if (!product) throw new Error(`Product ${id} is not available in the Style Studio catalog.`);
    if (product.audience !== expectedAudience) {
      throw new Error(`${product.name} does not match the active ${expectedAudience.toLowerCase()} collection.`);
    }
    return id as number;
  });
  if (new Set(ids).size !== ids.length) throw new Error(`${label} cannot contain duplicates.`);
  return ids;
}

function validatePersistedSelections(value: unknown, model: ModelId): StyleSelections {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Persisted selections must be an object.');
  }
  const input = value as Record<string, unknown>;
  const unknownKey = Object.keys(input).find((key) => !styleSlots.includes(key as StyleSlot));
  if (unknownKey) throw new Error(`Unknown persisted selection field: ${unknownKey}.`);

  const expectedAudience = model === 'woman' ? 'Women' : 'Men';
  const selections: StyleSelections = {};
  for (const slot of styleSlots) {
    const selectedValue = input[slot];
    if (selectedValue === undefined) continue;
    if (slot === 'Accessory') {
      if (!Array.isArray(selectedValue) || selectedValue.length > 4) {
        throw new Error('Persisted accessories must contain up to four catalog product IDs.');
      }
      const accessoryIds = selectedValue.map((id) => {
        if (!Number.isInteger(id)) throw new Error('Persisted accessory IDs must be integers.');
        const product = productById.get(id as number);
        if (!product || product.audience !== expectedAudience || slotForProduct(product) !== slot) {
          throw new Error(`Persisted accessory ${id} is not compatible with the active collection.`);
        }
        return id as number;
      });
      if (new Set(accessoryIds).size !== accessoryIds.length) {
        throw new Error('Persisted accessories cannot contain duplicates.');
      }
      if (accessoryIds.length) selections.Accessory = accessoryIds;
      continue;
    }

    if (!Number.isInteger(selectedValue)) {
      throw new Error(`Persisted ${slot.toLowerCase()} selection must be a catalog product ID.`);
    }
    const product = productById.get(selectedValue as number);
    if (!product || product.audience !== expectedAudience || slotForProduct(product) !== slot) {
      throw new Error(`Persisted ${slot.toLowerCase()} ${selectedValue} is not compatible with the active collection.`);
    }
    selections[slot] = selectedValue as number;
  }

  if (selections.Dress && (selections.Top || selections.Bottom)) {
    throw new Error('Persisted selections cannot mix a dress with a top or bottom.');
  }
  return selections;
}

function validatePersistedJourney(value: unknown, model: ModelId): CapsuleJourney {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Persisted capsule must be an object.');
  }
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set(['model', 'title', 'brief', 'budgetCad', 'looks']);
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Unknown persisted capsule field: ${unknownKey}.`);
  if (input.model !== model) throw new Error('Persisted capsule collection does not match the active collection.');
  if (!Array.isArray(input.looks) || input.looks.length < 2 || input.looks.length > 4) {
    throw new Error('Persisted capsule must contain between two and four looks.');
  }
  if (input.budgetCad !== undefined && (
    !Number.isInteger(input.budgetCad) || (input.budgetCad as number) < 100 || (input.budgetCad as number) > 10000
  )) {
    throw new Error('Persisted capsule budget is invalid.');
  }

  const looks = input.looks.map((valueForLook, index) => {
    if (!valueForLook || typeof valueForLook !== 'object' || Array.isArray(valueForLook)) {
      throw new Error(`Persisted look ${index + 1} must be an object.`);
    }
    const look = valueForLook as Record<string, unknown>;
    const allowedLookKeys = new Set(['name', 'moment', 'stylingNote', 'selections']);
    const unknownLookKey = Object.keys(look).find((key) => !allowedLookKeys.has(key));
    if (unknownLookKey) throw new Error(`Unknown field in persisted look ${index + 1}: ${unknownLookKey}.`);
    return {
      name: validatedText(look.name, `Persisted look ${index + 1} name`, 48),
      moment: validatedText(look.moment, `Persisted look ${index + 1} moment`, 48),
      stylingNote: typeof look.stylingNote === 'string' && look.stylingNote.trim()
        ? validatedText(look.stylingNote, `Persisted look ${index + 1} styling note`, 180)
        : '',
      selections: validatePersistedSelections(look.selections, model),
    };
  });

  return {
    model,
    title: validatedText(input.title, 'Persisted capsule title', 64),
    brief: validatedText(input.brief, 'Persisted capsule brief', 180),
    budgetCad: input.budgetCad as number | undefined,
    looks,
  };
}

function validatePersistedConstraints(value: unknown): CapsuleConstraints {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Persisted capsule constraints must be an object.');
  }
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set(['climate', 'dressCode', 'preferredColors', 'excludedColors']);
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Unknown persisted constraint field: ${unknownKey}.`);
  return {
    climate: validatedText(input.climate, 'Persisted climate', 80),
    dressCode: validatedText(input.dressCode, 'Persisted dress code', 80),
    preferredColors: validateStringList(input.preferredColors, 'Persisted preferred colours'),
    excludedColors: validateStringList(input.excludedColors, 'Persisted excluded colours'),
  };
}

function readPersistedElaneSession(): PersistedElaneSession | null {
  try {
    const serialized = window.localStorage.getItem(elaneSessionStorageKey);
    if (!serialized) return null;
    const value = JSON.parse(serialized) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) {
      throw new Error('Unsupported ÉLANE session version.');
    }
    if (value.model !== 'woman' && value.model !== 'man') {
      throw new Error('Persisted collection is invalid.');
    }
    if (
      value.styleCollection !== undefined
      && value.styleCollection !== null
      && value.styleCollection !== 'woman'
      && value.styleCollection !== 'man'
    ) {
      throw new Error('Persisted Style Studio collection is invalid.');
    }
    if (typeof value.isCapsuleJourney !== 'boolean') {
      throw new Error('Persisted presentation mode is invalid.');
    }
    if (!Number.isInteger(value.activeJourneyIndex) || (value.activeJourneyIndex as number) < 0) {
      throw new Error('Persisted capsule position is invalid.');
    }
    if (!atelierSizes.includes(value.size as AtelierSize)) {
      throw new Error('Persisted size is invalid.');
    }

    const model = value.model;
    // Sessions saved before an explicit collection choice existed should reopen
    // to the new neutral Style Studio instead of restoring the old women-first default.
    const styleCollection = value.styleCollection === 'woman' || value.styleCollection === 'man'
      ? value.styleCollection
      : null;
    if (styleCollection && styleCollection !== model) {
      throw new Error('Persisted Style Studio collection does not match its model.');
    }
    const journey = validatePersistedJourney(value.journey, model);
    const activeJourneyIndex = Math.min(value.activeJourneyIndex as number, journey.looks.length - 1);
    const isCapsuleJourney = styleCollection ? value.isCapsuleJourney : false;
    const selections = styleCollection
      ? isCapsuleJourney
        ? cloneSelections(journey.looks[activeJourneyIndex].selections)
        : validatePersistedSelections(value.selections, model)
      : {};
    const capsuleConstraints = validatePersistedConstraints(value.capsuleConstraints);
    const ownedProductIds = styleCollection
      ? validateCapsuleProductIds(value.ownedProductIds, 'Persisted ownedProductIds', model)
      : [];
    const excludedProductIds = styleCollection
      ? validateCapsuleProductIds(value.excludedProductIds, 'Persisted excludedProductIds', model)
      : [];
    const lockedProductIds = styleCollection && isCapsuleJourney
      ? validateCapsuleProductIds(value.lockedProductIds, 'Persisted lockedProductIds', model)
      : [];
    const capsuleIds = new Set(capsuleProductIds(journey));
    if (lockedProductIds.some((id) => !capsuleIds.has(id))) {
      throw new Error('A persisted locked piece is not present in the capsule.');
    }
    if (ownedProductIds.some((id) => excludedProductIds.includes(id))) {
      throw new Error('A persisted piece cannot be both owned and excluded.');
    }

    if (!Array.isArray(value.bag) || value.bag.length > products.length) {
      throw new Error('Persisted bag is invalid.');
    }
    const bagIds = new Set<number>();
    const bag = value.bag.map((bagValue) => {
      if (!bagValue || typeof bagValue !== 'object' || Array.isArray(bagValue)) {
        throw new Error('Persisted bag line is invalid.');
      }
      const item = bagValue as Record<string, unknown>;
      const product = Number.isInteger(item.productId) ? productById.get(item.productId as number) : undefined;
      if (!product || !Number.isSafeInteger(item.quantity) || (item.quantity as number) < 1) {
        throw new Error('Persisted bag line has an invalid product or quantity.');
      }
      if (!atelierSizes.includes(item.size as AtelierSize) || bagIds.has(product.id)) {
        throw new Error('Persisted bag line has an invalid size or duplicate product.');
      }
      bagIds.add(product.id);
      return { ...product, quantity: item.quantity as number, size: item.size as AtelierSize };
    });
    return {
      version: 1,
      styleCollection,
      model,
      isCapsuleJourney,
      activeJourneyIndex: isCapsuleJourney ? activeJourneyIndex : 0,
      journey,
      selections,
      size: value.size as AtelierSize,
      capsuleConstraints,
      ownedProductIds,
      excludedProductIds,
      lockedProductIds,
      bag: bag.map((item) => ({ productId: item.id, quantity: item.quantity, size: item.size as AtelierSize })),
    };
  } catch (error) {
    console.warn('Unable to restore the saved ÉLANE session. Starting with a fresh session.', error);
    return null;
  }
}

function validateCapsuleReplan(
  rawInput: unknown,
  currentJourney: CapsuleJourney,
  currentConstraints: CapsuleConstraints,
  currentSize: AtelierSize,
  currentOwnedProductIds: number[],
  currentExcludedProductIds: number[],
  currentLockedProductIds: number[],
) {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('Expected a complete capsule replan object.');
  }
  const input = rawInput as Partial<ReplanCapsuleInput>;
  const allowedKeys = new Set([
    'title', 'brief', 'budgetCad', 'size', 'climate', 'dressCode', 'preferredColors',
    'excludedColors', 'ownedProductIds', 'excludedProductIds', 'lockedProductIds',
    'revisionNote', 'changeReasons', 'looks',
  ]);
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Unknown capsule replan field: ${unknownKey}.`);
  if (!Array.isArray(input.looks)) throw new Error('looks must contain the complete revised capsule.');

  const nextJourney = validateCapsuleJourney({
    model: currentJourney.model,
    title: input.title ?? currentJourney.title,
    brief: input.brief ?? currentJourney.brief,
    looks: input.looks,
  });
  const budgetCad = input.budgetCad ?? currentJourney.budgetCad;
  if (budgetCad !== undefined && (!Number.isInteger(budgetCad) || budgetCad < 100 || budgetCad > 10000)) {
    throw new Error('budgetCad must be a whole CAD amount between 100 and 10,000.');
  }
  nextJourney.budgetCad = budgetCad;

  const nextSize = input.size ?? currentSize;
  if (!atelierSizes.includes(nextSize as AtelierSize)) {
    throw new Error(`size must be one of: ${atelierSizes.join(', ')}.`);
  }
  const nextConstraints: CapsuleConstraints = {
    climate: input.climate === undefined
      ? currentConstraints.climate
      : validatedText(input.climate, 'climate', 80),
    dressCode: input.dressCode === undefined
      ? currentConstraints.dressCode
      : validatedText(input.dressCode, 'dressCode', 80),
    preferredColors: input.preferredColors === undefined
      ? [...currentConstraints.preferredColors]
      : validateStringList(input.preferredColors, 'preferredColors'),
    excludedColors: input.excludedColors === undefined
      ? [...currentConstraints.excludedColors]
      : validateStringList(input.excludedColors, 'excludedColors'),
  };
  const ownedProductIds = input.ownedProductIds === undefined
    ? [...currentOwnedProductIds]
    : validateCapsuleProductIds(input.ownedProductIds, 'ownedProductIds', currentJourney.model);
  const excludedProductIds = input.excludedProductIds === undefined
    ? [...currentExcludedProductIds]
    : validateCapsuleProductIds(input.excludedProductIds, 'excludedProductIds', currentJourney.model);
  const requestedLockedProductIds = input.lockedProductIds === undefined
    ? []
    : validateCapsuleProductIds(input.lockedProductIds, 'lockedProductIds', currentJourney.model);
  const currentIds = new Set(capsuleProductIds(currentJourney));
  const newlyLockedOutsideCapsule = requestedLockedProductIds.find((id) => !currentIds.has(id));
  if (newlyLockedOutsideCapsule) {
    throw new Error(`Product ${newlyLockedOutsideCapsule} cannot be locked because it is not in the current capsule.`);
  }
  const lockedProductIds = Array.from(new Set([...currentLockedProductIds, ...requestedLockedProductIds]));
  const nextIds = new Set(capsuleProductIds(nextJourney));
  const missingLockedId = lockedProductIds.find((id) => !nextIds.has(id));
  if (missingLockedId) {
    throw new Error(`${productById.get(missingLockedId)?.name ?? `Product ${missingLockedId}`} is locked and must remain in the replanned capsule.`);
  }
  const excludedSet = new Set(excludedProductIds);
  const refusedId = Array.from(nextIds).find((id) => excludedSet.has(id));
  if (refusedId) {
    throw new Error(`${productById.get(refusedId)?.name ?? `Product ${refusedId}`} is excluded and cannot appear in the replanned capsule.`);
  }
  const conflictingOwnedId = ownedProductIds.find((id) => excludedSet.has(id));
  if (conflictingOwnedId) {
    throw new Error(`${productById.get(conflictingOwnedId)?.name ?? `Product ${conflictingOwnedId}`} cannot be both owned and excluded.`);
  }
  const lockedExcludedId = lockedProductIds.find((id) => excludedSet.has(id));
  if (lockedExcludedId) {
    throw new Error(`${productById.get(lockedExcludedId)?.name ?? `Product ${lockedExcludedId}`} cannot be both locked and excluded.`);
  }
  const excludedColorSet = new Set(nextConstraints.excludedColors.map((color) => color.toLowerCase()));
  const refusedColorId = Array.from(nextIds).find((id) => (
    excludedColorSet.has((productById.get(id)?.color ?? '').toLowerCase())
  ));
  if (refusedColorId) {
    const product = productById.get(refusedColorId)!;
    throw new Error(`${product.name} is ${product.color}, which is listed as an excluded colour.`);
  }

  const metrics = calculateCapsuleMetrics(nextJourney, ownedProductIds);
  if (budgetCad !== undefined && metrics.totalSpendCad > budgetCad) {
    throw new Error(`The replanned capsule requires ${currency(metrics.totalSpendCad)} in new purchases, above the ${currency(budgetCad)} budget.`);
  }
  const revisionNote = validatedText(input.revisionNote, 'revisionNote', 180);
  const previousIds = new Set(capsuleProductIds(currentJourney));
  const removedProductIds = Array.from(previousIds).filter((id) => !nextIds.has(id));
  const addedProductIds = Array.from(nextIds).filter((id) => !previousIds.has(id));
  const preservedProductIds = Array.from(nextIds).filter((id) => previousIds.has(id));
  const actualChanges = new Set([
    ...removedProductIds.map((id) => `removed:${id}`),
    ...addedProductIds.map((id) => `added:${id}`),
  ]);
  if (input.changeReasons !== undefined && (
    !Array.isArray(input.changeReasons) || input.changeReasons.length > 24
  )) {
    throw new Error('changeReasons must contain at most 24 entries.');
  }
  const reasons = input.changeReasons === undefined ? [] : input.changeReasons.map((change, index) => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) {
      throw new Error(`changeReasons entry ${index + 1} must be an object.`);
    }
    const keys = Object.keys(change);
    if (keys.length !== 3 || !keys.includes('productId') || !keys.includes('action') || !keys.includes('reason')) {
      throw new Error(`changeReasons entry ${index + 1} must contain only productId, action, and reason.`);
    }
    if (!Number.isInteger(change.productId) || (change.action !== 'added' && change.action !== 'removed')) {
      throw new Error(`changeReasons entry ${index + 1} has an invalid productId or action.`);
    }
    if (!actualChanges.has(`${change.action}:${change.productId}`)) {
      throw new Error(`changeReasons entry ${index + 1} does not describe an actual capsule change.`);
    }
    return {
      productId: change.productId as number,
      action: change.action,
      reason: validatedText(change.reason, `changeReasons entry ${index + 1} reason`, 180),
    };
  });
  const reasonKeys = new Set(reasons.map((change) => `${change.action}:${change.productId}`));
  if (reasonKeys.size !== reasons.length) {
    throw new Error('changeReasons cannot contain duplicate product actions.');
  }
  removedProductIds.forEach((productId) => {
    if (!reasonKeys.has(`removed:${productId}`)) {
      reasons.push({ productId, action: 'removed', reason: 'Removed to satisfy the revised capsule constraints.' });
    }
  });
  addedProductIds.forEach((productId) => {
    if (!reasonKeys.has(`added:${productId}`)) {
      reasons.push({ productId, action: 'added', reason: 'Added to restore occasion coverage under the revised constraints.' });
    }
  });

  return {
    nextJourney,
    nextConstraints,
    nextSize: nextSize as AtelierSize,
    ownedProductIds,
    excludedProductIds,
    lockedProductIds,
    revisionNote,
    preservedProductIds,
    removedProductIds,
    addedProductIds,
    reasons,
    metrics,
  };
}

function GarmentBoardPreview({ selections }: { selections: StyleSelections }) {
  const pieces = selectedProducts(selections)
    .toSorted((left, right) => (
      garmentBoardOrder[slotForProduct(left)] - garmentBoardOrder[slotForProduct(right)]
    ));

  return (
    <div
      className={`garment-board garment-count-${pieces.length}`}
      role="group"
      aria-label={`Garment board showing ${lookName(selections)}`}
    >
      {pieces.map((product, index) => {
        const slot = slotForProduct(product);
        return (
          <article className={`garment-board-item slot-${slot.toLowerCase()}`} key={product.id}>
            <div
              className="garment-board-visual"
              role="img"
              aria-label={`${product.name}, ${product.color}`}
            >
              <GarmentBoardVisual product={product} />
            </div>
            <div className="garment-board-label">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <small>{slot}</small>
              <strong>{product.name}</strong>
              <em>{product.color}</em>
            </div>
          </article>
        );
      })}
      {!pieces.length ? (
        <div className="garment-board-empty">
          <strong>Your garment board is clear.</strong>
          <span>Choose a piece to begin a new look.</span>
        </div>
      ) : null}
    </div>
  );
}

function ProductCard({ product, onAdd, onStyle, selected }: {
  product: Product;
  onAdd: (product: Product) => void;
  onStyle: (product: Product) => void;
  selected: boolean;
}) {
  return (
    <article className={`product-card ${selected ? 'style-selected' : ''}`}>
      <div className="product-image-wrap">
        <a className="product-detail-link" href={productHref(product)} aria-label={`View ${product.name} details`}>
          <ProductVisual product={product} className="product-card-image" />
        </a>
        <span className="atelier-ready-badge">Style Studio</span>
        <div className="product-actions">
          <button
            type="button"
            className="quick-style"
            onClick={() => onStyle(product)}
          >{selected ? 'In your look' : 'Style this piece'}</button>
          <button type="button" className="quick-add" onClick={() => onAdd(product)}>Add to bag</button>
        </div>
      </div>
      <div className="product-meta">
        <div><h3><a href={productHref(product)}>{product.name}</a></h3><p>{product.color} · {product.audience}</p></div>
        <strong>{currency(product.price)}</strong>
      </div>
    </article>
  );
}

type ProductGalleryView = 'front' | 'cutout' | 'detail';

function ProductDetail({ product, relatedProducts, initialSize, onAdd }: {
  product: Product;
  relatedProducts: Product[];
  initialSize: AtelierSize;
  onAdd: (product: Product, chosenSize?: AtelierSize, reveal?: boolean) => void;
}) {
  const [galleryView, setGalleryView] = useState<ProductGalleryView>('front');
  const [selectedSize, setSelectedSize] = useState<AtelierSize>(initialSize);
  const isAccessory = product.category === 'Accessories';
  const galleryLabels: Record<ProductGalleryView, string> = {
    front: 'Full view',
    cutout: 'Silhouette',
    detail: 'Detail',
  };

  const galleryVisual = (view: ProductGalleryView, thumbnail = false) => {
    if (view === 'cutout') {
      return <div className={thumbnail ? 'product-gallery-cutout thumbnail' : 'product-gallery-cutout'}><GarmentBoardVisual product={product} /></div>;
    }
    return (
      <ProductVisual
        product={product}
        className={`${thumbnail ? 'product-gallery-thumbnail-image' : 'product-detail-image'} ${view === 'detail' ? 'product-detail-image-crop' : ''}`}
        decorative={thumbnail}
      />
    );
  };

  return (
    <>
      <section className="product-detail-page" aria-labelledby="product-detail-title">
        <nav className="product-breadcrumb" aria-label="Breadcrumb">
          <a href={collectionHref()}>Shop</a><span aria-hidden="true">/</span><a href={collectionHref(product.audience, product.category as CategoryFilter)}>{product.category}</a><span aria-hidden="true">/</span><span>{product.name}</span>
        </nav>

        <div className="product-detail-layout">
          <div className="product-gallery">
            <div className={`product-gallery-main view-${galleryView}`} aria-live="polite">
              {galleryVisual(galleryView)}
              <span className="product-gallery-caption">{galleryLabels[galleryView]} · {product.color}</span>
            </div>
            <div className="product-gallery-thumbnails" aria-label="Product images">
              {(Object.keys(galleryLabels) as ProductGalleryView[]).map((view) => (
                <button
                  className={galleryView === view ? 'active' : ''}
                  key={view}
                  type="button"
                  onClick={() => setGalleryView(view)}
                  aria-pressed={galleryView === view}
                  aria-label={`Show ${galleryLabels[view].toLowerCase()}`}
                >
                  {galleryVisual(view, true)}
                  <span>{galleryLabels[view]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="product-purchase-panel">
            <p className="product-kicker">{product.audience} · {product.category}</p>
            <h1 id="product-detail-title">{product.name}</h1>
            <div className="product-detail-price"><span>{product.color}</span><strong>{currency(product.price)}</strong></div>
            <p className="product-description">{productDescription(product)}</p>

            <div className="product-size-section">
              <div className="product-size-heading"><span>Select size</span>{!isAccessory ? <a href="#fit-details">Size &amp; fit</a> : null}</div>
              {isAccessory ? (
                <button className="one-size-option" type="button" aria-pressed="true">One size</button>
              ) : (
                <div className="product-size-options">
                  {atelierSizes.map((item) => (
                    <button
                      className={selectedSize === item ? 'active' : ''}
                      key={item}
                      type="button"
                      onClick={() => setSelectedSize(item)}
                      aria-pressed={selectedSize === item}
                    >{item}</button>
                  ))}
                </div>
              )}
            </div>

            <button className="product-add-button" type="button" onClick={() => onAdd(product, isAccessory ? 'M' : selectedSize)}>
              Add to bag <span>{currency(product.price)}</span>
            </button>
            <p className="product-delivery-note">Complimentary delivery and returns on every order.</p>

            <dl className="product-specifications" id="fit-details">
              <div><dt>Material character</dt><dd>{productMaterial(product)}</dd></div>
              <div><dt>Size &amp; fit</dt><dd>{productFit(product)}</dd></div>
              <div><dt>Care</dt><dd>Follow the care label. Store folded or on a supportive hanger as appropriate.</dd></div>
              <div><dt>Style note</dt><dd>Pair with tonal neutrals, then add one contrasting texture for a considered finish.</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <section className="related-products" aria-labelledby="related-products-title">
        <div className="related-products-heading"><p className="section-index">Continue exploring</p><h2 id="related-products-title">You may also like.</h2></div>
        <div className="related-products-grid">
          {relatedProducts.map((relatedProduct) => (
            <article key={relatedProduct.id}>
              <a href={productHref(relatedProduct)} aria-label={`View ${relatedProduct.name} details`}>
                <ProductVisual product={relatedProduct} className="related-product-image" />
                <div><h3>{relatedProduct.name}</h3><strong>{currency(relatedProduct.price)}</strong></div>
                <p>{relatedProduct.color} · {relatedProduct.category}</p>
              </a>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function PromotionOffer({ open, subtotal, onClose, onOpenBag }: {
  open: boolean;
  subtotal: number;
  onClose: () => void;
  onOpenBag: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const eligible = subtotal >= atelierPromotion.minimumSubtotalCad;
  const discount = promotionSavingsCad(subtotal);
  const amountNeeded = Math.max(0, atelierPromotion.minimumSubtotalCad - subtotal);

  if (!open) return null;

  const copyPromotionCode = async () => {
    try {
      await navigator.clipboard.writeText(atelierPromotion.code);
      setCopied(true);
      setCopyError('');
    } catch (error) {
      setCopied(false);
      setCopyError(error instanceof Error ? error.message : 'Unable to copy the promotion code.');
    }
  };
  const closePromotion = () => {
    setCopied(false);
    setCopyError('');
    onClose();
  };
  const openBag = () => {
    setCopied(false);
    setCopyError('');
    onOpenBag();
  };

  return (
    <div className="promotion-layer" role="dialog" aria-modal="true" aria-labelledby="promotion-title">
      <button className="promotion-scrim" type="button" aria-label="Close private offer" onClick={closePromotion} />
      <section className="promotion-panel">
        <button className="modal-close" type="button" autoFocus onClick={closePromotion}>Close</button>
        <p className="section-index">Private offer</p>
        <h2 id="promotion-title">{atelierPromotion.name}</h2>
        <p className="promotion-description">{atelierPromotion.description}</p>

        <div className="promotion-code" aria-label={`Promotion code ${atelierPromotion.code}`}>
          <span>Promotion code</span>
          <strong>{atelierPromotion.code}</strong>
        </div>

        <dl className="promotion-details">
          <div><dt>Savings</dt><dd>{atelierPromotion.discountPercent}% off</dd></div>
          <div><dt>Minimum</dt><dd>{currency(atelierPromotion.minimumSubtotalCad)}</dd></div>
          <div><dt>Eligible pieces</dt><dd>All ÉLANE catalog products</dd></div>
          <div><dt>Valid through</dt><dd>December 31, 2026</dd></div>
        </dl>

        <div className={`promotion-eligibility ${eligible ? 'eligible' : ''}`} aria-live="polite">
          <span>Current bag · {currency(subtotal)}</span>
          <strong>{eligible
            ? `Eligible · save ${currency(discount)}`
            : `Add ${currency(amountNeeded)} to unlock`}</strong>
        </div>

        <div className="promotion-actions">
          <button className="promotion-copy" type="button" onClick={() => void copyPromotionCode()}>
            {copied ? 'Code copied' : 'Copy code'}
          </button>
          <button className="promotion-bag-link" type="button" onClick={openBag}>Go to bag</button>
        </div>
        {copyError ? <small className="promotion-error" role="alert">{copyError}</small> : null}
        <p className="promotion-fine-print">Copy the code, then enter it manually in checkout preview. Copying it does not apply the offer. One offer per bag.</p>
      </section>
    </div>
  );
}

function BagDrawer({ items, open, appliedPromotionCode, onClose, onQuantity, onCheckout }: {
  items: CartItem[];
  open: boolean;
  appliedPromotionCode?: string;
  onClose: () => void;
  onQuantity: (id: number, delta: number) => void;
  onCheckout: () => void;
}) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = appliedPromotionCode ? promotionSavingsCad(subtotal) : 0;
  return (
    <>
      <button className={`drawer-scrim ${open ? 'visible' : ''}`} aria-label="Close shopping bag" onClick={onClose} tabIndex={open ? 0 : -1} />
      <aside
        className={`bag-drawer ${open ? 'open' : ''}`}
        aria-hidden={!open}
        aria-label="Shopping bag"
        inert={!open}
      >
        <div className="drawer-header"><h2>Your bag</h2><button type="button" onClick={onClose}>Close</button></div>
        {items.length === 0 ? (
          <div className="empty-bag"><p>Your bag is waiting.</p><span>Add a piece or compose a complete look in the Style Studio.</span></div>
        ) : (
          <div className="bag-list">
            {items.map((item) => (
              <div className="bag-line" key={item.id}>
                <ProductVisual product={item} className="bag-product-image" decorative />
                <div><h3>{item.name}</h3><p>{item.color} · {item.category === 'Accessories' ? 'One size' : `Size ${item.size}`}</p><strong>{currency(item.price)}</strong></div>
                <div className="quantity" aria-label={`Quantity for ${item.name}`}>
                  <button type="button" onClick={() => onQuantity(item.id, -1)} aria-label="Decrease quantity">−</button>
                  <span>{item.quantity}</span>
                  <button type="button" onClick={() => onQuantity(item.id, 1)} aria-label="Increase quantity">+</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="drawer-total">
          <div><span>Subtotal</span><strong>{currency(subtotal)}</strong></div>
          {open && appliedPromotionCode ? (
            <div className="promotion-total" aria-live="polite">
              <span>{appliedPromotionCode} · {atelierPromotion.discountPercent}% off</span>
              <strong>−{currency(discount)}</strong>
            </div>
          ) : null}
          {discount ? <div className="grand-total"><span>Estimated total</span><strong>{currency(subtotal - discount)}</strong></div> : null}
          <p>Complimentary delivery and returns.</p>
          <button className="checkout-button" type="button" disabled={!items.length} onClick={onCheckout}>Checkout preview</button>
        </div>
      </aside>
    </>
  );
}

function Checkout({ open, subtotal, discount, onClose, onApplyPromotion }: {
  open: boolean;
  subtotal: number;
  discount: number;
  onClose: () => void;
  onApplyPromotion: (code: string) => Promise<void>;
}) {
  const [complete, setComplete] = useState(false);
  const [promotionInput, setPromotionInput] = useState('');
  const [promotionError, setPromotionError] = useState('');
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setComplete(true);
  };
  const applyPromotion = async () => {
    try {
      await onApplyPromotion(promotionInput);
      setPromotionError('');
    } catch (error) {
      setPromotionError(error instanceof Error ? error.message : 'Unable to apply that promotion.');
    }
  };
  if (!open) return null;
  return (
    <div className="checkout-layer" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
      <div className="checkout-panel">
        <button className="modal-close" type="button" onClick={() => { setComplete(false); onClose(); }}>Close</button>
        {complete ? (
          <div className="confirmation">
            <span className="confirmation-mark">✓</span>
            <h2 id="checkout-title">Demo complete. No payment was collected and no order was placed.</h2>
            <p>Your selections remain in the bag so you can continue exploring the demonstration.</p>
            <button className="checkout-button" type="button" onClick={() => { setComplete(false); onClose(); }}>Continue shopping</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p className="section-index">Checkout preview</p><h2 id="checkout-title">Review your order.</h2>
            {discount ? (
              <div className="checkout-promotion"><span>{atelierPromotion.code} applied</span><strong>−{currency(discount)}</strong></div>
            ) : (
              <div className="checkout-promotion-entry">
                <label htmlFor="checkout-promotion-code">Promotion code
                  <input
                    id="checkout-promotion-code"
                    value={promotionInput}
                    onChange={(event) => setPromotionInput(event.target.value)}
                    placeholder="Paste or enter code"
                    autoComplete="off"
                  />
                </label>
                <button type="button" disabled={!promotionInput.trim()} onClick={() => void applyPromotion()}>Apply code</button>
                {promotionError ? <small role="alert">{promotionError}</small> : null}
              </div>
            )}
            <label>Email<input required type="email" placeholder="you@example.com" /></label>
            <div className="field-row"><label>First name<input required /></label><label>Last name<input required /></label></div>
            <label>Delivery address<input required placeholder="Street and number" /></label>
            <div className="field-row"><label>City<input required /></label><label>Postal code<input required /></label></div>
            <button className="checkout-button" type="submit">Complete checkout demo · {currency(subtotal - discount)}</button>
            <small>Demonstration only — no payment is collected and no order is placed.</small>
          </form>
        )}
      </div>
    </div>
  );
}

export function Boutique({ initialProductId }: { initialProductId?: number } = {}) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [atelierSearch, setAtelierSearch] = useState('');
  const deferredAtelierSearch = useDeferredValue(atelierSearch);
  const [audience, setAudience] = useState<AudienceFilter>('All');
  const [category, setCategory] = useState<CategoryFilter>('All');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [bagOpen, setBagOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [journey, setJourney] = useState<CapsuleJourney>(() => cloneJourney(curatedJourneys.woman));
  const [activeJourneyIndex, setActiveJourneyIndex] = useState(0);
  const [isCapsuleJourney, setIsCapsuleJourney] = useState(false);
  const [manualEditorOpen, setManualEditorOpen] = useState(false);
  const [styleCollection, setStyleCollection] = useState<ModelId | null>(null);
  const [model, setModel] = useState<ModelId>('woman');
  const [selections, setSelections] = useState<StyleSelections>({});
  const [activeStyleSlot, setActiveStyleSlot] = useState<StyleSlot>('Top');
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'ready' | 'error'>('idle');
  const [previewError, setPreviewError] = useState('');
  const [size, setSize] = useState<AtelierSize>('M');
  const [capsuleConstraints, setCapsuleConstraints] = useState<CapsuleConstraints>(() => (
    cloneConstraints(curatedConstraints.woman)
  ));
  const [ownedProductIds, setOwnedProductIds] = useState<number[]>([]);
  const [excludedProductIds, setExcludedProductIds] = useState<number[]>([]);
  const [lockedProductIds, setLockedProductIds] = useState<number[]>([]);
  const [capsuleRevision, setCapsuleRevision] = useState<CapsuleRevision | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [appliedPromotionCode, setAppliedPromotionCode] = useState<string>();
  const activeProduct = initialProductId ? productById.get(initialProductId) : undefined;
  const relatedProducts = useMemo(() => {
    if (!activeProduct) return [];
    const sameCategory = products.filter((product) => (
      product.id !== activeProduct.id
      && product.audience === activeProduct.audience
      && product.category === activeProduct.category
    ));
    const sameAudience = products.filter((product) => (
      product.id !== activeProduct.id
      && product.audience === activeProduct.audience
      && product.category !== activeProduct.category
    ));
    return [...sameCategory, ...sameAudience].slice(0, 4);
  }, [activeProduct]);

  useEffect(() => {
    if (activeProduct) return;
    const restoreCatalogFilters = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const requestedAudience = params.get('audience');
      const requestedCategory = params.get('category');
      const nextAudience = requestedAudience && audienceFilters.has(requestedAudience as AudienceFilter)
        ? requestedAudience as AudienceFilter
        : 'All';
      const nextCategory = requestedCategory && categoryFilters.has(requestedCategory as CategoryFilter)
        ? requestedCategory as CategoryFilter
        : 'All';
      setAudience(nextAudience);
      setCategory(nextCategory);
    }, 0);
    return () => window.clearTimeout(restoreCatalogFilters);
  }, [activeProduct]);

  useEffect(() => {
    const restoreTask = window.setTimeout(() => {
      const savedSession = readPersistedElaneSession();
      if (savedSession) {
        const savedBag = savedSession.bag.flatMap((item) => {
          const product = productById.get(item.productId);
          return product ? [{ ...product, quantity: item.quantity, size: item.size }] : [];
        });
        setStyleCollection(savedSession.styleCollection);
        setModel(savedSession.model);
        setIsCapsuleJourney(savedSession.isCapsuleJourney);
        setActiveJourneyIndex(savedSession.activeJourneyIndex);
        setJourney(cloneJourney(savedSession.journey));
        setSelections(cloneSelections(savedSession.selections));
        setSize(savedSession.size);
        setCapsuleConstraints(cloneConstraints(savedSession.capsuleConstraints));
        setOwnedProductIds([...savedSession.ownedProductIds]);
        setExcludedProductIds([...savedSession.excludedProductIds]);
        setLockedProductIds([...savedSession.lockedProductIds]);
        setCart(savedBag);
        setCapsuleRevision(null);
        setPreviewStatus(selectedProductIds(savedSession.selections).length ? 'ready' : 'idle');
        setPreviewError('');
      }
      setSessionReady(true);
    }, 0);
    return () => window.clearTimeout(restoreTask);
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const session: PersistedElaneSession = {
      version: 1,
      styleCollection,
      model,
      isCapsuleJourney,
      activeJourneyIndex: isCapsuleJourney ? activeJourneyIndex : 0,
      journey: isCapsuleJourney ? cloneJourney(journey) : cloneJourney(curatedJourneys[model]),
      selections: cloneSelections(selections),
      size,
      capsuleConstraints: cloneConstraints(capsuleConstraints),
      ownedProductIds: [...ownedProductIds],
      excludedProductIds: [...excludedProductIds],
      lockedProductIds: isCapsuleJourney ? [...lockedProductIds] : [],
      bag: cart.map((item) => ({
        productId: item.id,
        quantity: item.quantity,
        size: item.size as AtelierSize,
      })),
    };
    try {
      window.localStorage.setItem(elaneSessionStorageKey, JSON.stringify(session));
    } catch (error) {
      console.warn('Unable to save the ÉLANE session on this device.', error);
    }
  }, [
    activeJourneyIndex,
    capsuleConstraints,
    cart,
    excludedProductIds,
    isCapsuleJourney,
    journey,
    lockedProductIds,
    model,
    ownedProductIds,
    selections,
    sessionReady,
    size,
    styleCollection,
  ]);

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';

    const scrollToHash = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - 78);
      document.documentElement.scrollTop = top;
      document.body.scrollTop = top;
    };
    const firstPass = window.setTimeout(scrollToHash, 80);
    const settledPass = window.setTimeout(scrollToHash, 500);
    const hostedPass = window.setTimeout(scrollToHash, 1600);
    window.addEventListener('load', scrollToHash);
    window.addEventListener('hashchange', scrollToHash);
    return () => {
      window.clearTimeout(firstPass);
      window.clearTimeout(settledPass);
      window.clearTimeout(hostedPass);
      window.removeEventListener('load', scrollToHash);
      window.removeEventListener('hashchange', scrollToHash);
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useEffect(() => {
    const overlayOpen = bagOpen || checkoutOpen || mobileNavOpen || promotionOpen;
    document.body.style.overflow = overlayOpen ? 'hidden' : '';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setBagOpen(false);
      setCheckoutOpen(false);
      setMobileNavOpen(false);
      setPromotionOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [bagOpen, checkoutOpen, mobileNavOpen, promotionOpen]);

  const revokePromotionIfIneligible = useCallback((nextCart: CartItem[]) => {
    if (bagSummary(nextCart).subtotalCad < atelierPromotion.minimumSubtotalCad) {
      setAppliedPromotionCode(undefined);
    }
  }, []);

  const selectAudience = useCallback((nextAudience: AudienceFilter) => {
    setAudience(nextAudience);
    setCategory('All');
    setCatalogExpanded(false);
  }, []);

  const availableCategories = useMemo(() => categoryOrderList.filter((item) => (
    products.some((product) => (
      product.category === item && (audience === 'All' || product.audience === audience)
    ))
  )), [audience]);
  const categoryOptions: readonly CategoryFilter[] = ['All', ...availableCategories];

  const visibleProducts = useMemo(() => {
    const eligibleProducts = products.filter((product) =>
      (audience === 'All' || product.audience === audience) &&
      (category === 'All' || product.category === category),
    );
    if (deferredSearch.trim()) return rankProductsBySearch(eligibleProducts, deferredSearch);
    return eligibleProducts.toSorted((left, right) => {
        const audienceDifference = (left.audience === 'Women' ? 0 : 1) - (right.audience === 'Women' ? 0 : 1);
        if (audienceDifference) return audienceDifference;
        const categoryDifference = (categoryOrder.get(left.category) ?? 99) - (categoryOrder.get(right.category) ?? 99);
        return categoryDifference || left.id - right.id;
      });
  }, [audience, category, deferredSearch]);
  const catalogIsUpdating = search !== deferredSearch;
  const catalogIsFiltered = audience !== 'All' || category !== 'All' || deferredSearch.trim().length > 0;
  const displayedProducts = catalogExpanded || catalogIsFiltered ? visibleProducts : visibleProducts.slice(0, 8);

  const addProduct = useCallback((product: Product, chosenSize = size, reveal = true) => {
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      return existing
        ? current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1, size: chosenSize } : item)
        : [...current, { ...product, quantity: 1, size: chosenSize }];
    });
    if (reveal) setBagOpen(true);
  }, [size]);

  const composeLook = useCallback(async (nextModel: ModelId, nextSelections: StyleSelections): Promise<PreviewCompositionResult> => {
    const pieces = selectedProducts(nextSelections);
    if (!pieces.length) {
      setPreviewStatus('idle');
      setPreviewError('');
      return { status: 'idle' };
    }

    const expectedAudience = nextModel === 'woman' ? 'Women' : 'Men';
    if (pieces.some((product) => product.audience !== expectedAudience)) {
      const message = `Choose ${expectedAudience.toLowerCase()} pieces for this garment board.`;
      setPreviewStatus('error');
      setPreviewError(message);
      return { status: 'error', message };
    }

    setPreviewStatus('ready');
    setPreviewError('');
    return { status: 'composed' };
  }, []);

  const focusAtelier = useCallback(async () => {
    const drawerWasOpen = bagOpen;
    setBagOpen(false);
    await nextFrame();
    if (drawerWasOpen) {
      await waitForTransitionEnd(document.querySelector('.bag-drawer'), 400);
    }
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    document.getElementById('atelier')?.scrollIntoView({ block: 'start' });
    await nextFrame();
    root.style.scrollBehavior = previousScrollBehavior;
  }, [bagOpen]);

  const navigateToAtelier = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    setMobileNavOpen(false);
    if (activeProduct) return;
    event.preventDefault();
    if (window.location.hash !== '#atelier') {
      window.history.pushState(null, '', '#atelier');
    }
    void focusAtelier();
  }, [activeProduct, focusAtelier]);

  const showToolLook = useCallback(async (look: ValidatedToolLook) => {
    setStyleCollection(look.model);
    setModel(look.model);
    setSelections(look.selections);
    setActiveStyleSlot(slotForProduct(look.pieces[look.pieces.length - 1]));
    setPreviewStatus('ready');
    setPreviewError('');
    await focusAtelier();
    const result = await composeLook(look.model, look.selections);
    await nextFrame();
    return result;
  }, [composeLook, focusAtelier]);

  const composeFromWebMCP = useCallback(async (rawInput: unknown): Promise<AtelierToolResult> => {
    const look = validateToolLook(rawInput);
    setIsCapsuleJourney(false);
    const result = await showToolLook(look);
    const selectedPieces = look.pieces.map((product) => ({
      id: product.id,
      name: product.name,
      color: product.color,
      slot: slotForProduct(product),
      priceCad: product.price,
    }));

    if (result.status === 'composed') {
      return {
        status: 'composed',
        model: look.model,
        size,
        presentationMode: 'single-look',
        selectedPieces,
        previewVisible: true,
        bagChange: 'none',
        nextStep: 'Use an incremental look-item tool to refine the visible look, or add_look_to_bag only after the user chooses it.',
        message: 'The selected pieces are visible as a garment-only editorial board in the Style Studio.',
      };
    }

    return {
      status: 'error',
      model: look.model,
      size,
      presentationMode: 'single-look',
      selectedPieces,
      previewVisible: true,
      bagChange: 'none',
      nextStep: 'Read the catalog again and stage a compatible look.',
      message: result.message ?? 'The garment board could not be composed.',
    };
  }, [showToolLook, size]);

  const readAtelierFromWebMCP = useCallback((rawInput: unknown) => {
    if (rawInput !== undefined && (
      !rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)
    )) {
      throw new Error('Expected an optional catalog query object.');
    }
    const input = (rawInput ?? {}) as Record<string, unknown>;
    const allowedKeys = new Set(['view', 'model', 'offset', 'limit']);
    const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
    if (unknownKey) throw new Error(`Unknown catalog read field: ${unknownKey}.`);
    const hasPagination = input.offset !== undefined || input.limit !== undefined;
    const view = input.view ?? (hasPagination ? 'products' : 'overview');
    if (view !== 'overview' && view !== 'products') {
      throw new Error('view must be either "overview" or "products".');
    }
    if (input.view === 'overview' && hasPagination) {
      throw new Error('offset and limit are supported only for the products view.');
    }
    const requestedModel = input.model;
    if (requestedModel !== undefined && requestedModel !== 'woman' && requestedModel !== 'man') {
      throw new Error('model must be either "woman" or "man" when supplied.');
    }
    const requestedAudience = requestedModel === 'woman'
      ? 'Women'
      : requestedModel === 'man' ? 'Men' : undefined;
    const readyProducts = products.filter((product) => (
      !requestedAudience || product.audience === requestedAudience
    ));

    if (view === 'overview') {
      const prices = readyProducts.map((product) => product.price);
      return {
        status: 'ready',
        view,
        currency: 'CAD',
        scope: { model: requestedModel ?? 'all' },
        totalCount: readyProducts.length,
        facets: {
          audiences: ['Women', 'Men'].map((audience) => ({
            audience,
            count: readyProducts.filter((product) => product.audience === audience).length,
          })).filter(({ count }) => count > 0),
          slots: styleSlots.map((slot) => ({
            slot,
            count: readyProducts.filter((product) => slotForProduct(product) === slot).length,
          })).filter(({ count }) => count > 0),
          priceCad: { minimum: Math.min(...prices), maximum: Math.max(...prices) },
        },
        rules: {
          dress: 'Do not combine a dress with a top or bottom.',
          audience: 'All pieces must match the selected collection.',
          budget: 'Capsule budgets count each distinct piece once.',
          accessories: 'Up to four per look.',
        },
        routing: {
          ordinaryDiscovery: 'Use search_catalog with model, slot, and maximum price filters.',
          exhaustiveDiscovery: 'Use read_catalog with view products and follow page.nextOffset until null.',
        },
      };
    }

    const { offset, limit } = validatePaginationInput(input, WEBMCP_CATALOG_PAGE_LIMIT);

    return {
      status: 'ready',
      view,
      currency: 'CAD',
      page: pageForWebMcp(readyProducts.map((product) => ({
        id: product.id,
        name: product.name,
        audience: product.audience,
        slot: slotForProduct(product),
        category: product.category,
        color: product.color,
        priceCad: product.price,
      })), offset, limit),
    };
  }, []);

  const readAtelierStateFromWebMCP = useCallback((rawInput: unknown) => {
    if (rawInput !== undefined && (
      !rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)
    )) {
      throw new Error('Expected an optional atelier state query object.');
    }
    const input = (rawInput ?? {}) as Record<string, unknown>;
    const allowedKeys = new Set(['view', 'lookIndex', 'offset', 'limit']);
    const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
    if (unknownKey) throw new Error(`Unknown atelier state field: ${unknownKey}.`);
    const view = input.view ?? 'summary';
    const views = ['summary', 'look', 'constraints', 'owned', 'excluded', 'locked'];
    if (!views.includes(view as string)) {
      throw new Error(`view must be one of: ${views.join(', ')}.`);
    }
    const listView = view === 'owned' || view === 'excluded' || view === 'locked';
    if (!listView && (input.offset !== undefined || input.limit !== undefined)) {
      throw new Error('offset and limit are supported only for owned, excluded, or locked views.');
    }
    if (view !== 'look' && input.lookIndex !== undefined) {
      throw new Error('lookIndex is supported only for the look view.');
    }

    const common = {
      status: 'ready',
      view,
      model: styleCollection ? model : null,
      size,
      presentationMode: isCapsuleJourney ? 'capsule' : 'single-look',
    };

    if (view === 'summary') {
      return {
        ...common,
        activeJourneyLook: isCapsuleJourney ? activeJourneyIndex : null,
        selectedProductIds: selectedProductIds(selections),
        journey: isCapsuleJourney ? {
          title: journey.title,
          budgetCad: journey.budgetCad ?? null,
          lookCount: journey.looks.length,
          metrics: calculateCapsuleMetrics(journey, ownedProductIds),
          ownedCount: ownedProductIds.length,
          excludedCount: excludedProductIds.length,
          lockedCount: lockedProductIds.length,
        } : null,
      };
    }

    if (view === 'look') {
      const lookIndex = input.lookIndex ?? (isCapsuleJourney ? activeJourneyIndex : 0);
      if (!Number.isInteger(lookIndex) || (lookIndex as number) < 0) {
        throw new Error('lookIndex must be a non-negative integer.');
      }
      if (!isCapsuleJourney && lookIndex !== 0) {
        throw new Error('A single look is active; use lookIndex 0.');
      }
      const look = isCapsuleJourney ? journey.looks[lookIndex as number] : null;
      if (isCapsuleJourney && !look) {
        throw new Error(`lookIndex must be between 0 and ${journey.looks.length - 1}.`);
      }
      return {
        ...common,
        look: isCapsuleJourney ? {
          index: lookIndex,
          name: look!.name,
          moment: look!.moment,
          stylingNote: look!.stylingNote,
          productIds: selectedProductIds(look!.selections),
          isActive: lookIndex === activeJourneyIndex,
        } : {
          index: 0,
          name: lookName(selections),
          productIds: selectedProductIds(selections),
          isActive: true,
        },
      };
    }

    if (view === 'constraints') {
      return {
        ...common,
        constraints: {
          budgetCad: isCapsuleJourney ? journey.budgetCad ?? null : null,
          size,
          climate: capsuleConstraints.climate,
          dressCode: capsuleConstraints.dressCode,
          preferredColors: capsuleConstraints.preferredColors,
          excludedColors: capsuleConstraints.excludedColors,
        },
      };
    }

    const { offset, limit } = validatePaginationInput(input, WEBMCP_STATE_LIST_PAGE_LIMIT);
    const ids = view === 'owned'
      ? ownedProductIds
      : view === 'excluded' ? excludedProductIds : lockedProductIds;
    return {
      ...common,
      page: pageForWebMcp(ids.map((id) => ({
        productId: id,
        name: productById.get(id)?.name ?? `Product ${id}`,
      })), offset, limit),
    };
  }, [activeJourneyIndex, capsuleConstraints, excludedProductIds, isCapsuleJourney, journey, lockedProductIds, model, ownedProductIds, selections, size, styleCollection]);

  const searchAtelierFromWebMCP = useCallback((rawInput: unknown) => {
    if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
      throw new Error('Expected a product search object.');
    }
    const input = rawInput as {
      query?: unknown;
      model?: unknown;
      slot?: unknown;
      maxPriceCad?: unknown;
      offset?: unknown;
      limit?: unknown;
    };
    const allowedKeys = new Set(['query', 'model', 'slot', 'maxPriceCad', 'offset', 'limit']);
    const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
    if (unknownKey) throw new Error(`Unknown product search field: ${unknownKey}.`);
    if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 80) {
      throw new Error('query must be a non-empty string of 80 characters or fewer.');
    }
    if (input.model !== undefined && input.model !== 'woman' && input.model !== 'man') {
      throw new Error('model must be either "woman" or "man" when supplied.');
    }
    if (input.slot !== undefined && !styleSlots.includes(input.slot as StyleSlot)) {
      throw new Error(`slot must be one of: ${styleSlots.join(', ')}.`);
    }
    if (input.maxPriceCad !== undefined && (
      typeof input.maxPriceCad !== 'number'
      || !Number.isInteger(input.maxPriceCad)
      || input.maxPriceCad < 1
      || input.maxPriceCad > 10000
    )) {
      throw new Error('maxPriceCad must be a whole number between 1 and 10,000 when supplied.');
    }
    const { offset, limit } = validatePaginationInput(
      input as Record<string, unknown>,
      WEBMCP_SEARCH_PAGE_LIMIT,
    );

    const requestedAudience = input.model === 'woman'
      ? 'Women'
      : input.model === 'man' ? 'Men' : undefined;
    const requestedSlot = input.slot as StyleSlot | undefined;
    const maxPriceCad = input.maxPriceCad as number | undefined;
    const eligibleProducts = products.filter((product) => (
      (!requestedAudience || product.audience === requestedAudience)
      && (!requestedSlot || slotForProduct(product) === requestedSlot)
      && (maxPriceCad === undefined || product.price <= maxPriceCad)
    ));
    const query = input.query as string;
    const matches = rankProductsBySearch(eligibleProducts, query);

    return {
      status: 'ready',
      query: query.trim(),
      normalizedTerms: normalizeProductSearchTerms(query),
      filters: {
        model: input.model ?? null,
        slot: requestedSlot ?? null,
        maxPriceCad: input.maxPriceCad ?? null,
      },
      page: pageForWebMcp(matches.map((product) => ({
        id: product.id,
        name: product.name,
        audience: product.audience,
        slot: slotForProduct(product),
        category: product.category,
        color: product.color,
        priceCad: product.price,
        relevanceScore: productSearchScore(product, query) ?? 0,
      })), offset, limit),
      nextStep: matches.length
        ? 'Continue with page.nextOffset or use returned IDs in a staging tool.'
        : 'Try a broader style, colour, garment type, or a higher maximum price.',
    };
  }, []);

  const stageJourneyFromWebMCP = useCallback(async (rawInput: unknown) => {
    const nextJourney = validateCapsuleJourney(rawInput);
    const firstLook = nextJourney.looks[0];
    const pieces = selectedProducts(firstLook.selections);
    setJourney(nextJourney);
    setActiveJourneyIndex(0);
    setIsCapsuleJourney(true);
    setManualEditorOpen(false);
    setCapsuleConstraints({
      climate: 'Not specified',
      dressCode: 'Occasion-specific',
      preferredColors: [],
      excludedColors: [],
    });
    setOwnedProductIds([]);
    setExcludedProductIds([]);
    setLockedProductIds([]);
    setCapsuleRevision(null);
    const result = await showToolLook({
      model: nextJourney.model,
      selections: firstLook.selections,
      pieces,
    });
    const usage = new Map<number, number>();
    nextJourney.looks.forEach((look) => {
      selectedProductIds(look.selections).forEach((id) => usage.set(id, (usage.get(id) ?? 0) + 1));
    });
    const capsuleValueCad = Array.from(usage.keys()).reduce(
      (sum, id) => sum + (productById.get(id)?.price ?? 0),
      0,
    );

    return {
      status: result.status === 'composed' ? 'staged' : 'error',
      model: nextJourney.model,
      presentationMode: 'capsule',
      title: nextJourney.title,
      lookCount: nextJourney.looks.length,
      uniquePieceCount: usage.size,
      reusedPieceCount: Array.from(usage.values()).filter((count) => count > 1).length,
      capsuleValueCad,
      budgetCad: nextJourney.budgetCad,
      activeLookIndex: 0,
      looks: nextJourney.looks.map((look, index) => ({
        index,
        name: look.name,
        moment: look.moment,
        productIds: selectedProductIds(look.selections),
      })),
      previewVisible: true,
      bagChange: 'none',
      nextStep: 'Use replan_capsule if the brief changes, or add_look_to_bag when the user chooses a look to buy.',
      message: result.status === 'composed'
        ? 'The capsule journey and its first garment board are visible in the Style Studio.'
        : result.message ?? 'The capsule journey could not be staged.',
    };
  }, [showToolLook]);

  const replanCapsuleFromWebMCP = useCallback(async (rawInput: unknown) => {
    if (!isCapsuleJourney) {
      throw new Error('Create or stage a capsule journey before using Lock and Replan.');
    }
    const validated = validateCapsuleReplan(
      rawInput,
      journey,
      capsuleConstraints,
      size,
      ownedProductIds,
      excludedProductIds,
      lockedProductIds,
    );
    const beforeMetrics = calculateCapsuleMetrics(journey, ownedProductIds);
    const nextRevision: CapsuleRevision = {
      note: validated.revisionNote,
      preservedProductIds: validated.preservedProductIds,
      removedProductIds: validated.removedProductIds,
      addedProductIds: validated.addedProductIds,
      reasons: validated.reasons,
      beforeMetrics,
      afterMetrics: validated.metrics,
      beforeBudgetCad: journey.budgetCad,
      afterBudgetCad: validated.nextJourney.budgetCad,
    };
    const firstLook = validated.nextJourney.looks[0];
    const pieces = selectedProducts(firstLook.selections);
    setJourney(validated.nextJourney);
    setCapsuleConstraints(validated.nextConstraints);
    setSize(validated.nextSize);
    setOwnedProductIds(validated.ownedProductIds);
    setExcludedProductIds(validated.excludedProductIds);
    setLockedProductIds(validated.lockedProductIds);
    setCapsuleRevision(nextRevision);
    setActiveJourneyIndex(0);
    setManualEditorOpen(false);
    const result = await showToolLook({
      model: validated.nextJourney.model,
      selections: firstLook.selections,
      pieces,
    });

    return {
      status: result.status === 'composed' ? 'replanned' : 'error',
      model: validated.nextJourney.model,
      title: validated.nextJourney.title,
      revisionNote: validated.revisionNote,
      changes: {
        preservedCount: validated.preservedProductIds.length,
        removedProductIds: validated.removedProductIds,
        addedProductIds: validated.addedProductIds,
        lockedCount: validated.lockedProductIds.length,
        ownedCount: validated.ownedProductIds.length,
        excludedCount: validated.excludedProductIds.length,
      },
      metrics: validated.metrics,
      budgetDifferenceCad: validated.nextJourney.budgetCad !== undefined && journey.budgetCad !== undefined
        ? validated.nextJourney.budgetCad - journey.budgetCad
        : null,
      spendDifferenceCad: validated.metrics.totalSpendCad - beforeMetrics.totalSpendCad,
      reuseDifference: validated.metrics.reusedPieceCount - beforeMetrics.reusedPieceCount,
      bagChange: 'none',
      previewVisible: true,
      nextStep: 'Review the visible revision; read a state view for details before adding a chosen look.',
      message: result.status === 'composed'
        ? 'The unlocked capsule pieces were replanned and the before/after revision is visible. Locked pieces and the shopping bag were preserved.'
        : result.message ?? 'The capsule revision could not be shown.',
    };
  }, [capsuleConstraints, excludedProductIds, isCapsuleJourney, journey, lockedProductIds, ownedProductIds, showToolLook, size]);

  const setAtelierSizeFromWebMCP = useCallback(async (rawInput: unknown) => {
    const selectedSize = validateAtelierSizeInput(rawInput);
    const previousSize = size;
    setSize(selectedSize);
    setManualEditorOpen(true);
    await focusAtelier();

    return {
      status: previousSize === selectedSize ? 'unchanged' : 'updated',
      previousSize,
      size: selectedSize,
      bagChange: 'none',
      message: `The Style Studio size is set to ${selectedSize}. The shopping bag was not changed.`,
    };
  }, [focusAtelier, size]);

  const readShoppingBagFromWebMCP = useCallback((rawInput: unknown) => {
    if (rawInput !== undefined && (
      !rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)
    )) {
      throw new Error('Expected an optional bag pagination object.');
    }
    const input = (rawInput ?? {}) as Record<string, unknown>;
    const allowedKeys = new Set(['offset', 'limit']);
    const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
    if (unknownKey) throw new Error(`Unknown bag read field: ${unknownKey}.`);
    const { offset, limit } = validatePaginationInput(input, WEBMCP_BAG_PAGE_LIMIT);
    const subtotalCad = bagSummary(cart).subtotalCad;
    const applicationState = promotionApplicationState(subtotalCad, appliedPromotionCode);
    const discountCad = applicationState === 'applied' ? promotionSavingsCad(subtotalCad) : 0;
    return {
      status: 'ready',
      bag: {
        ...bagSummary(cart),
        appliedPromotionCode: applicationState === 'applied' ? appliedPromotionCode : null,
        discountCad,
        estimatedTotalCad: subtotalCad - discountCad,
      },
      page: pageForWebMcp(cart.map(bagLine), offset, limit),
      nextStep: cart.length
        ? 'Continue with page.nextOffset, configure a line, or stop before another shopping action.'
        : 'The bag is empty. Stage a look or select one catalog item before adding anything.',
    };
  }, [appliedPromotionCode, cart]);

  const readPromotionsFromWebMCP = useCallback((rawInput: unknown) => {
    if (rawInput !== undefined && (
      !rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput) || Object.keys(rawInput).length
    )) {
      throw new Error('read_promotions accepts only an empty object.');
    }
    const subtotalCad = bagSummary(cart).subtotalCad;
    const eligible = subtotalCad >= atelierPromotion.minimumSubtotalCad;
    const estimatedSavingsCad = promotionSavingsCad(subtotalCad);
    const applicationState = promotionApplicationState(subtotalCad, appliedPromotionCode);
    return {
      status: 'ready',
      currency: atelierPromotion.currency,
      promotions: [{
        ...atelierPromotion,
        exclusions: [...atelierPromotion.exclusions],
        currentBag: {
          subtotalCad,
          eligible,
          amountNeededCad: Math.max(0, atelierPromotion.minimumSubtotalCad - subtotalCad),
          estimatedSavingsCad,
          estimatedTotalCad: subtotalCad - estimatedSavingsCad,
          applied: applicationState === 'applied',
        },
      }],
      nextStep: eligible
        ? 'Ask the user before calling apply_promotion with the selected code.'
        : 'The current bag does not yet meet the minimum spend. Do not apply the code until it qualifies.',
    };
  }, [appliedPromotionCode, cart]);

  const applyPromotionFromWebMCP = useCallback(async (rawInput: unknown, showBag = true) => {
    if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
      throw new Error('Expected an object containing a promotion code.');
    }
    const input = rawInput as Record<string, unknown>;
    if (Object.keys(input).length !== 1 || typeof input.code !== 'string') {
      throw new Error('Only a string code is supported when applying a promotion.');
    }
    const code = input.code.trim().toUpperCase();
    if (code !== atelierPromotion.code) throw new Error(`Promotion code ${code || '(empty)'} is not available.`);
    const subtotalCad = bagSummary(cart).subtotalCad;
    if (subtotalCad < atelierPromotion.minimumSubtotalCad) {
      throw new Error(`${atelierPromotion.code} requires a subtotal of ${currency(atelierPromotion.minimumSubtotalCad)}. Add ${currency(atelierPromotion.minimumSubtotalCad - subtotalCad)} more before applying it.`);
    }
    const discountCad = promotionSavingsCad(subtotalCad);
    const unchanged = appliedPromotionCode === code;
    setAppliedPromotionCode(code);
    if (showBag) {
      setBagOpen(true);
      await nextFrame();
    }
    return {
      status: unchanged ? 'unchanged' : 'applied',
      code,
      subtotalCad,
      discountCad,
      estimatedTotalCad: subtotalCad - discountCad,
      checkoutStarted: false,
      message: showBag
        ? `${code} is applied to the visible shopping bag. No checkout or payment was started.`
        : `${code} is applied in checkout preview. No checkout, order, or payment was completed.`,
    };
  }, [appliedPromotionCode, cart]);

  const applyPromotionFromCheckout = useCallback(async (code: string) => {
    await applyPromotionFromWebMCP({ code }, false);
  }, [applyPromotionFromWebMCP]);

  const addCatalogItemToBagFromWebMCP = useCallback(async (rawInput: unknown) => {
    const input = validateAddCatalogItemToBagInput(rawInput);
    const product = productById.get(input.productId);
    if (!product) throw new Error(`Product ${input.productId} is not in the ÉLANE catalog.`);

    const existingItem = cart.find((item) => item.id === product.id);
    if (existingItem && input.size && input.size !== existingItem.size) {
      throw new Error(`${product.name} is already in the shopping bag in size ${existingItem.size}. Use set_bag_item_size before increasing its quantity.`);
    }
    const chosenSize = input.size ?? existingItem?.size ?? size;
    const nextCart = existingItem
      ? cart.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1, size: chosenSize } : item)
      : [...cart, { ...product, quantity: 1, size: chosenSize }];
    const nextItem = nextCart.find((item) => item.id === product.id)!;
    setCart(nextCart);
    setBagOpen(true);
    await nextFrame();

    return {
      status: 'added',
      addedItem: {
        productId: nextItem.id,
        name: nextItem.name,
        color: nextItem.color,
        size: nextItem.size,
        quantity: nextItem.quantity,
        unitPriceCad: nextItem.price,
        lineTotalCad: nextItem.price * nextItem.quantity,
      },
      bag: bagSummary(nextCart),
      bagVisible: true,
      nextStep: 'Use read_bag to verify the final bag before presenting checkout as an optional demonstration.',
      message: existingItem
        ? `${product.name} quantity increased to ${nextItem.quantity} in the shopping bag.`
        : `${product.name} was added to the shopping bag in size ${chosenSize}.`,
    };
  }, [cart, size]);

  const adjustBagItemQuantityFromWebMCP = useCallback(async (rawInput: unknown) => {
    const { productId, delta } = validateBagQuantityAdjustmentInput(rawInput);
    const currentItem = cart.find((item) => item.id === productId);
    if (!currentItem) throw new Error(`Product ${productId} is not in the shopping bag.`);

    const nextQuantity = currentItem.quantity + delta;
    const nextCart = nextQuantity > 0
      ? cart.map((item) => item.id === productId ? { ...item, quantity: nextQuantity } : item)
      : cart.filter((item) => item.id !== productId);
    setCart(nextCart);
    revokePromotionIfIneligible(nextCart);
    setBagOpen(true);
    await nextFrame();

    return {
      status: nextQuantity > 0 ? 'updated' : 'removed',
      productId,
      product: currentItem.name,
      previousQuantity: currentItem.quantity,
      quantityDelta: delta,
      quantity: Math.max(0, nextQuantity),
      productLineRemoved: nextQuantity === 0,
      bag: bagSummary(nextCart),
      bagVisible: true,
      nextStep: 'Use read_bag to verify the complete post-action bag.',
      message: nextQuantity > 0
        ? `${currentItem.name} quantity is now ${nextQuantity}.`
        : `${currentItem.name} was removed because its quantity reached zero.`,
    };
  }, [cart, revokePromotionIfIneligible]);

  const setBagItemSizeFromWebMCP = useCallback(async (rawInput: unknown) => {
    const { productId, size: nextSize } = validateSetBagItemSizeInput(rawInput);
    const currentItem = cart.find((item) => item.id === productId);
    if (!currentItem) throw new Error(`Product ${productId} is not in the shopping bag.`);

    const nextCart = cart.map((item) => item.id === productId ? { ...item, size: nextSize } : item);
    setCart(nextCart);
    setBagOpen(true);
    await nextFrame();

    return {
      status: currentItem.size === nextSize ? 'unchanged' : 'updated',
      productId,
      product: currentItem.name,
      previousSize: currentItem.size,
      size: nextSize,
      quantity: currentItem.quantity,
      bag: bagSummary(nextCart),
      bagVisible: true,
      nextStep: 'Use read_bag to verify the complete post-action bag.',
      message: currentItem.size === nextSize
        ? `${currentItem.name} was already size ${nextSize}.`
        : `${currentItem.name} size changed from ${currentItem.size} to ${nextSize}.`,
    };
  }, [cart]);

  const removeBagItemsFromWebMCP = useCallback(async (rawInput: unknown) => {
    const productIds = validateBagRemovalInput(rawInput);
    const requestedIds = new Set(productIds);
    const removedItems = cart.filter((item) => requestedIds.has(item.id));
    const remainingItems = cart.filter((item) => !requestedIds.has(item.id));
    setCart(remainingItems);
    revokePromotionIfIneligible(remainingItems);
    setBagOpen(true);
    await nextFrame();

    return {
      status: removedItems.length ? 'removed' : 'unchanged',
      removedProductIds: removedItems.map((item) => item.id),
      missingProductIds: productIds.filter((id) => !removedItems.some((item) => item.id === id)),
      bag: bagSummary(remainingItems),
      bagVisible: true,
      nextStep: 'Use read_bag to verify the complete post-action bag.',
      message: removedItems.length
        ? `${removedItems.length} product line${removedItems.length === 1 ? '' : 's'} were removed from the shopping bag.`
        : 'No matching product lines were in the shopping bag.',
    };
  }, [cart, revokePromotionIfIneligible]);

  const clearShoppingBagFromWebMCP = useCallback(async (rawInput: unknown) => {
    validateEmptyToolInput(rawInput, 'Clearing the shopping bag');
    const previousBag = bagSummary(cart);
    setCart([]);
    revokePromotionIfIneligible([]);
    setBagOpen(true);
    await nextFrame();

    return {
      status: previousBag.itemCount ? 'cleared' : 'unchanged',
      clearedItemCount: previousBag.itemCount,
      clearedSubtotalCad: previousBag.subtotalCad,
      bag: bagSummary([]),
      bagVisible: true,
      nextStep: 'The bag is empty; do not add anything else unless the user asks.',
      message: previousBag.itemCount
        ? 'The shopping bag is now empty.'
        : 'The shopping bag was already empty.',
    };
  }, [cart, revokePromotionIfIneligible]);

  const addStagedLookFromWebMCP = useCallback(async (rawInput: unknown) => {
    if (rawInput !== undefined && (
      !rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)
    )) {
      throw new Error('Expected an optional look index and size.');
    }
    const input = (rawInput ?? {}) as AddStagedLookInput;
    const allowedKeys = new Set(['lookIndex', 'size']);
    const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
    if (unknownKey) throw new Error(`Unknown add-to-bag field: ${unknownKey}.`);
    const lookIndex = isCapsuleJourney ? (input.lookIndex ?? activeJourneyIndex) : 0;
    if (!isCapsuleJourney && input.lookIndex !== undefined && input.lookIndex !== 0) {
      throw new Error('A single staged look is active. Use lookIndex 0 or create a capsule journey first.');
    }
    if (!Number.isInteger(lookIndex) || lookIndex < 0 || (isCapsuleJourney && lookIndex >= journey.looks.length)) {
      throw new Error(`lookIndex must be between 0 and ${journey.looks.length - 1}.`);
    }
    const allowedSizes = ['XS', 'S', 'M', 'L', 'XL'];
    if (input.size !== undefined && !allowedSizes.includes(input.size)) {
      throw new Error('size must be XS, S, M, L, or XL.');
    }
    const chosenSize = input.size ?? size;
    const look = isCapsuleJourney
      ? journey.looks[lookIndex]
      : { name: lookName(selections), selections: cloneSelections(selections) };
    const pieces = selectedProducts(look.selections);
    if (!pieces.length) throw new Error('The selected look has no garment-board pieces.');
    const piecesToBuy = productsToBuyForLook(pieces, isCapsuleJourney, ownedProductIds);
    const skippedOwnedPieces = pieces.filter((product) => !piecesToBuy.some((candidate) => candidate.id === product.id));

    if (isCapsuleJourney) setActiveJourneyIndex(lookIndex);
    setSize(chosenSize);
    await showToolLook({ model: isCapsuleJourney ? journey.model : model, selections: look.selections, pieces });
    const nextCart = piecesToBuy.reduce<CartItem[]>((current, product) => {
      const existing = current.find((item) => item.id === product.id);
      return existing
        ? current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, { ...product, quantity: 1, size: chosenSize }];
    }, cart);
    if (piecesToBuy.length) setCart(nextCart);
    if (piecesToBuy.length) {
      setBagOpen(true);
      await nextFrame();
    }

    const catalogValueCad = pieces.reduce((sum, product) => sum + product.price, 0);
    const newSpendCad = piecesToBuy.reduce((sum, product) => sum + product.price, 0);

    return {
      status: piecesToBuy.length ? 'added' : 'already-owned',
      lookIndex,
      lookName: look.name,
      size: chosenSize,
      addedProductIds: piecesToBuy.map((product) => product.id),
      skippedOwnedProductIds: skippedOwnedPieces.map((product) => product.id),
      catalogValueCad,
      newSpendCad,
      bag: bagSummary(nextCart),
      bagVisible: piecesToBuy.length > 0,
      nextStep: piecesToBuy.length
        ? 'Read the paginated bag to verify it before offering the checkout demonstration.'
        : 'The bag was not changed because every selected capsule piece is marked owned.',
      message: piecesToBuy.length
        ? (skippedOwnedPieces.length
          ? `${piecesToBuy.length} piece${piecesToBuy.length === 1 ? '' : 's'} to buy from ${look.name} ${piecesToBuy.length === 1 ? 'was' : 'were'} added to the visible shopping bag; ${skippedOwnedPieces.length} owned piece${skippedOwnedPieces.length === 1 ? '' : 's'} ${skippedOwnedPieces.length === 1 ? 'was' : 'were'} skipped. Checkout remains a demonstration.`
          : `${look.name} was added to the visible shopping bag. Checkout remains a demonstration.`)
        : `Every piece in ${look.name} is marked owned, so the shopping bag was not changed.`,
    };
  }, [activeJourneyIndex, cart, isCapsuleJourney, journey, model, ownedProductIds, selections, showToolLook, size]);

  const selectJourneyLook = useCallback((index: number) => {
    const look = journey.looks[index];
    if (!look) return;
    const pieces = selectedProducts(look.selections);
    setActiveJourneyIndex(index);
    void showToolLook({ model: journey.model, selections: look.selections, pieces });
  }, [journey, showToolLook]);

  const updateActiveJourneySelections = useCallback((
    nextModel: ModelId,
    nextSelections: StyleSelections,
  ) => {
    setCapsuleRevision(null);
    setJourney((current) => {
      const base = current.model === nextModel ? current : cloneJourney(curatedJourneys[nextModel]);
      const lookIndex = current.model === nextModel
        ? Math.min(activeJourneyIndex, base.looks.length - 1)
        : 0;
      return {
        ...base,
        looks: base.looks.map((look, index) => (
          index === lookIndex ? { ...look, selections: cloneSelections(nextSelections) } : look
        )),
      };
    });
  }, [activeJourneyIndex]);

  const addStagedItemFromWebMCP = useCallback(async (rawInput: unknown) => {
    const { productId } = validateStagedItemMutationInput(rawInput, false) as AddStagedItemInput;
    const product = productById.get(productId);
    if (!product) throw new Error(`Product ${productId} is not in the ÉLANE catalog.`);
    const nextModel: ModelId = styleCollection ?? (product.audience === 'Women' ? 'woman' : 'man');
    const expectedAudience = nextModel === 'woman' ? 'Women' : 'Men';
    if (product.audience !== expectedAudience) {
      throw new Error(`${product.name} is a ${product.audience.toLowerCase()} product and cannot be added to the active ${expectedAudience.toLowerCase()} collection.`);
    }
    if (selectionIncludes(selections, product)) {
      throw new Error(`${product.name} is already in the currently visible staged look.`);
    }
    if (excludedProductIds.includes(product.id)) {
      throw new Error(`${product.name} is excluded from this capsule. Remove the exclusion before staging it.`);
    }

    const slot = slotForProduct(product);
    if (slot === 'Accessory') {
      if ((selections.Accessory ?? []).length >= 4) {
        throw new Error('The staged look already has four accessories. Remove or replace one before adding another.');
      }
    } else if (slotHasSelection(selections, slot)) {
      throw new Error(`The staged look already has a ${slot.toLowerCase()}. Use replace_look_item to change it.`);
    }
    if (slot === 'Dress' && (slotHasSelection(selections, 'Top') || slotHasSelection(selections, 'Bottom'))) {
      throw new Error('Remove the staged top and bottom before adding a dress.');
    }
    if ((slot === 'Top' || slot === 'Bottom') && slotHasSelection(selections, 'Dress')) {
      throw new Error(`Remove the staged dress before adding a ${slot.toLowerCase()}.`);
    }

    const nextSelections = addProductToSelections(styleCollection ? selections : {}, product);
    setStyleCollection(nextModel);
    setModel(nextModel);
    setSelections(nextSelections);
    if (isCapsuleJourney) updateActiveJourneySelections(nextModel, nextSelections);
    setActiveStyleSlot(slot);
    setManualEditorOpen(true);
    const result = await composeLook(nextModel, nextSelections);
    await focusAtelier();

    return {
      status: 'added',
      model: nextModel,
      presentationMode: isCapsuleJourney ? 'capsule' : 'single-look',
      activeJourneyLook: isCapsuleJourney ? activeJourneyIndex : null,
      addedItem: {
        id: product.id,
        name: product.name,
        color: product.color,
        slot,
        priceCad: product.price,
      },
      ...stagedLookSnapshot(nextSelections),
      previewStatus: result.status,
      bagChange: 'none',
      message: `${product.name} was added to the visible staged look. The shopping bag was not changed.`,
    };
  }, [activeJourneyIndex, composeLook, excludedProductIds, focusAtelier, isCapsuleJourney, selections, styleCollection, updateActiveJourneySelections]);

  const removeStagedItemFromWebMCP = useCallback(async (rawInput: unknown) => {
    const { productId } = validateStagedItemMutationInput(rawInput, false);
    const product = productById.get(productId);
    if (!product || !selectionIncludes(selections, product)) {
      throw new Error(`Product ${productId} is not in the currently visible staged look.`);
    }
    if (isCapsuleJourney && lockedProductIds.includes(product.id)) {
      throw new Error(`${product.name} is locked. Unlock it before removing it from the capsule.`);
    }

    const nextSelections = removeProductFromSelections(selections, product);
    setSelections(nextSelections);
    if (isCapsuleJourney) updateActiveJourneySelections(model, nextSelections);
    setActiveStyleSlot(slotForProduct(product));
    const result = await composeLook(model, nextSelections);
    await focusAtelier();

    return {
      status: 'removed',
      model,
      presentationMode: isCapsuleJourney ? 'capsule' : 'single-look',
      activeJourneyLook: isCapsuleJourney ? activeJourneyIndex : null,
      removedItem: {
        id: product.id,
        name: product.name,
        color: product.color,
        slot: slotForProduct(product),
        priceCad: product.price,
      },
      ...stagedLookSnapshot(nextSelections),
      previewStatus: result.status,
      bagChange: 'none',
      message: `${product.name} was removed from the visible staged look. The shopping bag was not changed.`,
    };
  }, [activeJourneyIndex, composeLook, focusAtelier, isCapsuleJourney, lockedProductIds, model, selections, updateActiveJourneySelections]);

  const replaceStagedItemFromWebMCP = useCallback(async (rawInput: unknown) => {
    const { productId, replacementProductId } = validateStagedItemMutationInput(rawInput, true);
    const product = productById.get(productId);
    if (!product || !selectionIncludes(selections, product)) {
      throw new Error(`Product ${productId} is not in the currently visible staged look.`);
    }
    if (isCapsuleJourney && lockedProductIds.includes(product.id)) {
      throw new Error(`${product.name} is locked. Unlock it before replacing it.`);
    }
    if (replacementProductId === productId) {
      throw new Error('replacementProductId must identify a different catalog product.');
    }

    const replacement = productById.get(replacementProductId);
    if (!replacement) {
      throw new Error(`Product ${replacementProductId} is not in the ÉLANE catalog.`);
    }
    const expectedAudience = model === 'woman' ? 'Women' : 'Men';
    if (replacement.audience !== expectedAudience) {
      throw new Error(`${replacement.name} is a ${replacement.audience.toLowerCase()} product and cannot be used with the active ${expectedAudience.toLowerCase()} collection.`);
    }
    const slot = slotForProduct(product);
    if (slotForProduct(replacement) !== slot) {
      throw new Error(`${replacement.name} is a ${slotForProduct(replacement).toLowerCase()} and cannot replace a ${slot.toLowerCase()}.`);
    }
    if (selectionIncludes(selections, replacement)) {
      throw new Error(`${replacement.name} is already in the currently visible staged look.`);
    }
    if (excludedProductIds.includes(replacement.id)) {
      throw new Error(`${replacement.name} is excluded from this capsule. Remove the exclusion before staging it.`);
    }

    const nextSelections = replaceProductInSelections(selections, product, replacement);
    setSelections(nextSelections);
    if (isCapsuleJourney) updateActiveJourneySelections(model, nextSelections);
    setActiveStyleSlot(slot);
    const result = await composeLook(model, nextSelections);
    await focusAtelier();

    return {
      status: 'replaced',
      model,
      presentationMode: isCapsuleJourney ? 'capsule' : 'single-look',
      activeJourneyLook: isCapsuleJourney ? activeJourneyIndex : null,
      replacedItem: {
        id: product.id,
        name: product.name,
        color: product.color,
        slot,
        priceCad: product.price,
      },
      replacementItem: {
        id: replacement.id,
        name: replacement.name,
        color: replacement.color,
        slot,
        priceCad: replacement.price,
      },
      ...stagedLookSnapshot(nextSelections),
      previewStatus: result.status,
      bagChange: 'none',
      message: `${product.name} was replaced with ${replacement.name} in the visible staged look. The shopping bag was not changed.`,
    };
  }, [activeJourneyIndex, composeLook, excludedProductIds, focusAtelier, isCapsuleJourney, lockedProductIds, model, selections, updateActiveJourneySelections]);

  const selectStyleProduct = (product: Product, revealAtelier = false) => {
    const nextModel: ModelId = product.audience === 'Women' ? 'woman' : 'man';
    const slot = slotForProduct(product);
    if (isCapsuleJourney && nextModel === model) {
      const selectedInSlot = productIdsForSlot(selections, slot);
      if (selectedInSlot.some((id) => lockedProductIds.includes(id) && id !== product.id)) return;
      if (selectedInSlot.includes(product.id) && lockedProductIds.includes(product.id)) return;
      if (slot === 'Dress' && [
        ...productIdsForSlot(selections, 'Top'),
        ...productIdsForSlot(selections, 'Bottom'),
      ].some((id) => lockedProductIds.includes(id))) return;
      if ((slot === 'Top' || slot === 'Bottom') && productIdsForSlot(selections, 'Dress').some((id) => lockedProductIds.includes(id))) return;
    }
    setExcludedProductIds((current) => current.filter((id) => id !== product.id));
    const nextSelections = cloneSelections(
      styleCollection === null
        ? {}
        : nextModel === model ? selections : defaultSelectionsByModel[nextModel],
    );
    if (slot === 'Accessory') {
      const currentAccessories = nextSelections.Accessory ?? [];
      nextSelections.Accessory = currentAccessories.includes(product.id)
        ? currentAccessories.filter((id) => id !== product.id)
        : [...currentAccessories, product.id];
      if (!nextSelections.Accessory.length) delete nextSelections.Accessory;
    } else {
      nextSelections[slot] = product.id;
    }
    if (slot === 'Dress') {
      delete nextSelections.Top;
      delete nextSelections.Bottom;
    } else if (slot === 'Top' || slot === 'Bottom') {
      delete nextSelections.Dress;
    }
    setStyleCollection(nextModel);
    setModel(nextModel);
    setSelections(nextSelections);
    if (nextModel !== model) setActiveJourneyIndex(0);
    if (isCapsuleJourney) updateActiveJourneySelections(nextModel, nextSelections);
    setActiveStyleSlot(slot);
    setManualEditorOpen(true);
    void composeLook(nextModel, nextSelections);
    if (revealAtelier) {
      requestAnimationFrame(() => document.getElementById('atelier')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  const selectModel = (nextModel: ModelId) => {
    const nextJourney = cloneJourney(curatedJourneys[nextModel]);
    const defaults = cloneSelections(nextJourney.looks[0].selections);
    setJourney(nextJourney);
    setActiveJourneyIndex(0);
    setIsCapsuleJourney(false);
    setCapsuleConstraints(cloneConstraints(curatedConstraints[nextModel]));
    setOwnedProductIds([]);
    setExcludedProductIds([]);
    setLockedProductIds([]);
    setCapsuleRevision(null);
    setStyleCollection(nextModel);
    setModel(nextModel);
    setSelections(defaults);
    setActiveStyleSlot('Top');
    setAtelierSearch('');
    void composeLook(nextModel, defaults);
  };

  const clearActiveSlot = () => {
    const nextSelections = cloneSelections(selections);
    if (isCapsuleJourney && activeStyleSlot === 'Accessory') {
      const lockedAccessories = (nextSelections.Accessory ?? []).filter((id) => lockedProductIds.includes(id));
      if (lockedAccessories.length) nextSelections.Accessory = lockedAccessories;
      else delete nextSelections.Accessory;
    } else {
      if (isCapsuleJourney && productIdsForSlot(nextSelections, activeStyleSlot).some((id) => lockedProductIds.includes(id))) return;
      delete nextSelections[activeStyleSlot];
    }
    setSelections(nextSelections);
    if (isCapsuleJourney) updateActiveJourneySelections(model, nextSelections);
    void composeLook(model, nextSelections);
  };

  const removeStyleProduct = (product: Product) => {
    if (isCapsuleJourney && lockedProductIds.includes(product.id)) return;
    const nextSelections = removeProductFromSelections(selections, product);
    setSelections(nextSelections);
    if (isCapsuleJourney) updateActiveJourneySelections(model, nextSelections);
    void composeLook(model, nextSelections);
  };

  const toggleOwnedProduct = (productId: number) => {
    setOwnedProductIds((current) => (
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    ));
    setExcludedProductIds((current) => current.filter((id) => id !== productId));
    setCapsuleRevision(null);
  };

  const toggleLockedProduct = (productId: number) => {
    setLockedProductIds((current) => (
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    ));
    setCapsuleRevision(null);
  };

  const excludeCapsuleProduct = (product: Product) => {
    if (lockedProductIds.includes(product.id)) return;
    setExcludedProductIds((current) => current.includes(product.id) ? current : [...current, product.id]);
    setOwnedProductIds((current) => current.filter((id) => id !== product.id));
    setLockedProductIds((current) => current.filter((id) => id !== product.id));
    setCapsuleRevision(null);
    if (!isCapsuleJourney) {
      removeStyleProduct(product);
      return;
    }
    const nextJourney: CapsuleJourney = {
      ...journey,
      looks: journey.looks.map((look) => ({
        ...look,
        selections: removeProductFromSelections(look.selections, product),
      })),
    };
    const nextActiveLook = nextJourney.looks[activeJourneyIndex] ?? nextJourney.looks[0];
    setJourney(nextJourney);
    setSelections(cloneSelections(nextActiveLook.selections));
    void composeLook(model, nextActiveLook.selections);
  };

  const createCapsule = () => {
    if (!styleCollection) {
      setManualEditorOpen(true);
      return;
    }
    const nextJourney = cloneJourney(curatedJourneys[model]);
    const firstLook = nextJourney.looks[0];
    const pieces = selectedProducts(firstLook.selections);
    setJourney(nextJourney);
    setActiveJourneyIndex(0);
    setIsCapsuleJourney(true);
    setCapsuleConstraints(cloneConstraints(curatedConstraints[model]));
    setOwnedProductIds([]);
    setExcludedProductIds([]);
    setLockedProductIds([]);
    setCapsuleRevision(null);
    setSelections(cloneSelections(firstLook.selections));
    setActiveStyleSlot('Top');
    setAtelierSearch('');
    setManualEditorOpen(false);
    void showToolLook({ model: nextJourney.model, selections: firstLook.selections, pieces });
  };

  const returnToSingleLook = () => {
    setIsCapsuleJourney(false);
    setLockedProductIds([]);
    setCapsuleRevision(null);
    setAtelierSearch('');
    setManualEditorOpen(false);
  };

  const addLook = () => {
    const productsToBuy = productsToBuyForLook(selectedProducts(selections), isCapsuleJourney, ownedProductIds);
    productsToBuy.forEach((product) => addProduct(product, size, false));
    if (productsToBuy.length) setBagOpen(true);
  };

  const quantity = (id: number, delta: number) => {
    const nextCart = cart.flatMap((item) => {
      if (item.id !== id) return [item];
      const next = item.quantity + delta;
      return next > 0 ? [{ ...item, quantity: next }] : [];
    });
    setCart(nextCart);
    revokePromotionIfIneligible(nextCart);
  };

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const promotionState = promotionApplicationState(total, appliedPromotionCode);
  const promotionDiscount = promotionState === 'applied' ? promotionSavingsCad(total) : 0;
  const lookProducts = selectedProducts(selections);
  const lookTotal = lookProducts.reduce((sum, product) => sum + product.price, 0);
  const ownedProductIdSet = useMemo(() => new Set(ownedProductIds), [ownedProductIds]);
  const lookProductsToBuy = isCapsuleJourney
    ? lookProducts.filter((product) => !ownedProductIdSet.has(product.id))
    : lookProducts;
  const lookNewSpend = lookProductsToBuy.reduce((sum, product) => sum + product.price, 0);
  const activeJourneyLook = isCapsuleJourney ? (journey.looks[activeJourneyIndex] ?? journey.looks[0]) : undefined;
  const journeyUsage = useMemo(() => {
    const usage = new Map<number, number>();
    journey.looks.forEach((look) => {
      selectedProductIds(look.selections).forEach((id) => usage.set(id, (usage.get(id) ?? 0) + 1));
    });
    return usage;
  }, [journey]);
  const capsuleProducts = useMemo(() => (
    Array.from(journeyUsage.keys()).flatMap((id) => {
      const product = productById.get(id);
      return product ? [product] : [];
    })
  ), [journeyUsage]);
  const capsuleValue = capsuleProducts.reduce((sum, product) => sum + product.price, 0);
  const capsuleMetrics = useMemo(
    () => calculateCapsuleMetrics(journey, ownedProductIds),
    [journey, ownedProductIds],
  );
  const excludedProductIdSet = useMemo(() => new Set(excludedProductIds), [excludedProductIds]);
  const lockedProductIdSet = useMemo(() => new Set(lockedProductIds), [lockedProductIds]);
  const activeAudience = styleCollection ? (model === 'woman' ? 'Women' : 'Men') : null;
  const readyLayerCount = products.filter((product) => product.audience === activeAudience).length;
  const availableStyleSlots = styleSlots.filter((slot) => products.some((product) => (
    product.audience === activeAudience && slotForProduct(product) === slot
  )));
  const styleSlotCounts = useMemo(() => new Map(
    styleSlots.map((slot) => [slot, products.filter((product) => (
      product.audience === activeAudience && slotForProduct(product) === slot
    )).length]),
  ), [activeAudience]);
  const activeSlotProducts = useMemo(() => {
    return products.filter((product) => (
      product.audience === activeAudience &&
      slotForProduct(product) === activeStyleSlot
    ));
  }, [activeAudience, activeStyleSlot]);
  const activeStyleProducts = useMemo(() => (
    rankProductsBySearch(activeSlotProducts, deferredAtelierSearch)
  ), [activeSlotProducts, deferredAtelierSearch]);
  const currentLookName = lookName(selections);
  const currentGarmentsBrief = selectedGarmentsBrief(lookProducts, lookTotal);
  const selectionBlockedByLock = (product: Product) => {
    if (!isCapsuleJourney || product.audience !== activeAudience) return false;
    const slot = slotForProduct(product);
    const selectedInSlot = productIdsForSlot(selections, slot);
    if (selectedInSlot.some((id) => lockedProductIdSet.has(id) && id !== product.id)) return true;
    if (selectedInSlot.includes(product.id) && lockedProductIdSet.has(product.id)) return true;
    if (slot === 'Dress') {
      return [...productIdsForSlot(selections, 'Top'), ...productIdsForSlot(selections, 'Bottom')]
        .some((id) => lockedProductIdSet.has(id));
    }
    return (slot === 'Top' || slot === 'Bottom')
      && productIdsForSlot(selections, 'Dress').some((id) => lockedProductIdSet.has(id));
  };

  return (
    <main className={activeProduct ? 'product-route' : undefined}>
      {!activeProduct ? <AtelierWebMCP
        addCatalogItemToBag={addCatalogItemToBagFromWebMCP}
        addStagedItem={addStagedItemFromWebMCP}
        addStagedLook={addStagedLookFromWebMCP}
        adjustBagItemQuantity={adjustBagItemQuantityFromWebMCP}
        clearBag={clearShoppingBagFromWebMCP}
        applyPromotion={applyPromotionFromWebMCP}
        read={readAtelierFromWebMCP}
        readBag={readShoppingBagFromWebMCP}
        readPolicy={readPolicyFromWebMcp}
        readPromotions={readPromotionsFromWebMCP}
        checkReturnWindow={checkReturnWindowFromWebMcp}
        readState={readAtelierStateFromWebMCP}
        removeBagItems={removeBagItemsFromWebMCP}
        removeStagedItem={removeStagedItemFromWebMCP}
        replanCapsule={replanCapsuleFromWebMCP}
        replaceStagedItem={replaceStagedItemFromWebMCP}
        search={searchAtelierFromWebMCP}
        setAtelierSize={setAtelierSizeFromWebMCP}
        setBagItemSize={setBagItemSizeFromWebMCP}
        stage={composeFromWebMCP}
        stageJourney={stageJourneyFromWebMCP}
      /> : null}
      <div className="announcement">Complimentary shipping and returns on all orders.</div>
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="ÉLANE home">ÉLANE</a>
        <button
          className="menu-button"
          type="button"
          aria-expanded={mobileNavOpen}
          aria-controls="primary-navigation"
          onClick={() => setMobileNavOpen((open) => !open)}
        >{mobileNavOpen ? 'Close' : 'Menu'}</button>
        <nav id="primary-navigation" className={mobileNavOpen ? 'open' : ''} aria-label="Primary navigation">
          <a href={collectionHref()} onClick={() => { selectAudience('All'); setMobileNavOpen(false); }}>New arrivals</a>
          <a href={collectionHref('Women')} onClick={() => { selectAudience('Women'); setMobileNavOpen(false); }}>Women</a>
          <a href={collectionHref('Men')} onClick={() => { selectAudience('Men'); setMobileNavOpen(false); }}>Men</a>
          <a className="accent-link" href="/#atelier" onClick={navigateToAtelier}>Style Studio</a>
        </nav>
        <button className="bag-button" type="button" onClick={() => setBagOpen(true)}>Bag <span>{cartCount}</span></button>
      </header>

      {activeProduct ? (
        <ProductDetail product={activeProduct} relatedProducts={relatedProducts} initialSize={size} onAdd={addProduct} />
      ) : <>
      <section className="hero" id="top">
        <div className="hero-copy">
          <h1>Dress for a<br />life in motion.</h1>
          <p>A considered wardrobe for every occasion—styled around your life, your climate, and the pieces you already love.</p>
          <div className="hero-actions">
            <a className="primary-button" href="#collection">Shop new arrivals</a>
            <a className="text-link" href="#atelier" onClick={navigateToAtelier}>Explore the Style Studio</a>
          </div>
        </div>
        <div className="hero-media">
          <img
            src="/elane-hero.png"
            alt="A woman and man wearing ÉLANE tailoring"
            width={1774}
            height={887}
          />
        </div>
      </section>

      <section className="collection" id="collection">
        <div className="collection-heading">
          <div><p className="section-index">New season · 2026</p><h2>A wardrobe,<br />considered.</h2></div>
          <p>New-season tailoring, knitwear and accessories for women and men—designed to be worn together.</p>
        </div>
        <div className="catalog-controls">
          <div className="audience-tabs" aria-label="Shop by audience">
            {(['All', 'Women', 'Men'] as const).map((item) => <button className={audience === item ? 'active' : ''} key={item} type="button" onClick={() => selectAudience(item)}>{item}</button>)}
          </div>
          <label className="search-field">
            <span>Search</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, colour or style"
              autoComplete="off"
            />
            {search ? <button type="button" onClick={() => setSearch('')} aria-label="Clear product search">Clear</button> : null}
          </label>
        </div>
        <div className="category-row" aria-label="Product categories">
          {categoryOptions.map((item) => (
            <button className={category === item ? 'active' : ''} key={item} type="button" onClick={() => setCategory(item)}>
              {item === 'All' ? `All ${audience === 'All' ? 'pieces' : audience.toLowerCase()}` : (categoryLabels[audience][item] ?? item)}
            </button>
          ))}
        </div>
        <div className="catalog-results-summary" aria-live="polite">
          <span><strong>{visibleProducts.length}</strong> {visibleProducts.length === 1 ? 'piece' : 'pieces'} found</span>
          <span>Every piece can be styled in the Style Studio</span>
          {catalogIsFiltered ? (
            <button type="button" onClick={() => { setSearch(''); setAudience('All'); setCategory('All'); }}>Clear filters</button>
          ) : null}
        </div>
        <div
          className={`product-grid ${catalogIsUpdating ? 'is-updating' : ''}`}
          aria-busy={catalogIsUpdating}
        >
          {displayedProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onAdd={addProduct}
              onStyle={(item) => selectStyleProduct(item, true)}
              selected={selectionIncludes(selections, product)}
            />
          ))}
        </div>
        {!catalogIsFiltered && visibleProducts.length > 8 ? (
          <button className="catalog-toggle" type="button" onClick={() => setCatalogExpanded((expanded) => !expanded)}>
            {catalogExpanded ? 'Show the latest edit' : `View the full collection (${visibleProducts.length})`}
          </button>
        ) : null}
        {visibleProducts.length === 0 ? <div className="no-results"><h3>No pieces found.</h3><button type="button" onClick={() => { setSearch(''); setAudience('All'); setCategory('All'); }}>Reset the collection</button></div> : null}
      </section>

      <section className="atelier" id="atelier">
        <div className="atelier-intro">
          <h2>{isCapsuleJourney ? 'Advanced planning for every occasion.' : 'Your look. Made personal.'}</h2>
          <p>{isCapsuleJourney
            ? 'Plan several occasions together, mark what you already own, and keep favourite pieces fixed while the rest of the capsule adapts.'
            : 'Choose your pieces, set your size, and add one considered look. Multi-occasion planning is available only when you need it.'}</p>
          <div className="atelier-connection">
            <button className="reset-look" type="button" onClick={isCapsuleJourney ? returnToSingleLook : createCapsule}>
              {isCapsuleJourney ? 'Return to one look' : styleCollection ? 'Plan multiple occasions' : 'Choose a collection'}
            </button>
          </div>
        </div>
        <div className="style-studio-stage">
          <div className="garment-board-stage" aria-live="polite">
            <GarmentBoardPreview selections={selections} />
            {previewStatus === 'error' ? (
              <div className="board-error" role="alert">
                <strong>Piece not available</strong>
                <span>{previewError}</span>
                <button type="button" onClick={() => void composeLook(model, selections)}>Check again</button>
              </div>
            ) : null}
            <div className="look-caption">
              <span>{activeJourneyLook?.moment ?? 'Your selection'}</span>
              <strong>{activeJourneyLook?.name ?? currentLookName}</strong>
              <em>{currency(lookTotal)}</em>
            </div>
          </div>
          <div className="style-studio-controls capsule-workspace">
            <div className={isCapsuleJourney ? 'journey-head' : 'single-look-head'}>
              <div>
                <h3>{isCapsuleJourney ? journey.title : 'Your look'}</h3>
                <p aria-live="polite">{currentGarmentsBrief}</p>
              </div>
              <span>{activeAudience ? `${activeAudience} collection` : 'Choose a collection'}</span>
            </div>

            {isCapsuleJourney ? (
              <div className="journey-rail" aria-label="Looks in this capsule journey">
                {journey.looks.map((look, index) => (
                  <button
                    aria-current={activeJourneyIndex === index ? 'step' : undefined}
                    className={activeJourneyIndex === index ? 'active' : ''}
                    type="button"
                    key={`${look.name}-${index}`}
                    onClick={() => selectJourneyLook(index)}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{look.moment.replace(/^\d{2}:\d{2}\s*·\s*/, '')}</strong>
                    <small>{look.name}</small>
                  </button>
                ))}
              </div>
            ) : null}

            <div className={`journey-detail-grid ${isCapsuleJourney ? '' : 'single-look-detail-grid'}`}>
              <section className="current-look-ledger" aria-label="Current look">
                <div className="ledger-heading">
                  <div><span>{isCapsuleJourney ? 'Current look' : 'Selected pieces'}</span><h4>{activeJourneyLook?.name ?? currentLookName}</h4></div>
                  <strong>{currency(lookTotal)}</strong>
                </div>
                <div className="ledger-pieces">
                  {lookProducts.map((product) => (
                    <div className={`ledger-piece ${lockedProductIdSet.has(product.id) ? 'is-locked' : ''}`} key={product.id}>
                      <ProductVisual product={product} className="ledger-image" decorative />
                      <div>
                        <strong>{product.name}</strong>
                        <small>{product.color} · {slotForProduct(product)}</small>
                        {isCapsuleJourney ? (
                          <span className="piece-flags">
                            <span className={ownedProductIdSet.has(product.id) ? 'owned' : 'buy'}>
                              {ownedProductIdSet.has(product.id) ? 'Owned' : 'Buy'}
                            </span>
                            {lockedProductIdSet.has(product.id) ? <span className="locked">Locked</span> : null}
                          </span>
                        ) : null}
                      </div>
                      <div className="ledger-piece-actions">
                        <em>{ownedProductIdSet.has(product.id) && isCapsuleJourney ? '$0 new spend' : currency(product.price)}</em>
                        {isCapsuleJourney ? (
                          <div className="piece-action-row">
                            <button
                              className={lockedProductIdSet.has(product.id) ? 'active' : ''}
                              type="button"
                              aria-pressed={lockedProductIdSet.has(product.id)}
                              onClick={() => toggleLockedProduct(product.id)}
                            >{lockedProductIdSet.has(product.id) ? 'Unlock' : 'Lock'}</button>
                            <button
                              className={ownedProductIdSet.has(product.id) ? 'active' : ''}
                              type="button"
                              aria-pressed={ownedProductIdSet.has(product.id)}
                              onClick={() => toggleOwnedProduct(product.id)}
                            >{ownedProductIdSet.has(product.id) ? 'Mark buy' : 'Already own'}</button>
                            <button
                              type="button"
                              disabled={lockedProductIdSet.has(product.id)}
                              onClick={() => excludeCapsuleProduct(product)}
                            >Exclude</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => removeStyleProduct(product)}
                            aria-label={`Remove ${product.name} from this look`}
                          >Remove</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {isCapsuleJourney && activeJourneyLook?.stylingNote ? (
                  <p className="styling-note">{activeJourneyLook.stylingNote}</p>
                ) : null}
              </section>

              {isCapsuleJourney ? (
                <aside className="capsule-overview" aria-label="Capsule overview">
                  <span>Capsule plan</span>
                  <div className="capsule-metrics">
                    <div><strong>{capsuleMetrics.outfitCount}</strong><span>outfits created</span></div>
                    <div><strong>{capsuleMetrics.ownedPiecesReused}</strong><span>owned pieces reused</span></div>
                    <div><strong>{capsuleMetrics.newPieceCount}</strong><span>new pieces required</span></div>
                    <div><strong>{capsuleMetrics.reusedPieceCount}</strong><span>pieces reused overall</span></div>
                  </div>
                  <div className="capsule-value">
                    <span>Total spend</span>
                    <strong>{currency(capsuleMetrics.totalSpendCad)}</strong>
                  </div>
                  <div className="occasion-cost"><span>Cost per occasion</span><strong>{currency(capsuleMetrics.costPerOccasionCad)}</strong></div>
                  <p>{journey.budgetCad
                    ? capsuleMetrics.totalSpendCad <= journey.budgetCad
                      ? `${currency(journey.budgetCad - capsuleMetrics.totalSpendCad)} remaining in the brief`
                      : `${currency(capsuleMetrics.totalSpendCad - journey.budgetCad)} over the brief`
                    : `${currency(capsuleValue)} catalog value before owned pieces`}</p>
                  <div className="constraint-summary" aria-label="Capsule constraints">
                    <div><span>Budget</span><strong>{journey.budgetCad ? currency(journey.budgetCad) : 'Open'}</strong></div>
                    <div><span>Size</span><strong>{size}</strong></div>
                    <div><span>Weather</span><strong>{capsuleConstraints.climate}</strong></div>
                    <div><span>Dress code</span><strong>{capsuleConstraints.dressCode}</strong></div>
                    <div><span>Prefer</span><strong>{capsuleConstraints.preferredColors.join(', ') || 'Open palette'}</strong></div>
                    <div><span>Exclude</span><strong>{capsuleConstraints.excludedColors.join(', ') || 'None'}</strong></div>
                  </div>
                </aside>
              ) : null}
            </div>

            {isCapsuleJourney && capsuleRevision ? (
              <section className="revision-diff" aria-label="What changed and why" aria-live="polite">
                <div className="revision-heading">
                  <div><span>Lock + Replan complete</span><h4>What changed and why?</h4></div>
                  <p>{capsuleRevision.note}</p>
                </div>
                <div className="revision-metrics">
                  <div>
                    <span>Before</span>
                    <strong>{currency(capsuleRevision.beforeMetrics.totalSpendCad)}</strong>
                    <small>{capsuleRevision.beforeMetrics.reusedPieceCount} reused · {capsuleRevision.beforeMetrics.newPieceCount} to buy</small>
                  </div>
                  <div>
                    <span>After</span>
                    <strong>{currency(capsuleRevision.afterMetrics.totalSpendCad)}</strong>
                    <small>{capsuleRevision.afterMetrics.reusedPieceCount} reused · {capsuleRevision.afterMetrics.newPieceCount} to buy</small>
                  </div>
                  <div>
                    <span>Spend difference</span>
                    <strong>{currency(capsuleRevision.afterMetrics.totalSpendCad - capsuleRevision.beforeMetrics.totalSpendCad)}</strong>
                    <small>{capsuleRevision.afterMetrics.outfitCount} occasions still covered</small>
                  </div>
                </div>
                <div className="revision-groups">
                  <div>
                    <span>Preserved</span>
                    {capsuleRevision.preservedProductIds.map((id) => {
                      const product = productById.get(id);
                      return product ? <strong key={id}>{product.name}{lockedProductIdSet.has(id) ? ' · locked' : ''}</strong> : null;
                    })}
                  </div>
                  <div>
                    <span>Replaced or removed</span>
                    {capsuleRevision.reasons.filter((change) => change.action === 'removed').map((change) => (
                      <p key={`removed-${change.productId}`}><strong>{productById.get(change.productId)?.name}</strong><small>{change.reason}</small></p>
                    ))}
                    {!capsuleRevision.removedProductIds.length ? <small>No pieces removed.</small> : null}
                  </div>
                  <div>
                    <span>Added</span>
                    {capsuleRevision.reasons.filter((change) => change.action === 'added').map((change) => (
                      <p key={`added-${change.productId}`}><strong>{productById.get(change.productId)?.name}</strong><small>{change.reason}</small></p>
                    ))}
                    {!capsuleRevision.addedProductIds.length ? <small>No new pieces added.</small> : null}
                  </div>
                </div>
              </section>
            ) : null}

            <div className="journey-actions">
              <button className="add-look" type="button" disabled={!lookProductsToBuy.length} onClick={addLook}>
                <span>{isCapsuleJourney
                  ? (lookProductsToBuy.length
                    ? `Add ${lookProductsToBuy.length} ${lookProductsToBuy.length === 1 ? 'piece' : 'pieces'} to bag`
                    : 'Everything already owned')
                  : 'Add this look'}</span>
                <strong>{currency(lookNewSpend)}</strong>
              </button>
              <button
                aria-expanded={manualEditorOpen}
                className="edit-look"
                type="button"
                onClick={() => setManualEditorOpen((open) => !open)}
              >
                {manualEditorOpen ? 'Close manual editor' : 'Edit pieces manually'}
              </button>
            </div>

            <div className={`manual-editor ${manualEditorOpen ? 'open' : ''}`}>
              <div className="manual-editor-head">
                <div>
                  <strong>Edit pieces manually</strong>
                  <span>{isCapsuleJourney ? 'Changes stay inside the active journey look.' : 'Changes apply to this look.'}</span>
                </div>
                <div className="profile-switch" aria-label="Choose a collection">
                  <span>Collection</span>
                  {(Object.keys(defaultSelectionsByModel) as ModelId[]).map((id) => (
                    <button className={styleCollection === id ? 'selected' : ''} type="button" key={id} aria-pressed={styleCollection === id} onClick={() => selectModel(id)}>
                      {id === 'woman' ? 'Women' : 'Men'}
                    </button>
                  ))}
                </div>
              </div>
              {manualEditorOpen ? (
                <div className="manual-editor-body">
                  <div className="garment-tabs" role="tablist" aria-label="Choose a garment type">
                    {availableStyleSlots.map((item) => (
                      <button
                        role="tab"
                        aria-selected={activeStyleSlot === item}
                        className={activeStyleSlot === item ? 'selected' : ''}
                        type="button"
                        key={item}
                        onClick={() => { setActiveStyleSlot(item); setAtelierSearch(''); }}
                      >
                        <span>{item === 'Layer' ? 'Layers' : styleGroupLabels[item]}</span>
                        <small>{styleSlotCounts.get(item)}</small>
                      </button>
                    ))}
                  </div>
                  <div className="atelier-product-search">
                    <label>
                      <span>Find a piece</span>
                      <input
                        type="search"
                        value={atelierSearch}
                        onChange={(event) => setAtelierSearch(event.target.value)}
                        placeholder={`Search ${styleSlotPlural(activeStyleSlot)} by name or colour`}
                        autoComplete="off"
                      />
                    </label>
                    {atelierSearch ? <button type="button" onClick={() => setAtelierSearch('')}>Clear</button> : null}
                  </div>
                  <div className="style-filter-label">
                    <strong>{atelierSearch
                      ? `${activeStyleProducts.length} of ${activeSlotProducts.length} ${styleSlotPlural(activeStyleSlot)}`
                      : `All ${activeSlotProducts.length} ${styleSlotPlural(activeStyleSlot)}`}</strong>
                    {slotHasSelection(selections, activeStyleSlot)
                      ? <button type="button" onClick={clearActiveSlot}>
                        {activeStyleSlot === 'Accessory' ? 'Clear accessories' : 'Clear selection'}
                      </button>
                      : <span>{activeStyleSlot === 'Accessory' ? 'Add accessories' : 'Select a garment'}</span>}
                  </div>
                  <div
                    className={`style-option-groups ${atelierSearch !== deferredAtelierSearch ? 'is-updating' : ''}`}
                    aria-busy={atelierSearch !== deferredAtelierSearch}
                    aria-label={`Choose a ${activeStyleSlot.toLowerCase()} product for the garment board`}
                  >
                    <div className="style-product-picker">
                      {activeStyleProducts.map((product) => {
                        const isSelected = selectionIncludes(selections, product);
                        const blockedByLock = selectionBlockedByLock(product);
                        return (
                          <button
                            className={`${isSelected ? 'selected' : ''} ${excludedProductIdSet.has(product.id) ? 'excluded' : ''}`}
                            type="button"
                            key={product.id}
                            onClick={() => selectStyleProduct(product)}
                            aria-pressed={isSelected}
                            disabled={blockedByLock}
                            aria-label={blockedByLock
                              ? `${product.name} is unavailable while the current ${slotForProduct(product).toLowerCase()} selection is locked`
                              : `${isSelected ? 'Remove' : 'Add'} ${product.name} ${isSelected ? 'from' : 'to'} the garment board`}
                          >
                            <ProductVisual product={product} className="style-option-image" decorative />
                            {isCapsuleJourney && (ownedProductIdSet.has(product.id) || excludedProductIdSet.has(product.id)) ? (
                              <b className={`option-disposition ${excludedProductIdSet.has(product.id) ? 'excluded' : 'owned'}`}>
                                {excludedProductIdSet.has(product.id) ? 'Excluded · select to restore' : 'Already own'}
                              </b>
                            ) : null}
                            <span>{product.name}</span>
                            <small>{product.color}</small>
                            <em>{currency(product.price)}</em>
                          </button>
                        );
                      })}
                      {!activeStyleProducts.length ? (
                        <div className="style-search-empty">
                          <strong>No matching pieces.</strong>
                          <button type="button" onClick={() => setAtelierSearch('')}>Show all {styleSlotPlural(activeStyleSlot)}</button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="size-picker"><span>Select size</span><div>{atelierSizes.map((item) => <button className={size === item ? 'active' : ''} type="button" key={item} onClick={() => setSize(item)}>{item}</button>)}</div></div>
                </div>
              ) : null}
            </div>

            <div className="atelier-status">
              <p>{isCapsuleJourney
                ? `${lockedProductIds.length} locked · ${ownedProductIds.length} owned · ${excludedProductIds.length} excluded. Unlocked pieces can be refreshed. Favourites stay fixed.`
                : 'Build one look at a time. Create a capsule only when you need coordinated options for more than one occasion.'} {sessionReady ? 'Session saved on this device.' : 'Restoring your saved session…'}</p>
              <p>{previewStatus === 'ready'
                ? `${lookProducts.length} ${lookProducts.length === 1 ? 'piece' : 'pieces'} · Size ${size} · Board ready`
                : styleCollection ? `${readyLayerCount} garments ready` : 'Choose a collection to begin'}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="editorial-band">
        <div><h2>Made to move with you.</h2><p>Complimentary delivery and returns. Checkout preview. Thoughtful customer care.</p></div>
        <a href="#atelier" onClick={navigateToAtelier}>Visit the Style Studio</a>
      </section>
      </>}

      <footer>
        <div><a className="wordmark" href="/">ÉLANE</a><p>Modern wardrobe. Timeless expression.</p><small>© 2026 ÉLANE. All rights reserved.</small></div>
        <div><strong>Shop</strong><a href={collectionHref()} onClick={() => selectAudience('All')}>New arrivals</a><a href={collectionHref('Women')} onClick={() => selectAudience('Women')}>Women</a><a href={collectionHref('Men')} onClick={() => selectAudience('Men')}>Men</a><a href="/#atelier" onClick={navigateToAtelier}>Style Studio</a></div>
        <div><strong>Client care</strong><a href="/returns">Delivery &amp; returns</a><span>Size guide</span><span>Contact</span></div>
        <div><strong>About</strong><p>A considered wardrobe for modern life.</p><a href="/terms">Terms &amp; conditions</a></div>
      </footer>

      <button
        className={`promotion-sticky ${promotionState === 'applied' ? 'applied' : ''}`}
        type="button"
        aria-haspopup="dialog"
        onClick={() => setPromotionOpen(true)}
      >
        <span>Private offer</span>
        <strong>{promotionState === 'applied'
          ? `${atelierPromotion.discountPercent}% applied`
          : 'Click to reveal offer'}</strong>
      </button>
      <PromotionOffer
        open={promotionOpen}
        subtotal={total}
        onClose={() => setPromotionOpen(false)}
        onOpenBag={() => { setPromotionOpen(false); setBagOpen(true); }}
      />
      <BagDrawer items={cart} open={bagOpen} appliedPromotionCode={promotionState === 'applied' ? appliedPromotionCode : undefined} onClose={() => setBagOpen(false)} onQuantity={quantity} onCheckout={() => { setBagOpen(false); setCheckoutOpen(true); }} />
      <Checkout open={checkoutOpen} subtotal={total} discount={promotionDiscount} onClose={() => setCheckoutOpen(false)} onApplyPromotion={applyPromotionFromCheckout} />
    </main>
  );
}

export default function Home() {
  return <Boutique />;
}
