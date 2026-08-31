export const WEBMCP_OUTPUT_CHARACTER_LIMIT = 1500;
export const WEBMCP_SAFE_OUTPUT_TARGET = 1300;
export const WEBMCP_CATALOG_PAGE_LIMIT = 6;
export const WEBMCP_BAG_PAGE_LIMIT = 6;
export const WEBMCP_STATE_LIST_PAGE_LIMIT = 12;

export function pageForWebMcp<T>(items: T[], offset: number, limit: number) {
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;

  return {
    offset,
    limit,
    returnedCount: pageItems.length,
    totalCount: items.length,
    nextOffset: nextOffset < items.length ? nextOffset : null,
    items: pageItems,
  };
}

export function webMcpOutputCharacters(value: unknown) {
  return JSON.stringify(value).length;
}

export function enforceWebMcpOutputBudget<T>(toolName: string, value: T): T {
  const characters = webMcpOutputCharacters(value);
  if (characters > WEBMCP_OUTPUT_CHARACTER_LIMIT) {
    throw new Error(`${toolName} output exceeded the ${WEBMCP_OUTPUT_CHARACTER_LIMIT}-character limit.`);
  }
  return value;
}
