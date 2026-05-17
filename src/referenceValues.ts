import type {
  ReferenceReviewItem,
  ReferenceValue,
  ReferenceValueState,
  ReferenceValueType,
} from '../shared/domain';

export const referenceValueTypes = {
  dealName: 'deal_name',
  source: 'source',
  cardBrand: 'card_brand',
} as const;

export const defaultReferenceValues: ReferenceValueState = {
  [referenceValueTypes.dealName]: [],
  [referenceValueTypes.source]: [],
  [referenceValueTypes.cardBrand]: [],
};

export const addDealReferenceFields: Array<{
  field: 'name' | 'source' | 'cardBrand';
  type: ReferenceValueType;
  label: string;
}> = [
  { field: 'name', type: referenceValueTypes.dealName, label: 'Deal name' },
  { field: 'source', type: referenceValueTypes.source, label: 'Source' },
  { field: 'cardBrand', type: referenceValueTypes.cardBrand, label: 'Card brand' },
];

export function normalizeReferenceText(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function sortReferenceValues(values: ReferenceValue[]): ReferenceValue[] {
  return [...values].sort((a, b) => {
    const usageDelta = (b.usageCount || 0) - (a.usageCount || 0);
    if (usageDelta) {
      return usageDelta;
    }
    const updatedDelta = String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || ''));
    if (updatedDelta) {
      return updatedDelta;
    }
    return String(a.value || '').localeCompare(String(b.value || ''), undefined, { sensitivity: 'base' });
  });
}

export function mergeReferenceValueState(
  current: ReferenceValueState,
  incomingRows: ReferenceValue[] = [],
): ReferenceValueState {
  const next = {
    [referenceValueTypes.dealName]: [...(current?.[referenceValueTypes.dealName] || [])],
    [referenceValueTypes.source]: [...(current?.[referenceValueTypes.source] || [])],
    [referenceValueTypes.cardBrand]: [...(current?.[referenceValueTypes.cardBrand] || [])],
  };

  for (const row of incomingRows || []) {
    if (!row?.type) {
      continue;
    }
    const bucket = next[row.type];
    if (!bucket) {
      continue;
    }
    const normalized = normalizeReferenceText(row.value);
    const existingIndex = bucket.findIndex(
      (value) => normalizeReferenceText(value.value) === normalized,
    );
    if (existingIndex >= 0) {
      bucket[existingIndex] = row;
    } else {
      bucket.push(row);
    }
  }

  return {
    [referenceValueTypes.dealName]: sortReferenceValues(next[referenceValueTypes.dealName]),
    [referenceValueTypes.source]: sortReferenceValues(next[referenceValueTypes.source]),
    [referenceValueTypes.cardBrand]: sortReferenceValues(next[referenceValueTypes.cardBrand]),
  };
}

export function normalizeReferenceValuePayload(
  data: Partial<ReferenceValueState> | null | undefined,
): ReferenceValueState {
  const dealNameRows = data?.[referenceValueTypes.dealName];
  const sourceRows = data?.[referenceValueTypes.source];
  const cardBrandRows = data?.[referenceValueTypes.cardBrand];

  return {
    [referenceValueTypes.dealName]: Array.isArray(dealNameRows)
      ? sortReferenceValues(dealNameRows)
      : [],
    [referenceValueTypes.source]: Array.isArray(sourceRows)
      ? sortReferenceValues(sourceRows)
      : [],
    [referenceValueTypes.cardBrand]: Array.isArray(cardBrandRows)
      ? sortReferenceValues(cardBrandRows)
      : [],
  };
}

export function filterReferenceOptions(options: ReferenceValue[], query: string, limit = 8): ReferenceValue[] {
  const normalizedQuery = normalizeReferenceText(query);
  const ranked = (options || [])
    .filter((option) => {
      if (!option?.value) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return normalizeReferenceText(option.value).includes(normalizedQuery);
    })
    .map((option) => {
      const normalizedValue = normalizeReferenceText(option.value);
      let rank = 3;
      if (normalizedValue === normalizedQuery) {
        rank = 0;
      } else if (normalizedValue.startsWith(normalizedQuery)) {
        rank = 1;
      } else if (normalizedValue.includes(normalizedQuery)) {
        rank = 2;
      }
      return { option, rank };
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      const usageDelta = (b.option.usageCount || 0) - (a.option.usageCount || 0);
      if (usageDelta) {
        return usageDelta;
      }
      return String(a.option.value).localeCompare(String(b.option.value), undefined, { sensitivity: 'base' });
    });

  return ranked.slice(0, limit).map(({ option }) => option);
}

export function hasIndexedReferenceValue(options: ReferenceValue[], value: string): boolean {
  const normalized = normalizeReferenceText(value);
  return Boolean(normalized)
    && (options || []).some((option) => normalizeReferenceText(option.value) === normalized);
}

export function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (!left.length) {
    return right.length;
  }
  if (!right.length) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
  const current = Array(right.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (previous[rightIndex] ?? 0) + 1,
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? 0;
}

export function typoSuggestions(options: ReferenceValue[], value: string): ReferenceValue[] {
  const normalizedValue = normalizeReferenceText(value);
  if (normalizedValue.length < 3) {
    return [];
  }
  const maxDistance = normalizedValue.length >= 6 ? 2 : 1;

  return (options || [])
    .map((option) => ({
      option,
      distance: levenshteinDistance(normalizedValue, normalizeReferenceText(option.value)),
    }))
    .filter(({ distance }) => distance > 0 && distance <= maxDistance)
    .sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      return (b.option.usageCount || 0) - (a.option.usageCount || 0);
    })
    .slice(0, 3)
    .map(({ option }) => option);
}

export function buildReferenceReviewItems(
  form: { name: string; source: string; cardBrand: string },
  referenceValues: ReferenceValueState,
): ReferenceReviewItem[] {
  return addDealReferenceFields
    .map((config) => {
      const value = String(form[config.field] || '').trim();
      if (!value) {
        return null;
      }
      const options = referenceValues?.[config.type] || [];
      if (hasIndexedReferenceValue(options, value)) {
        return null;
      }
      return {
        key: `${config.type}:${normalizeReferenceText(value)}`,
        ...config,
        value,
        suggestions: typoSuggestions(options, value),
      };
    })
    .filter((item): item is ReferenceReviewItem => Boolean(item));
}

export function buildReferenceTouchValues(
  form: { name: string; source: string; cardBrand: string },
  referenceValues: ReferenceValueState,
  approvedItems: ReferenceReviewItem[] = [],
): ReferenceValue[] {
  const approvedKeys = new Set(
    (approvedItems || []).map((item) => `${item.type}:${normalizeReferenceText(item.value)}`),
  );
  const touched: ReferenceValue[] = [];
  const seen = new Set<string>();

  for (const config of addDealReferenceFields) {
    const value = String(form[config.field] || '').trim();
    if (!value) {
      continue;
    }
    const key = `${config.type}:${normalizeReferenceText(value)}`;
    const indexed = hasIndexedReferenceValue(referenceValues?.[config.type] || [], value);
    if (!indexed && !approvedKeys.has(key)) {
      continue;
    }
    if (!seen.has(key)) {
      seen.add(key);
      touched.push({ type: config.type, value });
    }
  }

  return touched;
}
