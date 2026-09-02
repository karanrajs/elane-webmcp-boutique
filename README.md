# ÉLANE Clothing Boutique

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/Live_demo-ChatGPT_Sites-7b2d3b.svg)](https://elane-clothing-boutique.karanrajs.chatgpt.site)

ÉLANE is a proof of agent-ready commerce: one clothing boutique designed for people to browse visually and for AI agents to help those people complete a shopping task. A shopper can plan outfits for several occasions while accounting for budget, weather, dress code, colour preferences, and clothes they already own. The same editorial storefront exposes 21 native WebMCP tools for structured catalog discovery, styling, sizing, policy checks, promotion, and shopping-bag actions.

**[Open the live application](https://elane-clothing-boutique.karanrajs.chatgpt.site)**

![ÉLANE — Dress for the life in motion](public/og.png)

## WebMCP case study

### User goal

A shopper begins with: “Can you help me to find office attire for this winter with the budget of 1500”. The agent turns that broad intent into a practical winter look within the shopper’s CAD 1,500 budget using the current site context and ÉLANE’s structured catalog data. The shopper can then guide the result with simple follow-up requests: change the trouser colour, set the size, add the approved look to the bag, and check for an eligible discount.

### Why this is a strong fit for WebMCP

Fashion shopping is a stateful, multi-step task. The agent must translate the shopper’s climate and dress-code context into garment searches, compare structured product attributes, assemble compatible slots, preserve the current look while replacing one item, track the selected size, distinguish staging from a bag mutation, and evaluate a promotion against the resulting subtotal.

A visual storefront remains important for photography, editorial discovery, and the character of the retailer. It is not, however, a dependable data contract for an agent: products, sizes, and offers may be distributed across collection pages, drawers, banners, and bag screens. WebMCP lets ÉLANE expose those existing site capabilities as explicit tools while keeping the human interface intact.

### How WebMCP creates a better user experience

Instead of translating a shopping goal into filters, page navigation, and repeated comparisons, the shopper can describe the outcome they want. The agent uses ÉLANE’s structured catalog and store actions to find matching pieces, compose a visible look, respond to style changes, confirm sizing, and evaluate available offers in the same storefront.

Every step remains visible and bounded. The shopper reviews the recommendation, refines the style, and decides what enters the bag, while the agent handles structured discovery, product matching, and store-specific actions. This reduces navigation and comparison work without removing the retailer’s visual experience or the shopper’s control.

### Initial state and boundaries

- The shopper is viewing ÉLANE, where the page has already registered its WebMCP tools.
- Catalog, state, bag, and promotion reads return structured information without changing the page.
- Staging and replacing garments update the visible Style Studio but never change the shopping bag.
- Adding the look requires an explicit shopper request. Reading an eligible promotion does not authorize applying it.
- Checkout is demonstrational; the site does not collect payment or place an order.

### What the shopper and agent do together

1. The shopper states a broad goal. The agent turns it into working search criteria and begins with read-only store tools.
2. The agent reads the current Style Studio state and searches the catalog by collection, garment slot, colour, season, and product intent.
3. The agent stages a proposed look. ÉLANE updates the visible garment board and returns a structured result confirming that the bag did not change.
4. The shopper asks to change the trousers from brown to charcoal. The agent searches for a compatible charcoal `Bottom` and replaces only that staged item.
5. The shopper chooses size M. The agent sets or confirms the visible Style Studio size without touching the bag.
6. The shopper explicitly asks to add the look and check for a discount. The agent adds the staged pieces, verifies the visible bag, and reads promotion eligibility.
7. The agent explains the eligible offer and estimated savings. Applying the code would require a separate shopper instruction.

This collaboration was difficult to make reliable with screen navigation alone. The shopper contributes intent, taste, corrections, and approval; the agent contributes structured search, constraint tracking, site-specific actions, and calculation. Both work against the same visible page state.

### What was verified

In the shopper-observed interaction, the agent translated the broad office-attire request into a starting recommendation and used ÉLANE’s site tools to present it in the visible Style Studio.

A separate WebMCP runtime test verified structured catalog search, staging the initial look, replacing only the trousers, confirming size M, adding the approved look to the bag, reading the bag, and evaluating promotion eligibility. It also confirmed the visible Style Studio and bag updates, the `bagChange: none` boundary during staging, and the final CAD totals.

### How WebMCP is implemented

ÉLANE registers 21 imperative, page-scoped storefront tools from [`app/components/atelier-webmcp.tsx`](app/components/atelier-webmcp.tsx). The Delivery & Returns route also mounts the relevant `read_policy` and `check_return_window` tools through [`app/components/policy-webmcp.tsx`](app/components/policy-webmcp.tsx). Both components feature-detect `document.modelContext`, register closed input schemas and side-effect annotations, and use an `AbortController` for lifecycle cleanup. There is no remote WebMCP server in this architecture.

Each tool delegates to a validated handler in [`app/page.tsx`](app/page.tsx). Read-only handlers return structured catalog, state, bag, promotion, or policy data without changing the UI. Mutating handlers update the same React state used by the human interface, wait for the relevant visible transition, and then return a concise result to the agent. [`app/policies.ts`](app/policies.ts) is the shared authority for the visible legal pages and date-aware return checks. [`app/webmcp-contract.ts`](app/webmcp-contract.ts) enforces pagination and output budgets, while [`scripts/verify-webmcp.mjs`](scripts/verify-webmcp.mjs) checks the registered surface for drift.

### Search-first, proof-complete catalog discovery

ÉLANE treats pagination as reliability infrastructure rather than a feature to showcase. `read_catalog` defaults to a compact `overview` containing collection counts, garment-slot facets, the price range, compatibility rules, and explicit routing guidance. For an ordinary shopping request, the agent then calls `search_catalog` with the shopper’s intent, collection, garment slot, and budget instead of walking the complete catalog.

When exhaustive coverage is genuinely required, the same `read_catalog` tool accepts `view: products` and returns denser eight-product pages. Each page includes `totalCount` and `nextOffset`, so an agent can prove that it reached the end without receiving a silently truncated result. Ranked search remains capped at six richer results per page. Both paths stay below ÉLANE’s 1,300-character safety target and 1,500-character hard response limit.

This two-lane contract is the distinctive implementation choice: **ranked search for shopper speed, deterministic pagination for completeness**. It preserves the existing 21-tool surface, avoids a decorative overview tool, reduces a full 88-product read from 15 calls to 11, and keeps every catalog response bounded enough for dependable agent reasoning.

## Technology

- React 19 and Next.js-compatible App Router APIs
- Vinext and Vite for a Cloudflare Workers-compatible build
- TypeScript in strict mode
- Tailwind CSS 4 for the CSS processing pipeline
- Native imperative WebMCP
- OpenAI Sites hosting configuration

Node.js 22.13 or newer is required.

## Local setup

```bash
git clone https://github.com/karanrajs/elane-clothing-boutique.git
cd elane-clothing-boutique
npm ci
npm run dev
```

Open the local URL printed by Vinext. No environment variables or external services are required for the current experience.

### Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Vinext development server. |
| `npm run build` | Produce the production Cloudflare-compatible build. |
| `npm run start` | Start the built application. |

## Architecture

```text
app/
├── page.tsx                         UI, client state, validation, and tool handlers
├── catalog.ts                      Catalog data, search ranking, slots, and asset mapping
├── policies.ts                     Terms, returns, refunds, and date-check authority
├── returns/page.tsx                Customer-facing delivery and returns policy
├── terms/page.tsx                  Customer-facing terms and conditions
├── webmcp-contract.ts              Shared pagination and output-budget invariants
├── components/
│   ├── atelier-webmcp.tsx          Storefront WebMCP registration and lifecycle
│   └── policy-webmcp.tsx           Shared policy tools and legal-route registration
├── globals.css                     Shared theme and responsive interface styles
└── layout.tsx                      Metadata and document shell

public/
├── garment-board-layers/           Individual transparent garment assets
├── garment-board-sprites/          Catalog-wide garment-board sprite sheets
└── elane-*.{jpg,png}                Storefront catalog and brand imagery
```

The browser is the application boundary. Catalog rules live in `catalog.ts`, visible shopping state and validated actions live in `page.tsx`, and `atelier-webmcp.tsx` is the thin WebMCP adapter between an agent and that state. WebMCP remains an enhancement: browsers without `document.modelContext` still receive the complete human-operated storefront.

## WebMCP tool inventory

Tool identifiers use concise, verb-first `snake_case` and stay within WebMCP’s portable name character set. Registrations omit the optional `title`, allowing ChatGPT to show the identifier as the heading, derive Read or Write from `readOnlyHint`, and place the tool description beneath it.

### Catalog and styling

| Tool | Kind | Purpose |
| --- | --- | --- |
| `read_catalog` | Read | Return a compact overview by default or dense, proof-complete product pages for exhaustive reads. |
| `read_style_state` | Read | Return one compact view of the current look, capsule, constraints, or customer product lists. |
| `search_catalog` | Read | Return one ranked page for a natural-language name, colour, garment, or style search. |
| `stage_look` | Stage | Replace the visible board with one validated women’s or men’s look. |
| `set_look_size` | Configure | Change the displayed size without changing the bag. |
| `add_look_item` | Configure | Add one compatible product to an empty slot in the current look. |
| `remove_look_item` | Configure | Remove one unlocked product from the current look. |
| `replace_look_item` | Configure | Replace one product with another from the same collection and slot. |

### Advanced capsule planning (optional)

The core WebMCP journey works with one staged look and does not depend on capsule planning. Use these advanced tools only when a shopper needs coordinated options for two or more occasions, shared-piece budget accounting, or a constraint-aware replan.

| Tool | Kind | Purpose |
| --- | --- | --- |
| `stage_capsule` | Stage | Batch-stage two to four occasion-specific looks with an optional budget. |
| `replan_capsule` | Configure | Atomically revise a capsule while preserving locked pieces and applying new constraints. |

### Shopping bag

| Tool | Kind | Purpose |
| --- | --- | --- |
| `read_bag` | Read | Return one page of bag lines plus quantities, sizes, and CAD totals. |
| `read_promotions` | Read | Return authoritative promotion terms and current-bag eligibility without changing state. |
| `read_policy` | Read | Read terms, returns, refunds, delivery, order, or promotion conditions from the shared policy authority. |
| `check_return_window` | Read | Calculate a return deadline and assess supplied item conditions without authorizing a return. |
| `apply_promotion` | Configure | Apply an eligible promotion code to the visible bag totals after user intent. |
| `add_item_to_bag` | Complete | Add one catalog item directly to the bag. |
| `add_look_to_bag` | Complete | Add every item in the current look or a selected capsule look. |
| `adjust_bag_quantity` | Configure | Increase or decrease one bag line by one unit. |
| `set_bag_item_size` | Configure | Change the size of one existing bag line. |
| `remove_bag_items` | Configure | Remove selected product lines. |
| `clear_bag` | Configure | Clear the complete bag after an explicit request. |

## Example agent-assisted shopping sequence

This is the three-prompt use case for the demo video. It shows the agent translating an occasion and budget into a staged look, making one precise revision, and completing only the bag and promotion actions the shopper explicitly approves.

1. **Prompt 1:** “Can you help me find one polished smart-casual outfit for OpenAI DevDay 2026 in San Francisco, within a budget of CAD 1,500, and stage it in the Style Studio?”
2. **Prompt 2:** “Change the pant to light colour and set the size to M.”
3. **Prompt 3:** “Add this approved outfit to my shopping bag and check and apply if there is an eligible promotional offer.”

Prompt 1 authorizes research and Style Studio staging, not a bag change. Prompt 2 authorizes the trouser replacement and Style Studio size change. Prompt 3 authorizes adding the approved outfit, checking the current bag against authoritative offer terms, and applying an eligible offer; it does not authorize checkout, payment, or order placement.

```mermaid
sequenceDiagram
    actor Shopper
    participant Agent as AI shopping agent
    participant Site as ÉLANE site
    participant UI as ÉLANE site UI

    Note over Site,UI: The page has registered its WebMCP tools
    Shopper->>Agent: Find one polished smart-casual outfit for OpenAI DevDay 2026 in San Francisco, within CAD 1,500, and stage it in the Style Studio
    Note over Agent: Translate the occasion, city, dress code, and CAD 1,500 budget into search criteria

    Agent->>Site: read_style_state(view summary)
    Site-->>Agent: Current model, size, presentation, and staged IDs

    loop Search Top, Bottom, Layer, and Accessory
        Agent->>Site: search_catalog(query polished smart-casual DevDay San Francisco, model man, slot)
        Site-->>Agent: status ready and ranked product IDs
    end

    Agent->>Site: stage_look(top 51, bottom 69, layer 54, accessory 86)
    Site->>UI: Show the selected pieces in Style Studio
    UI-->>Site: Garment board rendered
    Site-->>Agent: status composed, preview visible, bagChange none
    Agent-->>Shopper: The CAD 1,195 DevDay look is visible and within budget

    Shopper->>Agent: Change the pant to light colour and set the size to M
    Agent->>Site: search_catalog(query light-colour trousers, model man, slot Bottom)
    Site-->>Agent: Single-Pleat Chino in Stone, product 64, CAD 225
    Agent->>Site: replace_look_item(product 69, replacement 64)
    Site->>UI: Replace only the staged trousers
    UI-->>Site: Revised garment board rendered
    Site-->>Agent: status replaced, bottom 64, bagChange none
    Agent->>Site: set_look_size(size M)
    Site->>UI: Show size M in Style Studio
    UI-->>Site: Selected size rendered
    Site-->>Agent: status unchanged or updated, size M, bagChange none
    Agent-->>Shopper: The light-trouser look is visible in size M at CAD 1,110 and the bag is unchanged

    Shopper->>Agent: Add this approved outfit to my shopping bag and check and apply if there is an eligible promotional offer
    Agent->>Site: add_look_to_bag(size M)
    Site->>UI: Add the approved pieces and open the bag
    UI-->>Site: Bag rendered with four size-M lines
    Site-->>Agent: status added, bag visible, subtotal CAD 1,110
    Agent->>Site: read_bag(offset 0, limit 6)
    Site-->>Agent: Four lines, size M, subtotal CAD 1,110
    Agent->>Site: read_promotions()
    Site-->>Agent: ATELIER15 eligible, savings CAD 167, applied false
    Agent->>Site: apply_promotion(code ATELIER15)
    Site->>UI: Apply the eligible offer to the visible bag totals
    UI-->>Site: Discount CAD 167 and estimated total CAD 943 rendered
    Site-->>Agent: ATELIER15 applied, checkout not started
    Agent-->>Shopper: The approved outfit is in the bag and the eligible offer is applied; estimated total CAD 943

    Note over Shopper,Agent: The workflow ends in the bag; no checkout, payment, or order placement
```

## State and production boundaries

- The staged look or capsule, active look, locks, owned and excluded pieces, size, and bag are saved in versioned `localStorage` and restored after refresh on the same browser and device. There is no account or cross-device sync.
- Checkout is a demonstration; there is no payment processor, account system, database, or order submission.
- Product styling uses a garment-only editorial board, not body or fit simulation.

## License

Source code is available under the [MIT License](LICENSE). ÉLANE names and visual assets are included as project demonstration material.
