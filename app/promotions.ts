export const atelierPromotion = {
  code: 'ATELIER15',
  name: 'Atelier Event',
  description: 'Save 15% on an ÉLANE wardrobe of CAD 500 or more.',
  discountType: 'percentage' as const,
  discountPercent: 15,
  minimumSubtotalCad: 500,
  currency: 'CAD' as const,
  eligibleProductScope: 'All ÉLANE catalog products',
  exclusions: [] as string[],
  stackable: false,
  validThrough: '2026-12-31',
};

export function promotionSavingsCad(subtotalCad: number) {
  if (subtotalCad < atelierPromotion.minimumSubtotalCad) return 0;
  return Math.round(subtotalCad * atelierPromotion.discountPercent / 100);
}

export function promotionApplicationState(
  subtotalCad: number,
  appliedCode?: string,
): 'available' | 'applied' {
  if (appliedCode !== atelierPromotion.code) return 'available';
  return subtotalCad >= atelierPromotion.minimumSubtotalCad ? 'applied' : 'available';
}
