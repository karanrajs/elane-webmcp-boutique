'use client';

import { useEffect } from 'react';
import {
  checkReturnWindowFromWebMcp,
  readPolicyFromWebMcp,
} from '../policies';
import { enforceWebMcpOutputBudget } from '../webmcp-contract';

type PolicyToolHandler = (input: unknown) => unknown | Promise<unknown>;

type WebMcpTool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  execute: PolicyToolHandler;
};

type WebMcpModelContext = {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

type WebMcpDocument = Document & { readonly modelContext?: WebMcpModelContext };

export function createPolicyWebMcpTools(
  readPolicy: PolicyToolHandler,
  checkReturnWindow: PolicyToolHandler,
): WebMcpTool[] {
  return [
    {
      name: 'read_policy',
      description: 'Read authoritative ÉLANE terms, returns, refunds, delivery, order, or promotion conditions. Choose one section for full details, or all for a concise overview. This does not change the page.',
      inputSchema: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            enum: ['all', 'returns', 'refunds', 'delivery', 'orders', 'promotions', 'terms'],
            default: 'all',
            description: 'Policy section to read. Use returns for the complete return conditions.',
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: readPolicy,
    },
    {
      name: 'check_return_window',
      description: 'Calculate the exact return deadline from a delivery date and assess supplied item conditions against ÉLANE policy. Missing condition facts produce needs-more-information, not approval. This does not start or authorize a return.',
      inputSchema: {
        type: 'object',
        properties: {
          deliveryDate: {
            type: 'string',
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            description: 'Confirmed delivery date in YYYY-MM-DD format.',
          },
          asOfDate: {
            type: 'string',
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            description: 'Optional assessment date in YYYY-MM-DD. Defaults to today in Toronto.',
          },
          itemCondition: {
            type: 'string',
            enum: ['unused_unworn', 'opened_or_worn', 'defective_or_incorrect'],
            description: 'Current merchandise condition, when known.',
          },
          tagsAttached: {
            type: 'boolean',
            description: 'Whether the original tags remain attached.',
          },
          proofOfPurchase: {
            type: 'boolean',
            description: 'Whether a receipt, confirmation, or other proof is available.',
          },
          itemType: {
            type: 'string',
            enum: ['standard', 'gift_card', 'personalized_or_altered', 'final_sale', 'intimate_seal_broken'],
            description: 'Item-policy category, when known.',
          },
        },
        required: ['deliveryDate'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: checkReturnWindow,
    },
  ];
}

export function PolicyWebMCP() {
  useEffect(() => {
    const context = (document as WebMcpDocument).modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const reportError = (error: unknown) => {
      console.error('Unable to register an ÉLANE policy WebMCP tool.', error);
    };

    try {
      for (const tool of createPolicyWebMcpTools(readPolicyFromWebMcp, checkReturnWindowFromWebMcp)) {
        const execute = tool.execute;
        const budgetedTool = {
          ...tool,
          async execute(input: unknown) {
            return enforceWebMcpOutputBudget(tool.name, await execute(input));
          },
        };
        void Promise.resolve(context.registerTool(budgetedTool, { signal: lifecycle.signal })).catch(reportError);
      }
    } catch (error) {
      reportError(error);
    }

    return () => lifecycle.abort();
  }, []);

  return null;
}
