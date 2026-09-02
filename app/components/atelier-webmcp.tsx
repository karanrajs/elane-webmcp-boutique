'use client';

import { useEffect, useRef } from 'react';
import {
  WEBMCP_BAG_PAGE_LIMIT,
  WEBMCP_CATALOG_PAGE_LIMIT,
  WEBMCP_SEARCH_PAGE_LIMIT,
  WEBMCP_STATE_LIST_PAGE_LIMIT,
  enforceWebMcpOutputBudget,
} from '../webmcp-contract';
import { createPolicyWebMcpTools } from './policy-webmcp';

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

export type WebMcpToolActivity = {
  invocationId: number;
  name: string;
  phase: 'running' | 'completed' | 'failed';
  readOnly: boolean;
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
  onToolActivity: (activity: WebMcpToolActivity) => void;
  read: (input: unknown) => unknown | Promise<unknown>;
  readState: (input: unknown) => unknown | Promise<unknown>;
  readRenderKit: (input: unknown) => unknown | Promise<unknown>;
  search: (input: unknown) => unknown | Promise<unknown>;
  stage: (input: unknown) => Promise<AtelierToolResult>;
  stageJourney: (input: unknown) => Promise<unknown>;
  replanCapsule: (input: unknown) => Promise<unknown>;
  setAtelierSize: (input: unknown) => Promise<unknown>;
  readBag: (input: unknown) => unknown | Promise<unknown>;
  readPromotions: (input: unknown) => unknown | Promise<unknown>;
  readPolicy: (input: unknown) => unknown | Promise<unknown>;
  checkReturnWindow: (input: unknown) => unknown | Promise<unknown>;
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
  onToolActivity,
  read,
  readState,
  readRenderKit,
  search,
  stage,
  stageJourney,
  replanCapsule,
  setAtelierSize,
  readBag,
  readPromotions,
  readPolicy,
  checkReturnWindow,
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
  const onToolActivityRef = useRef(onToolActivity);
  const activitySequenceRef = useRef(0);
  const readRef = useRef(read);
  const readStateRef = useRef(readState);
  const readRenderKitRef = useRef(readRenderKit);
  const searchRef = useRef(search);
  const stageRef = useRef(stage);
  const stageJourneyRef = useRef(stageJourney);
  const replanCapsuleRef = useRef(replanCapsule);
  const setAtelierSizeRef = useRef(setAtelierSize);
  const readBagRef = useRef(readBag);
  const readPromotionsRef = useRef(readPromotions);
  const readPolicyRef = useRef(readPolicy);
  const checkReturnWindowRef = useRef(checkReturnWindow);
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
    onToolActivityRef.current = onToolActivity;
    readRef.current = read;
    readStateRef.current = readState;
    readRenderKitRef.current = readRenderKit;
    searchRef.current = search;
    stageRef.current = stage;
    stageJourneyRef.current = stageJourney;
    replanCapsuleRef.current = replanCapsule;
    setAtelierSizeRef.current = setAtelierSize;
    readBagRef.current = readBag;
    readPromotionsRef.current = readPromotions;
    readPolicyRef.current = readPolicy;
    checkReturnWindowRef.current = checkReturnWindow;
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
  }, [addCatalogItemToBag, addStagedItem, addStagedLook, adjustBagItemQuantity, applyPromotion, checkReturnWindow, clearBag, onToolActivity, read, readBag, readPolicy, readPromotions, readRenderKit, readState, removeBagItems, removeStagedItem, replaceStagedItem, replanCapsule, search, setAtelierSize, setBagItemSize, stage, stageJourney]);

  useEffect(() => {
    const context = (document as WebMcpDocument).modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const reportError = (error: unknown) => {
      console.error('Unable to register an ÉLANE Style Studio WebMCP tool.', error);
    };
    const register = (tool: Parameters<WebMcpModelContext['registerTool']>[0]) => {
      const execute = tool.execute;
      const readOnly = tool.annotations?.readOnlyHint === true;
      const budgetedTool = {
        ...tool,
        async execute(input: unknown) {
          const invocationId = activitySequenceRef.current + 1;
          activitySequenceRef.current = invocationId;
          onToolActivityRef.current({ invocationId, name: tool.name, phase: 'running', readOnly });
          try {
            const result = enforceWebMcpOutputBudget(tool.name, await execute(input));
            onToolActivityRef.current({ invocationId, name: tool.name, phase: 'completed', readOnly });
            return result;
          } catch (error) {
            onToolActivityRef.current({ invocationId, name: tool.name, phase: 'failed', readOnly });
            throw error;
          }
        },
      };
      void Promise.resolve(context.registerTool(budgetedTool, { signal: lifecycle.signal })).catch(reportError);
    };

    try {
      register({
        name: 'read_catalog',
        description: 'Read a compact catalog overview by default. Use view products only for exhaustive enumeration and continue with nextOffset until null. For ordinary product discovery, prefer search_catalog so the agent receives ranked matches instead of walking every page. This does not change the page.',
        inputSchema: {
          type: 'object',
          properties: {
            view: {
              type: 'string',
              enum: ['overview', 'products'],
              default: 'overview',
              description: 'Overview returns facets and rules; products returns a paginated exhaustive listing.',
            },
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
        name: 'read_style_state',
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
        name: 'read_look_render_kit',
        description: 'Read the currently staged outfit as a compact render kit with one public garment image per piece. Use it to create a visual outfit preview on an editorial model or on a customer photo already supplied directly to the agent. This does not upload a photo, generate an image, change the page, or make fit and sizing claims.',
        inputSchema: {
          type: 'object',
          properties: {
            subjectMode: {
              type: 'string',
              enum: ['editorial_model', 'customer_photo'],
              default: 'editorial_model',
              description: 'Use a generated model or a customer photo already present in the agent conversation.',
            },
            lookIndex: {
              type: 'integer',
              minimum: 0,
              maximum: 3,
              description: 'Optional zero-based capsule look. Omit it to use the active look.',
            },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute(input) {
          return readRenderKitRef.current(input);
        },
      });

      register({
        name: 'search_catalog',
        description: 'Primary tool for ordinary product discovery. Search all Style Studio products by natural-language style, garment, colour, or product name. Results are ranked partial matches after stop-word removal and intent-alias expansion. Optionally narrow to one collection, garment slot, or maximum CAD price. This does not change the page. Use returned IDs to stage, add, or replace pieces.',
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
            limit: pageLimitSchema(WEBMCP_SEARCH_PAGE_LIMIT),
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
        name: 'stage_look',
        description: 'Stage one compatible look from the chosen collection and update the visible Style Studio garment board. This replaces the current staged presentation but never changes the shopping bag. Every selected piece remains separate, so this makes no simulated fit claim. Call search_catalog first for ordinary discovery and use only returned catalog IDs.',
        inputSchema: singleLookSchema,
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          return stageRef.current(input);
        },
      });

      register({
        name: 'stage_capsule',
        description: 'Optional advanced planning for 2 to 4 coordinated occasions. For one outfit, use stage_look. Shared pieces count once toward budgetCad. The Style Studio shows each look, reuse and value details, styling notes, and the first garment board. This replaces the staged presentation but never changes the bag. Search the catalog first and use only returned IDs.',
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
        name: 'replan_capsule',
        description: 'Use only for an existing multi-occasion capsule when a constraint changes. For one staged outfit, use the add, remove, or replace tools. Preserve locked pieces, reject exclusions, apply owned-versus-buy labels, update all 2 to 4 looks atomically, recalculate spend and reuse, and show a visible before/after explanation. Read the current state first and send the complete revised looks. This never changes the bag.',
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
        name: 'set_look_size',
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
        name: 'add_look_item',
        description: 'Incrementally add one catalog product to the currently visible staged look, or to the active look in a staged capsule, without restaging its existing pieces. Call search_catalog first. The product must match the active collection and use an empty garment slot; use replace_look_item when that slot is occupied. Up to four accessories can be added. This does not change the shopping bag.',
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
        name: 'remove_look_item',
        description: 'Remove one specific catalog product from the currently visible staged look, or from the active look in a staged capsule. Call read_style_state with view look first to inspect the staged product IDs. This updates the garment board and selected-piece ledger but does not change the shopping bag.',
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
        name: 'replace_look_item',
        description: 'Replace one specific product in the currently visible staged look, or in the active look of a staged capsule, with a catalog product from the same collection and garment slot. Call search_catalog first for the replacement. This updates the garment board and selected-piece ledger but does not change the shopping bag.',
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
        name: 'read_bag',
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
        name: 'read_promotions',
        description: 'Read authoritative promotion terms and evaluate each offer against the current visible shopping bag. Returns eligibility, amount still needed, estimated savings, and applied status. This does not change the bag.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute(input) {
          return readPromotionsRef.current(input);
        },
      });

      for (const policyTool of createPolicyWebMcpTools(
        (input) => readPolicyRef.current(input),
        (input) => checkReturnWindowRef.current(input),
      )) register(policyTool);

      register({
        name: 'apply_promotion',
        description: 'Validate and apply one promotion code to the visible shopping bag after the user asks to use it. The bag must satisfy the offer terms. This updates the displayed discount and total but does not begin checkout, place an order, or collect payment.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', minLength: 1, maxLength: 32, description: 'Promotion code returned by read_promotions.' },
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
        name: 'add_item_to_bag',
        description: 'Add exactly one unit of one catalog product directly to the visible shopping bag. Call search_catalog first for ordinary discovery. If the product is already present, its quantity increases by one. An optional size overrides the visible Style Studio size. This does not add the rest of the staged look or begin checkout.',
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
        name: 'adjust_bag_quantity',
        description: 'Increase or decrease one existing shopping-bag product line by exactly one unit. Call read_bag first. Use delta 1 to add one unit or delta -1 to remove one unit. Decreasing a quantity of one removes that product line. This does not begin checkout.',
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
        name: 'set_bag_item_size',
        description: 'Change the size stored on one existing shopping-bag product line without changing its quantity or the staged Style Studio size. Call read_bag first. This does not begin checkout.',
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
        name: 'remove_bag_items',
        description: 'Remove complete product lines from the shopping bag by catalog product ID. Call read_bag first. This changes bag state but does not begin checkout or place an order.',
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
        name: 'clear_bag',
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
        name: 'add_look_to_bag',
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
