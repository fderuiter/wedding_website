export function sanitizeContributor(contributor: any) {
  if (!contributor) return contributor;
  const { email, ...rest } = contributor;
  return rest;
}

export function sanitizeRegistryItem(item: any) {
  if (!item) return item;
  const result = { ...item };
  if ('contributors' in item && item.contributors !== undefined && Array.isArray(item.contributors)) {
    result.contributors = item.contributors.map(sanitizeContributor);
  }
  return result;
}

export function sanitizeRegistryItems(items: any) {
  if (!items) return items;
  if (Array.isArray(items)) {
    return items.map(sanitizeRegistryItem);
  }
  return sanitizeRegistryItem(items);
}

export function maskContributor(contributor: any) {
  if (!contributor) return contributor;
  const { email, ...rest } = contributor;
  return {
    ...rest,
    name: 'Anonymous',
    amount: 'Anonymous',
    date: 'Anonymous',
  };
}

export function maskRegistryItem(item: any) {
  if (!item) return item;
  const result = { ...item };
  if ('purchaserName' in item && item.purchaserName) {
    result.purchaserName = 'Anonymous';
  }
  if ('contributors' in item && item.contributors !== undefined && Array.isArray(item.contributors)) {
    result.contributors = item.contributors.map(maskContributor);
  }
  return result;
}

export function maskRegistryItems(items: any) {
  if (!items) return items;
  if (Array.isArray(items)) {
    return items.map(maskRegistryItem);
  }
  return maskRegistryItem(items);
}
