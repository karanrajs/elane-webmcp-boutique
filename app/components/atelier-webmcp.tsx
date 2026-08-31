'use client';

import { useEffect, useRef } from 'react';
import {
  WEBMCP_BAG_PAGE_LIMIT,
  WEBMCP_CATALOG_PAGE_LIMIT,
  WEBMCP_STATE_LIST_PAGE_LIMIT,
  enforceWebMcpOutputBudget,
} from '../webmcp-contract';

/**
 * Browser-facing WebMCP adapter for the ÉLANE Style Studio.
 *
 * This component owns only tool schemas and registration lifecycle. The page
 * owns catalog validation, visible state, and commerce actions, which are
 * supplied as handlers. Keeping that boundary explicit makes every tool call
 * produce the same state transition as its corresponding interface action.
 */
type WebMcpModelContext = {
  registerTool: (
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema: object;
      annotations?: {
        readOnlyHint?: boolean;
        untrustedContentHint?: boolean;
      };
      execute: (input: unknown) => unknown | Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

type WebMcpDocument = Document & { readonly modelContext?: WebMcpModelContext };

export type AtelierToolInput = {
  model: 'woman' | 'man';
  topId?: number;
  bottomId?: number;
  dressId?: number;
  layerId?: number;
  accessoryIds?: number[];
};

export type CapsuleJourneyLookInput = Omit<AtelierToolInput, 'model'> & {
  name: string;
  moment: string;
  stylingNote?: string;
};

export type CapsuleJourneyInput = {
  model: 'woman' | 'man';
  title: string;
  brief: string;
  budgetCad?: number;
  looks: CapsuleJourneyLookInput[];
};

export type CapsulePieceChangeInput = {
  productId: number;
  action: 'added' | 'removed';
  reason: string;
};

export type ReplanCapsuleInput = {
  title?: string;
  brief?: string;
  budgetCad?: number;
  size?: 'XS' | 'S' | 'M' | 'L' | 'XL';
  climate?: string;
  dressCode?: string;
  preferredColors?: string[];
  excludedColors?: string[];
  ownedProductIds?: number[];
  excludedProductIds?: number[];
  lockedProductIds?: number[];
  revisionNote: string;
  changeReasons?: CapsulePieceChangeInput[];
  looks: CapsuleJourneyLookInput[];
};

export type AddStagedLookInput = {
  lookIndex?: number;
  size?: 'XS' | 'S' | 'M' | 'L' | 'XL';
};

export type AddCatalogItemToBagInput = {
  productId: number;
  size?: 'XS' | 'S' | 'M' | 'L' | 'XL';
};

export type AdjustBagItemQuantityInput = {
  productId: number;
  delta: -1 | 1;
};

export type SetBagItemSizeInput = {
  productId: number;
  size: 'XS' | 'S' | 'M' | 'L' | 'XL';
};

export type RemoveStagedItemInput = {
  productId: number;
};

export type AddStagedItemInput = RemoveStagedItemInput;

export type ReplaceStagedItemInput = RemoveStagedItemInput & {
  replacementProductId: number;
};

const sizeSchema = {
  type: 'string',
  enum: ['XS', 'S', 'M', 'L', 'XL'],
  description: 'The size to show for the currently staged Style Studio look.',
};

export type AtelierToolResult = {
  status: 'composed' | 'error';
  model: 'woman' | 'man';
  size: 'XS' | 'S' | 'M' | 'L' | 'XL';
  presentationMode: 'single-look';
  selectedPieces: Array<{
    id: number;
    name: string;
    color: string;
    slot: string;
    priceCad: number;
  }>;
  previewVisible: true;
  bagChange: 'none';
  nextStep: string;
  message: string;
};

function catalogIdSchema(description: string) {
  return {
    type: 'integer',
    minimum: 1,
    description,
  };
}

function productField(label: string) {
  return catalogIdSchema(`Optional catalog ID for the ${label}.`);
}

const fieldSchemas = [
  ['topId', productField('top')],
  ['bottomId', productField('bottom')],
  ['dressId', productField('dress; a dress cannot be combined with a top or bottom')],
  ['layerId', productField('outer layer')],
] as const;
const layerProperties = Object.fromEntries(fieldSchemas);
const layerRequirements = fieldSchemas.map(([name]) => ({ required: [name] }));
const accessoryIdsSchema = {
  type: 'array',
  minItems: 1,
  maxItems: 4,
  uniqueItems: true,
  items: catalogIdSchema('Catalog ID for an accessory matching the selected collection.'),
  description: 'Optional list of up to four unique accessory IDs.',
};
const modelSchema = {
  type: 'string',
  enum: ['woman', 'man'],
  description: 'The women’s or men’s collection that matches every selected catalog piece.',
};
const stagedProductIdSchema = catalogIdSchema('Catalog ID for a piece in the currently visible staged look.');
const catalogProductIdSchema = catalogIdSchema('Catalog ID for an ÉLANE item.');
const singleLookSchema = {
  type: 'object',
  properties: { model: modelSchema, ...layerProperties, accessoryIds: accessoryIdsSchema },
  required: ['model'],
  anyOf: [...layerRequirements, { required: ['accessoryIds'] }],
  additionalProperties: false,
};
const journeyLookSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 48,
      description: 'A concise editorial name for this look, such as Studio restraint.',
    },
    moment: {
      type: 'string',
      minLength: 1,
      maxLength: 48,
      description: 'The occasion or stop on the journey, such as 09:00 Studio.',
    },
    stylingNote: {
      type: 'string',
      maxLength: 180,
      description: 'Optional concise reasoning that explains why the pieces work for this moment.',
    },
    ...layerProperties,
    accessoryIds: accessoryIdsSchema,
  },
  required: ['name', 'moment'],
  anyOf: [...layerRequirements, { required: ['accessoryIds'] }],
  additionalProperties: false,
};

const capsuleProductIdsSchema = (description: string) => ({
  type: 'array',
  maxItems: 100,
  uniqueItems: true,
  items: stagedProductIdSchema,
  description,
});

const shortTextListSchema = (description: string) => ({
  type: 'array',
  maxItems: 12,
  uniqueItems: true,
  items: { type: 'string', minLength: 1, maxLength: 32 },
  description,
});

const offsetSchema = {
  type: 'integer',
  minimum: 0,
  default: 0,
  description: 'Zero-based result offset. Use nextOffset from the prior response.',
};

function pageLimitSchema(maximum: number) {
  return {
    type: 'integer',
    minimum: 1,
    maximum,
    default: maximum,
    description: `Maximum records to return, up to ${maximum}.`,
  };
}

type AtelierWebMCPProps = {
  read: (input: unknown) => unknown | Promise<unknown>;
  readState: (input: unknown) => unknown | Promise<unknown>;
  search: (input: unknown) => unknown | Promise<unknown>;
  stage: (input: unknown) => Promise<AtelierToolResult>;
  stageJourney: (input: unknown) => Promise<unknown>;
  replanCapsule: (input: unknown) => Promise<unknown>;
  setAtelierSize: (input: unknown) => Promise<unknown>;
  readBag: (input: unknown) => unknown | Promise<unknown>;
  readPromotions: (input: unknown) => unknown | Promise<unknown>;
  applyPromotion: (input: unknown) => Promise<unknown>;
  addCatalogItemToBag: (input: unknown) => Promise<unknown>;
  adjustBagItemQuantity: (input: unknown) => Promise<unknown>;
  setBagItemSize: (input: unknown) => Promise<unknown>;
  removeBagItems: (input: unknown) => Promise<unknown>;
  clearBag: (input: unknown) => Promise<unknown>;
  addStagedLook: (input: unknown) => Promise<unknown>;
  addStagedItem: (input: unknown) => Promise<unknown>;
  removeStagedItem: (input: unknown) => Promise<unknown>;
  replaceStagedItem: (input: unknown) => Promise<unknown>;
};

export function AtelierWebMCP({
  read,
  readState,
  search,
  stage,
  stageJourney,
  replanCapsule,
  setAtelierSize,
  readBag,
  readPromotions,
  applyPromotion,
  addCatalogItemToBag,
  adjustBagItemQuantity,
  setBagItemSize,
  removeBagItems,
  clearBag,
  addStagedLook,
  addStagedItem,
  removeStagedItem,
  replaceStagedItem,
}: AtelierWebMCPProps) {
  const readRef = useRef(read);
  const readStateRef = useRef(readState);
  const searchRef = useRef(search);
  const stageRef = useRef(stage);
  const stageJourneyRef = useRef(stageJourney);
  const replanCapsuleRef = useRef(replanCapsule);
  const setAtelierSizeRef = useRef(setAtelierSize);
  const readBagRef = useRef(readBag);
  const readPromotionsRef = useRef(readPromotions);
  const applyPromotionRef = useRef(applyPromotion);
  const addCatalogItemToBagRef = useRef(addCatalogItemToBag);
  const adjustBagItemQuantityRef = useRef(adjustBagItemQuantity);
  const setBagItemSizeRef = useRef(setBagItemSize);
  const removeBagItemsRef = useRef(removeBagItems);
  const clearBagRef = useRef(clearBag);
  const addStagedLookRef = useRef(addStagedLook);
  const addStagedItemRef = useRef(addStagedItem);
  const removeStagedItemRef = useRef(removeStagedItem);
  const replaceStagedItemRef = useRef(replaceStagedItem);

  useEffect(() => {
    readRef.current = read;
    readStateRef.current = readState;
    searchRef.current = search;
    stageRef.current = stage;
    stageJourneyRef.current = stageJourney;
    replanCapsuleRef.current = replanCapsule;
    setAtelierSizeRef.current = setAtelierSize;
    readBagRef.current = readBag;
    readPromotionsRef.current = readPromotions;
    applyPromotionRef.current = applyPromotion;
    addCatalogItemToBagRef.current = addCatalogItemToBag;
    adjustBagItemQuantityRef.current = adjustBagItemQuantity;
    setBagItemSizeRef.current = setBagItemSize;
    removeBagItemsRef.current = removeBagItems;
    clearBagRef.current = clearBag;
    addStagedLookRef.current = addStagedLook;
    addStagedItemRef.current = addStagedItem;
    removeStagedItemRef.current = removeStagedItem;
    replaceStagedItemRef.current = replaceStagedItem;
  }, [addCatalogItemToBag, addStagedItem, addStagedLook, adjustBagItemQuantity, applyPromotion, clearBag, read, readBag, readPromotions, readState, removeBagItems, removeStagedItem, replaceStagedItem, replanCapsule, search, setAtelierSize, setBagItemSize, stage, stageJourney]);

  useEffect(() => {
    const context = (document as WebMcpDocument).modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const reportError = (error: unknown) => {
      console.error('Unable to register an ÉLANE Style Studio WebMCP tool.', error);
    };
    const register = (tool: Parameters<WebMcpModelContext['registerTool']>[0]) => {
      const execute = tool.execute;
      const budgetedTool = {
        ...tool,
        async execute(input: unknown) {
          return enforceWebMcpOutputBudget(tool.name, await execute(input));
        },
      };
      void Promise.resolve(context.registerTool(budgetedTool, { signal: lifecycle.signal })).catch(reportError);
    };

    try {
      register({
        name: 'elane_read_atelier_catalog',
        title: 'Read the ÉLANE Style Studio catalog',
        description: 'Read a paginated catalog page with prices, garment slots, and compatibility rules. Continue with nextOffset for full coverage. Use elane_read_atelier_state for the visible look or capsule. This does not change the page.',
        inputSchema: {
          type: 'object',
          properties: {
            model: modelSchema,
            offset: offsetSchema,
            limit: pageLimitSchema(WEBMCP_CATALOG_PAGE_LIMIT),
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute(input) {
          return readRef.current(input);
        },
      });

      register({
        name: 'elane_read_atelier_state',
        title: 'Read the ÉLANE Style Studio state',
        description: 'Read one compact view of the staged look, capsule, constraints, or customer product lists. List views are paginated. This does not change the page.',
        inputSchema: {
          type: 'object',
          properties: {
            view: {
              type: 'string',
              enum: ['summary', 'look', 'constraints', 'owned', 'excluded', 'locked'],
              default: 'summary',
              description: 'State view to return.',
            },
            lookIndex: {
              type: 'integer',
              minimum: 0,
              maximum: 3,
              description: 'Zero-based capsule look index for the look view.',
            },
            offset: offsetSchema,
            limit: pageLimitSchema(WEBMCP_STATE_LIST_PAGE_LIMIT),
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          return readStateRef.current(input);
        },
      });

      register({
        name: 'elane_search_atelier_catalog',
        title: 'Search the ÉLANE Style Studio catalog',
        description: 'Search all Style Studio products by natural-language style, garment, colour, or product name. Results are ranked partial matches after stop-word removal and intent-alias expansion. Optionally narrow to one collection, garment slot, or maximum CAD price. This does not change the page. Use returned IDs to stage a new look or capsule, or to add or replace a piece in the visible look.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              minLength: 1,
              maxLength: 80,
              description: 'Product intent such as stone knit and trousers, red sweater, ivory blazer, relaxed pants, denim, or leather bag.',
            },
            model: modelSchema,
            slot: {
              type: 'string',
              enum: ['Top', 'Bottom', 'Dress', 'Layer', 'Accessory'],
              description: 'Optional garment-board slot to search within.',
            },
            maxPriceCad: {
              type: 'integer',
              minimum: 1,
              maximum: 10000,
              description: 'Optional maximum price in CAD.',
            },
            offset: offsetSchema,
            limit: pageLimitSchema(WEBMCP_CATALOG_PAGE_LIMIT),
          },
          required: ['query'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          return searchRef.current(input);
        },
      });

      register({
        name: 'elane_stage_atelier_look',
        title: 'Stage one ÉLANE look',
        description: 'Stage one compatible look from the chosen collection and update the visible Style Studio garment board. This replaces the current staged presentation but never changes the shopping bag. Every selected piece remains separate, so this makes no simulated fit claim. Call elane_read_atelier_catalog or elane_search_atelier_catalog first and use only returned catalog IDs.',
        inputSchema: singleLookSchema,
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          return stageRef.current(input);
        },
      });

      register({
        name: 'elane_stage_capsule_journey',
        title: 'Stage an ÉLANE capsule journey',
        description: 'Batch-stage 2 to 4 occasion-specific looks from one women’s or men’s collection. Shared pieces count once toward budgetCad. The Style Studio will show a journey rail, reuse count, unique-piece count, capsule value, styling notes, and the first look as a garment-only editorial board. This replaces the staged presentation but never changes the shopping bag. Call elane_read_atelier_catalog or elane_search_atelier_catalog first and use only returned catalog IDs.',
        inputSchema: {
          type: 'object',
          properties: {
            model: modelSchema,
            title: { type: 'string', minLength: 1, maxLength: 64 },
            brief: { type: 'string', minLength: 1, maxLength: 180 },
            budgetCad: {
              type: 'integer',
              minimum: 100,
              maximum: 10000,
              description: 'Optional maximum CAD value for the distinct pieces in the capsule.',
            },
            looks: {
              type: 'array',
              minItems: 2,
              maxItems: 4,
              items: journeyLookSchema,
            },
          },
          required: ['model', 'title', 'brief', 'looks'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute(input) {
          return stageJourneyRef.current(input);
        },
      });

      register({
        name: 'elane_replan_capsule',
        title: 'Lock and replan an ÉLANE capsule',
        description: 'Replace the currently staged capsule in one atomic update after a real-life constraint changes. Preserve every locked piece, reject excluded pieces and colours, apply owned-versus-buy labels, update 2 to 4 occasion looks, recalculate spend and reuse, and show a visible before/after explanation. Read the current catalog state first, then send the complete revised set of looks rather than a partial patch. This never changes the shopping bag.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 64 },
            brief: { type: 'string', minLength: 1, maxLength: 180 },
            budgetCad: {
              type: 'integer',
              minimum: 100,
              maximum: 10000,
              description: 'Revised maximum CAD spend for distinct pieces that are not marked owned.',
            },
            size: sizeSchema,
            climate: { type: 'string', minLength: 1, maxLength: 80 },
            dressCode: { type: 'string', minLength: 1, maxLength: 80 },
            preferredColors: shortTextListSchema('Preferred colours for the revised capsule.'),
            excludedColors: shortTextListSchema('Colours the customer does not want in the revised capsule.'),
            ownedProductIds: capsuleProductIdsSchema('Catalog products the customer already owns. Their price is excluded from total spend.'),
            excludedProductIds: capsuleProductIdsSchema('Catalog products the customer refuses to wear. None may appear in the revised looks.'),
            lockedProductIds: capsuleProductIdsSchema('Currently staged catalog products that must be preserved in the revised capsule.'),
            revisionNote: {
              type: 'string',
              minLength: 1,
              maxLength: 180,
              description: 'Concise summary of the changed real-life constraint, such as ceremony moved outdoors and budget reduced to CAD 1,500.',
            },
            changeReasons: {
              type: 'array',
              maxItems: 24,
              items: {
                type: 'object',
                properties: {
                  productId: stagedProductIdSchema,
                  action: { type: 'string', enum: ['added', 'removed'] },
                  reason: { type: 'string', minLength: 1, maxLength: 180 },
                },
                required: ['productId', 'action', 'reason'],
                additionalProperties: false,
              },
            },
            looks: {
              type: 'array',
              minItems: 2,
              maxItems: 4,
              items: journeyLookSchema,
            },
          },
          required: ['revisionNote', 'looks'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute(input) {
          return replanCapsuleRef.current(input);
        },
      });

      register({
        name: 'elane_set_atelier_size',
        title: 'Set the ÉLANE Style Studio size',
        description: 'Set the size shown for the current staged Style Studio look without adding any pieces to the shopping bag.',
        inputSchema: {
          type: 'object',
          properties: { size: sizeSchema },
          required: ['size'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          return setAtelierSizeRef.current(input);
        },
      });

      register({
        name: 'elane_add_staged_item',
        title: 'Add one item to the staged ÉLANE look',
        description: 'Incrementally add one catalog product to the currently visible staged look, or to the active look in a staged capsule, without restaging its existing pieces. Call elane_read_atelier_catalog or elane_search_atelier_catalog first. The product must match the active collection and use an empty garment slot; use elane_replace_staged_item when that slot is occupied. Up to four accessories can be added. This does not change the shopping bag.',
        inputSchema: {
          type: 'object',
          properties: {
            productId: {
              ...stagedProductIdSchema,
              description: 'Catalog product ID for the compatible piece to add to the currently visible staged look.',
            },
          },
          required: ['productId'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          return addStagedItemRef.current(input);
        },
      });

      register({
        name: 'elane_remove_staged_item',
        title: 'Remove an item from the staged ÉLANE look',
        description: 'Remove one specific catalog product from the currently visible staged look, or from the active look in a staged capsule. Call elane_read_atelier_catalog first to inspect the current staged state. This updates the garment board and selected-piece ledger but does not change the shopping bag.',
        inputSchema: {
          type: 'object',
          properties: { productId: stagedProductIdSchema },
          required: ['productId'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          return removeStagedItemRef.current(input);
        },
      });

      register({
        name: 'elane_replace_staged_item',
        title: 'Replace an item in the staged ÉLANE look',
        description: 'Replace one specific product in the currently visible staged look, or in the active look of a staged capsule, with a catalog product from the same collection and garment slot. Call elane_read_atelier_catalog or elane_search_atelier_catalog first. This updates the garment board and selected-piece ledger but does not change the shopping bag.',
        inputSchema: {
          type: 'object',
          properties: {
            productId: stagedProductIdSchema,
            replacementProductId: {
              ...stagedProductIdSchema,
              description: 'Catalog product ID for the compatible replacement piece.',
            },
          },
          required: ['productId', 'replacementProductId'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          return replaceStagedItemRef.current(input);
        },
      });

      register({
        name: 'elane_read_shopping_bag',
        title: 'Read the ÉLANE shopping bag',
        description: 'Read a paginated page of bag lines plus quantities, sizes, and CAD totals. This does not change the bag or begin checkout.',
        inputSchema: {
          type: 'object',
          properties: {
            offset: offsetSchema,
            limit: pageLimitSchema(WEBMCP_BAG_PAGE_LIMIT),
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute(input) {
          return readBagRef.current(input);
        },
      });

      register({
        name: 'elane_read_promotions',
        title: 'Read available ÉLANE promotions',
        description: 'Read authoritative promotion terms and evaluate each offer against the current visible shopping bag. Returns eligibility, amount still needed, estimated savings, and applied status. This does not change the bag.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute(input) {
          return readPromotionsRef.current(input);
        },
      });

      register({
        name: 'elane_apply_promotion',
        title: 'Apply an ÉLANE promotion',
        description: 'Validate and apply one promotion code to the visible shopping bag after the user asks to use it. The bag must satisfy the offer terms. This updates the displayed discount and total but does not begin checkout, place an order, or collect payment.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', minLength: 1, maxLength: 32, description: 'Promotion code returned by elane_read_promotions.' },
          },
          required: ['code'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          return applyPromotionRef.current(input);
        },
      });

      register({
        name: 'elane_add_catalog_item_to_bag',
        title: 'Add one ÉLANE catalog item to the bag',
        description: 'Add exactly one unit of one catalog product directly to the visible shopping bag. Call elane_read_atelier_catalog or elane_search_atelier_catalog first. If the product is already present, its quantity increases by one. An optional size overrides the visible Style Studio size. This does not add the rest of the staged look or begin checkout.',
        inputSchema: {
          type: 'object',
          properties: {
            productId: catalogProductIdSchema,
            size: { ...sizeSchema, description: 'Optional size for the added item. Defaults to the visible Style Studio size.' },
          },
          required: ['productId'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          return addCatalogItemToBagRef.current(input);
        },
      });

      register({
        name: 'elane_adjust_bag_item_quantity',
        title: 'Adjust one ÉLANE bag item quantity',
        description: 'Increase or decrease one existing shopping-bag product line by exactly one unit. Call elane_read_shopping_bag first. Use delta 1 to add one unit or delta -1 to remove one unit. Decreasing a quantity of one removes that product line. This does not begin checkout.',
        inputSchema: {
          type: 'object',
          properties: {
            productId: catalogProductIdSchema,
            delta: {
              type: 'integer',
              enum: [-1, 1],
              description: 'Use 1 to increase the quantity by one or -1 to decrease it by one.',
            },
          },
          required: ['productId', 'delta'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          return adjustBagItemQuantityRef.current(input);
        },
      });

      register({
        name: 'elane_set_bag_item_size',
        title: 'Set the size of an ÉLANE bag item',
        description: 'Change the size stored on one existing shopping-bag product line without changing its quantity or the staged Style Studio size. Call elane_read_shopping_bag first. This does not begin checkout.',
        inputSchema: {
          type: 'object',
          properties: {
            productId: catalogProductIdSchema,
            size: { ...sizeSchema, description: 'The new size for the existing bag item.' },
          },
          required: ['productId', 'size'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          return setBagItemSizeRef.current(input);
        },
      });

      register({
        name: 'elane_remove_bag_items',
        title: 'Remove items from the ÉLANE shopping bag',
        description: 'Remove complete product lines from the shopping bag by catalog product ID. Call elane_read_shopping_bag first. This changes bag state but does not begin checkout or place an order.',
        inputSchema: {
          type: 'object',
          properties: {
            productIds: {
              type: 'array',
              minItems: 1,
              maxItems: 50,
              uniqueItems: true,
              items: { type: 'integer', minimum: 1 },
              description: 'Catalog product IDs for the complete bag lines to remove.',
            },
          },
          required: ['productIds'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          return removeBagItemsRef.current(input);
        },
      });

      register({
        name: 'elane_clear_shopping_bag',
        title: 'Clear the ÉLANE shopping bag',
        description: 'Remove every item from the shopping bag. Use only when the user explicitly asks to clear the bag. This changes bag state but does not begin checkout or place an order.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          return clearBagRef.current(input);
        },
      });

      register({
        name: 'elane_add_staged_look_to_bag',
        title: 'Add a staged ÉLANE look to the bag',
        description: 'Add every piece from the current single look, or each Buy piece from one capsule look, to the visible bag. Owned capsule pieces are skipped. Returns a compact receipt; read the bag for full verification. This never places an order or collects payment.',
        inputSchema: {
          type: 'object',
          properties: {
            lookIndex: {
              type: 'integer',
              minimum: 0,
              maximum: 3,
              description: 'Optional zero-based journey look index. Omit to add the currently visible look.',
            },
            size: { ...sizeSchema, description: 'Size applied to every added garment. Defaults to the visible Style Studio size.' },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute(input) {
          return addStagedLookRef.current(input);
        },
      });
    } catch (error) {
      reportError(error);
    }

    return () => lifecycle.abort();
  }, []);

  return null;
}
