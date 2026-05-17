import { useState } from 'react';
import { apiFetch } from './api';
import {
  criteriaValue,
  errorMessage,
} from './display';
import type {
  ApiResponse,
  AuditCriteria,
  AuditEvent,
} from '../shared/domain';

export function useAuditController() {
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');

  function resetAudit() {
    setAuditEvents([]);
    setAuditError('');
  }

  async function loadAudit(criteria: AuditCriteria = {}) {
    const params = new URLSearchParams();
    const entityType = criteriaValue(criteria.entityType);
    const action = criteriaValue(criteria.action);
    const from = criteriaValue(criteria.from);
    const to = criteriaValue(criteria.to);
    if (entityType) {
      params.set('entityType', entityType);
    }
    if (action) {
      params.set('action', action);
    }
    if (from) {
      params.set('from', from);
    }
    if (to) {
      params.set('to', to);
    }

    const query = params.toString() ? `?${params.toString()}` : '';
    setAuditLoading(true);
    setAuditError('');
    try {
      const response = await apiFetch<ApiResponse<AuditEvent[]>>(`/api/audit${query}`);
      setAuditEvents(response.data || []);
    } catch (caught) {
      setAuditError(errorMessage(caught));
    } finally {
      setAuditLoading(false);
    }
  }

  return {
    auditEvents,
    auditLoading,
    auditError,
    resetAudit,
    loadAudit,
  };
}
