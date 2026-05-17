import { useState } from 'react';
import { apiFetch } from './api';
import { defaultReferenceValues, mergeReferenceValueState, normalizeReferenceValuePayload } from './referenceValues';
import type {
  ApiResponse,
  FeatureFlags,
  ReferenceValue,
  ReferenceValueState,
} from '../shared/domain';

interface ReferenceValuesControllerOptions {
  features: FeatureFlags;
  csrfToken: () => string;
}

export function useReferenceValuesController({ features, csrfToken }: ReferenceValuesControllerOptions) {
  const [referenceValues, setReferenceValues] = useState<ReferenceValueState>(defaultReferenceValues);

  function resetReferenceValues() {
    setReferenceValues(defaultReferenceValues);
  }

  async function loadReferenceValues() {
    if (!features.referenceValueHints) {
      setReferenceValues(defaultReferenceValues);
      return defaultReferenceValues;
    }
    const response = await apiFetch<ApiResponse<ReferenceValueState>>(
      '/api/reference-values?types=deal_name,source,card_brand&limit=200',
    );
    const nextValues = normalizeReferenceValuePayload(response.data);
    setReferenceValues(nextValues);
    return nextValues;
  }

  async function upsertReferenceValues(values: ReferenceValue[] = []) {
    if (!features.referenceValueHints || !values.length) {
      return [];
    }
    const response = await apiFetch<ApiResponse<ReferenceValue[]>>('/api/reference-values', {
      method: 'POST',
      body: { values },
      csrfToken: csrfToken(),
    });
    setReferenceValues((current) => mergeReferenceValueState(current, response.data || []));
    return response.data || [];
  }

  return {
    referenceValues,
    resetReferenceValues,
    loadReferenceValues,
    upsertReferenceValues,
  };
}
