export function sanitizeContributor(contributor: any) {
  if (!contributor) return contributor;
  const {
    email: _email,
    addressLine1: _addressLine1,
    addressLine2: _addressLine2,
    city: _city,
    state: _state,
    zipCode: _zipCode,
    country: _country,
    thankYouEmailSentAt: _thankYouEmailSentAt,
    confirmationEmailSentAt: _confirmationEmailSentAt,
    alertEmailSentAt: _alertEmailSentAt,
    reminderEmailSentAt: _reminderEmailSentAt,
    invitationCode: _invitationCode,
    ...rest
  } = contributor;
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
  return {
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
    result.contributors = item.contributors
      .filter((contributor: any) => {
        if (!contributor) return false;
        const status = typeof contributor.status === 'string' ? contributor.status.toUpperCase() : 'CONFIRMED';
        return status !== 'CANCELLED' && status !== 'REFUNDED';
      })
      .map(maskContributor);
  }
  return result;
}

