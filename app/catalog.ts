export type Product = {
  id: number;
  name: string;
  category: string;
  audience: 'Women' | 'Men';
  color: string;
  price: number;
  image: string;
  spriteColumn: 0 | 1 | 2 | 3;
  spriteRow: 0 | 1;
  garmentBoardAsset: {
    image: string;
    sprite?: {
      column: 0 | 1 | 2 | 3;
      row: 0 | 1;
      background: 'checkerboard' | 'warm-cream';
    };
  };
};

export type StyleSlot = 'Top' | 'Bottom' | 'Dress' | 'Layer' | 'Accessory';
export type ModelId = 'woman' | 'man';
export type StyleSelections = Partial<Record<Exclude<StyleSlot, 'Accessory'>, number>> & {
  Accessory?: number[];
};

type ProductSeed = readonly [name: string, category: string, color: string, price: number];

export const styleGroupLabels: Record<StyleSlot, string> = {
  Top: 'Tops & knitwear',
  Bottom: 'Bottoms',
  Dress: 'Dresses',
  Layer: 'Outer layers',
  Accessory: 'Accessories',
};

const productSearchStopWords = new Set([
  'a', 'an', 'and', 'around', 'at', 'by', 'for', 'from', 'in', 'me', 'of', 'on',
  'or', 'over', 'please', 'show', 'the', 'to', 'under', 'with',
]);

const productSearchIntentGroups = [
  ['bag', 'handbag', 'tote'],
  ['coat', 'trench', 'peacoat', 'parka', 'raincoat', 'outerwear'],
  ['jacket', 'blazer', 'overshirt', 'outerwear', 'tailoring'],
  ['knit', 'knitwear', 'sweater', 'cashmere', 'merino', 'cardigan', 'crewneck', 'turtleneck', 'mockneck', 'polo'],
  ['pant', 'trouser', 'chino', 'jean', 'denim', 'bottom'],
  ['shirt', 'blouse', 'top', 'tee', 'camisole'],
  ['red', 'oxblood', 'burgundy', 'rust', 'plum'],
] as const;

function normalizeSearchToken(token: string) {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function tokenizeSearchText(value: string) {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(normalizeSearchToken);
}

const productSearchAliases = new Map<string, Set<string>>();
productSearchIntentGroups.forEach((group) => {
  const normalizedGroup = group.map(normalizeSearchToken);
  normalizedGroup.forEach((term) => {
    const aliases = productSearchAliases.get(term) ?? new Set<string>();
    normalizedGroup.forEach((alias) => {
      if (alias !== term) aliases.add(alias);
    });
    productSearchAliases.set(term, aliases);
  });
});

export function normalizeProductSearchTerms(rawQuery: string) {
  return Array.from(new Set((rawQuery.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((term) => !productSearchStopWords.has(term))
    .map(normalizeSearchToken)));
}

function tokenMatchScore(queryTerm: string, fieldToken: string) {
  if (queryTerm === fieldToken) return 4;
  if (queryTerm.length >= 3 && (fieldToken.startsWith(queryTerm) || queryTerm.startsWith(fieldToken))) return 3;
  const aliases = productSearchAliases.get(queryTerm);
  if (!aliases) return 0;
  if (aliases.has(fieldToken)) return 2.5;
  if (queryTerm.length >= 3 && Array.from(aliases).some((alias) => (
    fieldToken.startsWith(alias) || alias.startsWith(fieldToken)
  ))) return 2;
  return 0;
}

export function productSearchScore(product: Product, rawQuery: string) {
  const trimmedQuery = rawQuery.trim();
  if (!trimmedQuery) return 0;
  const terms = normalizeProductSearchTerms(trimmedQuery);
  if (!terms.length) return null;

  const fields = [
    { value: product.name, weight: 8 },
    { value: product.color, weight: 9 },
    { value: product.category, weight: 7 },
    { value: slotForProduct(product), weight: 7 },
    { value: product.audience, weight: 2 },
  ];
  let score = 0;
  let matchedTermCount = 0;
  terms.forEach((term) => {
    let bestTermScore = 0;
    fields.forEach((field) => {
      tokenizeSearchText(field.value).forEach((fieldToken) => {
        bestTermScore = Math.max(bestTermScore, tokenMatchScore(term, fieldToken) * field.weight);
      });
    });
    if (bestTermScore > 0) {
      matchedTermCount += 1;
      score += bestTermScore;
    }
  });
  if (!matchedTermCount) return null;

  const coverage = matchedTermCount / terms.length;
  score += matchedTermCount * 12 + Math.round(coverage * 30);
  const normalizedPhrase = terms.join(' ');
  if (normalizedPhrase.length > 2 && fields.some((field) => (
    tokenizeSearchText(field.value).join(' ').includes(normalizedPhrase)
  ))) score += 24;
  return Math.round(score);
}

export function matchesProductSearch(product: Product, rawQuery: string) {
  return productSearchScore(product, rawQuery) !== null;
}

export function rankProductsBySearch<T extends Product>(items: readonly T[], rawQuery: string) {
  if (!rawQuery.trim()) return [...items];
  return items.flatMap((product) => {
    const score = productSearchScore(product, rawQuery);
    return score === null ? [] : [{ product, score }];
  }).toSorted((left, right) => right.score - left.score || left.product.id - right.product.id)
    .map(({ product }) => product);
}

const individualGarmentBoardAssets: Partial<Record<number, Product['garmentBoardAsset']>> = {
  1: {
    image: '/garment-board-layers/woman/1-sculpted-wool-blazer.webp',
  },
  2: {
    image: '/garment-board-layers/woman/2-oxblood-cashmere-crew.webp',
  },
  3: {
    image: '/garment-board-layers/woman/3-fluid-silk-camisole.webp',
  },
  4: {
    image: '/garment-board-layers/woman/4-column-midi-dress.webp',
  },
  5: {
    image: '/garment-board-layers/woman/5-pleated-wide-leg-trouser.webp',
  },
  27: {
    image: '/garment-board-layers/woman/27-sculpted-cotton-tee.png',
  },
  59: {
    image: '/garment-board-layers/man/59-heavyweight-cotton-tee.png',
  },
};

const garmentBoardSheetByCatalogImage: Record<string, string> = {
  '/elane-women-products.jpg': '/garment-board-sprites/women-01.png',
  '/elane-women-products-02.jpg': '/garment-board-sprites/women-02.png',
  '/elane-women-products-03.jpg': '/garment-board-sprites/women-03.png',
  '/elane-women-products-04.jpg': '/garment-board-sprites/women-04.png',
  '/elane-women-products-05.jpg': '/garment-board-sprites/women-05.png',
  '/elane-men-products.jpg': '/garment-board-sprites/men-01.png',
  '/elane-men-products-02.jpg': '/garment-board-sprites/men-02.png',
  '/elane-men-products-03.jpg': '/garment-board-sprites/men-03.png',
  '/elane-men-products-04.jpg': '/garment-board-sprites/men-04.png',
  '/elane-accessories.jpg': '/garment-board-sprites/accessories.png',
  '/elane-accessories-02.png': '/elane-accessories-02.png',
};
function spriteGarmentBoardAsset(
  catalogImage: string,
  column: Product['spriteColumn'],
  row: Product['spriteRow'],
): Product['garmentBoardAsset'] {
  const garmentBoardImage = garmentBoardSheetByCatalogImage[catalogImage];
  if (!garmentBoardImage) {
    throw new Error(`Missing garment-board sprite sheet for ${catalogImage}.`);
  }
  return {
    image: garmentBoardImage,
    sprite: {
      column,
      row,
      background: catalogImage === '/elane-accessories-02.png' ? 'warm-cream' : 'checkerboard',
    },
  };
}

function productSheet(
  image: string,
  audience: Product['audience'],
  startId: number,
  seeds: readonly ProductSeed[],
  spriteOffset = 0,
): Product[] {
  return seeds.map(([name, category, color, price], index) => {
    const spriteIndex = index + spriteOffset;
    const spriteColumn = (spriteIndex % 4) as Product['spriteColumn'];
    const spriteRow = Math.floor(spriteIndex / 4) as Product['spriteRow'];
    const productId = startId + index;
    return {
      id: productId,
      name,
      category,
      audience,
      color,
      price,
      image,
      spriteColumn,
      spriteRow,
      // Every catalog product maps to either an individual cutout or a stable
      // position in a garment-board sprite sheet.
      garmentBoardAsset: individualGarmentBoardAssets[productId]
        ?? spriteGarmentBoardAsset(image, spriteColumn, spriteRow),
    };
  });
}

export const products: Product[] = [
  ...productSheet('/elane-women-products.jpg', 'Women', 1, [
    ['Sculpted Wool Blazer', 'Tailoring', 'Ivory', 525],
    ['Oxblood Cashmere Crew', 'Knitwear', 'Oxblood', 295],
    ['Fluid Silk Camisole', 'Tops', 'Black', 195],
    ['Column Midi Dress', 'Dresses', 'Black', 495],
    ['Pleated Wide-Leg Trouser', 'Trousers', 'Bone', 275],
    ['Architectural Trench', 'Outerwear', 'Sand', 595],
    ['Bias-Cut Satin Skirt', 'Skirts', 'Pewter', 245],
    ['Fluid Poplin Blouse', 'Tops', 'Ivory', 195],
  ]),
  ...productSheet('/elane-men-products.jpg', 'Men', 9, [
    ['Italian Wool Overcoat', 'Outerwear', 'Charcoal', 695],
    ['Relaxed Poplin Shirt', 'Tops', 'Ivory', 175],
    ['Sage Atelier Overshirt', 'Outerwear', 'Sage', 295],
    ['Merino Mock Neck', 'Knitwear', 'Espresso', 195],
    ['Single-Pleat Trouser', 'Trousers', 'Graphite', 285],
    ['Soft-Shoulder Wool Blazer', 'Tailoring', 'Camel', 545],
    ['Merino Atelier Cardigan', 'Knitwear', 'Midnight', 245],
    ['Cotton Field Jacket', 'Outerwear', 'Stone', 375],
  ]),
  ...productSheet('/elane-women-products-02.jpg', 'Women', 17, [
    ['Double-Face Wrap Coat', 'Outerwear', 'Camel', 695],
    ['Ribbed Merino Turtleneck', 'Knitwear', 'Stone', 225],
    ['Draped Jersey Top', 'Tops', 'Cocoa', 145],
    ['Belted Shirt Dress', 'Dresses', 'Olive', 395],
    ['Tapered Wool Trouser', 'Trousers', 'Navy', 295],
    ['Cropped Boucle Jacket', 'Tailoring', 'Ecru', 475],
    ['Pleated Georgette Skirt', 'Skirts', 'Dusty Rose', 255],
    ['Silk Tie-Neck Blouse', 'Tops', 'Cream', 265],
  ]),
  ...productSheet('/elane-women-products-03.jpg', 'Women', 25, [
    ['Collarless Leather Jacket', 'Outerwear', 'Black', 795],
    ['Cashmere Atelier Cardigan', 'Knitwear', 'Heather Grey', 345],
    ['Sculpted Cotton Tee', 'Tops', 'White', 95],
    ['Ribbed Knit Midi Dress', 'Dresses', 'Deep Teal', 325],
    ['Barrel-Leg Jean', 'Denim', 'Indigo', 225],
    ['Pinstripe Waistcoat', 'Tailoring', 'Charcoal', 275],
    ['Wool A-Line Skirt', 'Skirts', 'Camel', 245],
    ['Linen Camp Shirt', 'Tops', 'Sky Blue', 175],
  ]),
  ...productSheet('/elane-women-products-04.jpg', 'Women', 33, [
    ['Cocoon Puffer Jacket', 'Outerwear', 'Oxblood', 425],
    ['Alpaca V-Neck Sweater', 'Knitwear', 'Moss', 295],
    ['Asymmetric Satin Top', 'Tops', 'Champagne', 225],
    ['Pleated Day Dress', 'Dresses', 'Saffron', 375],
    ['Fluid Cargo Trouser', 'Trousers', 'Khaki', 245],
    ['Satin-Lapel Tuxedo Blazer', 'Tailoring', 'Black', 595],
    ['Twill Midi Skirt', 'Skirts', 'Tobacco', 225],
    ['Ribbed Polo Knit', 'Knitwear', 'Cream', 195],
  ]),
  ...productSheet('/elane-women-products-05.jpg', 'Women', 41, [
    ['Longline Raincoat', 'Outerwear', 'Navy', 475],
    ['Cable Cashmere Vest', 'Knitwear', 'Oatmeal', 265],
    ['Silk Henley Blouse', 'Tops', 'Midnight', 245],
    ['Wrap Jersey Dress', 'Dresses', 'Plum', 295],
    ['Wide-Leg Corduroy Trouser', 'Trousers', 'Rust', 245],
    ['Cropped Linen Blazer', 'Tailoring', 'Natural', 425],
    ['Column Denim Skirt', 'Denim', 'Washed Black', 210],
    ['Pointelle Cardigan', 'Knitwear', 'Pale Blue', 195],
  ]),
  ...productSheet('/elane-men-products-02.jpg', 'Men', 49, [
    ['Double-Face Peacoat', 'Outerwear', 'Navy', 625],
    ['Fisherman-Rib Sweater', 'Knitwear', 'Oatmeal', 245],
    ['Oxford Atelier Shirt', 'Tops', 'Powder Blue', 185],
    ['Cotton Chore Jacket', 'Outerwear', 'Dark Olive', 345],
    ['Herringbone Trouser', 'Trousers', 'Brown', 295],
    ['Unstructured Wool Blazer', 'Tailoring', 'Ink', 550],
    ['Merino Long-Sleeve Polo', 'Knitwear', 'Burgundy', 225],
    ['Relaxed Selvedge Jean', 'Denim', 'Ecru', 225],
  ]),
  ...productSheet('/elane-men-products-03.jpg', 'Men', 57, [
    ['Italian Car Coat', 'Outerwear', 'Camel', 650],
    ['Shawl-Collar Cardigan', 'Knitwear', 'Forest', 285],
    ['Heavyweight Cotton Tee', 'Tops', 'White', 95],
    ['Denim Atelier Overshirt', 'Outerwear', 'Indigo', 275],
    ['Drawstring Wool Trouser', 'Trousers', 'Navy', 295],
    ['Double-Breasted Blazer', 'Tailoring', 'Grey', 595],
    ['Fine-Gauge Mock Neck', 'Knitwear', 'Rust', 195],
    ['Single-Pleat Chino', 'Trousers', 'Stone', 225],
  ]),
  ...productSheet('/elane-men-products-04.jpg', 'Men', 65, [
    ['Technical City Parka', 'Outerwear', 'Black', 495],
    ['Cashmere Crewneck', 'Knitwear', 'Marl Grey', 325],
    ['Striped Poplin Shirt', 'Tops', 'Blue', 185],
    ['Suede Atelier Overshirt', 'Outerwear', 'Tobacco', 695],
    ['Flannel Tailored Trouser', 'Trousers', 'Charcoal', 310],
    ['Velvet Evening Blazer', 'Tailoring', 'Deep Green', 625],
    ['Merino Half-Zip Knit', 'Knitwear', 'Cream', 225],
    ['Straight-Leg Selvedge Jean', 'Denim', 'Dark Indigo', 235],
  ]),
  ...productSheet('/elane-accessories.jpg', 'Women', 73, [
    ['Crescent Leather Bag', 'Accessories', 'Oxblood', 350],
    ['Silk Neck Scarf', 'Accessories', 'Ivory', 95],
    ['Sculptural Leather Belt', 'Accessories', 'Black', 145],
    ['Suede Atelier Beret', 'Accessories', 'Chocolate', 110],
  ]),
  ...productSheet('/elane-accessories.jpg', 'Women', 77, [
    ['Structured Leather Tote', 'Accessories', 'Black', 395],
  ], 4),
  ...productSheet('/elane-accessories.jpg', 'Men', 78, [
    ['Brushed Alpaca Scarf', 'Accessories', 'Moss', 175],
    ['Woven Leather Belt', 'Accessories', 'Espresso', 150],
    ['Ribbed Cashmere Beanie', 'Accessories', 'Charcoal', 115],
  ], 5),
  ...productSheet('/elane-accessories-02.png', 'Women', 81, [
    ['Crescent Leather Bag', 'Accessories', 'Forest', 350],
    ['Silk Neck Scarf', 'Accessories', 'Oxblood', 95],
    ['Sculptural Leather Belt', 'Accessories', 'Cognac', 145],
    ['Suede Atelier Beret', 'Accessories', 'Dusty Rose', 110],
  ]),
  ...productSheet('/elane-accessories-02.png', 'Men', 85, [
    ['Brushed Alpaca Scarf', 'Accessories', 'Camel', 175],
    ['Woven Leather Belt', 'Accessories', 'Black', 150],
    ['Ribbed Cashmere Beanie', 'Accessories', 'Burgundy', 115],
  ], 4),
  ...productSheet('/elane-accessories-02.png', 'Women', 88, [
    ['Structured Leather Tote', 'Accessories', 'Cognac', 395],
  ], 7),
];

export const productById = new Map(products.map((product) => [product.id, product]));
if (productById.size !== products.length) {
  throw new Error('Every ÉLANE catalog product must have a unique ID.');
}

export function slotForProduct(product: Product): StyleSlot {
  if (product.category === 'Dresses') return 'Dress';
  if (product.category === 'Trousers' || product.category === 'Skirts' || product.category === 'Denim') return 'Bottom';
  if (product.category === 'Accessories') return 'Accessory';
  if (product.category === 'Outerwear' || product.category === 'Tailoring') return 'Layer';
  return 'Top';
}

export function pickerGroupForProduct(product: Product) {
  if (product.category !== 'Accessories') return product.category;
  if (/Bag|Tote/.test(product.name)) return 'Bags';
  if (/Scarf/.test(product.name)) return 'Scarves';
  if (/Belt/.test(product.name)) return 'Belts';
  return 'Headwear';
}

export const defaultSelectionsByModel: Record<ModelId, StyleSelections> = {
  woman: { Top: 2, Bottom: 5 },
  man: { Top: 10, Bottom: 13 },
};
