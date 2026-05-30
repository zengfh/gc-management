import { useState } from 'react';
import { apiFetch } from './api';
import type {
  ApiPayload,
  CountSummary,
  NotificationTestSummary,
  PortableExportPayload,
} from './appTypes';
import {
  defaultDataPolicy,
  defaultSupportPolicy,
} from './defaults';
import { errorMessage } from './display';
import type {
  ApiResponse,
  AuthUser,
  DataPolicy,
  SupportPolicy,
  UserInvite,
} from '../shared/domain';

interface AdminControllerOptions {
  csrfToken: () => string;
  onDataDeleted: () => Promise<void>;
}

export function useAdminController({ csrfToken, onDataDeleted }: AdminControllerOptions) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [userInvites, setUserInvites] = useState<UserInvite[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [supportPolicy, setSupportPolicy] = useState(defaultSupportPolicy);
  const [supportPolicyLoading, setSupportPolicyLoading] = useState(false);
  const [supportPolicyLoaded, setSupportPolicyLoaded] = useState(false);
  const [supportPolicyError, setSupportPolicyError] = useState('');
  const [dataPolicy, setDataPolicy] = useState(defaultDataPolicy);
  const [dataPolicyLoading, setDataPolicyLoading] = useState(false);
  const [dataPolicyLoaded, setDataPolicyLoaded] = useState(false);
  const [dataPolicyError, setDataPolicyError] = useState('');

  function resetAdminState() {
    setUsers([]);
    setUserInvites([]);
    setUsersLoaded(false);
    setUsersError('');
    setSupportPolicy(defaultSupportPolicy);
    setSupportPolicyLoaded(false);
    setSupportPolicyError('');
    setDataPolicy(defaultDataPolicy);
    setDataPolicyLoaded(false);
    setDataPolicyError('');
  }

  async function loadUsers() {
    setUsersLoading(true);
    setUsersError('');
    try {
      const [response, invitesResponse] = await Promise.all([
        apiFetch<ApiResponse<AuthUser[]>>('/api/users'),
        apiFetch<ApiResponse<UserInvite[]>>('/api/users/invites'),
      ]);
      setUsers(Array.isArray(response.data) ? response.data : []);
      setUserInvites(Array.isArray(invitesResponse.data) ? invitesResponse.data : []);
      setUsersLoaded(true);
      return response;
    } catch (caught) {
      setUsersError(errorMessage(caught));
      return null;
    } finally {
      setUsersLoading(false);
    }
  }

  async function createInvite(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<UserInvite>>('/api/users/invites', {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
    setUserInvites((current) => [response.data, ...current.filter((invite) => invite.id !== response.data.id)]);
    setUsersLoaded(true);
    return response.data;
  }

  async function revokeInvite(inviteId: string) {
    const response = await apiFetch<ApiResponse<UserInvite>>(`/api/users/invites/${inviteId}`, {
      method: 'DELETE',
      csrfToken: csrfToken(),
    });
    setUserInvites((current) => current.filter((invite) => invite.id !== response.data.id));
    return response.data;
  }

  async function updateUser(userId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<AuthUser>>(`/api/users/${userId}`, {
      method: 'PUT',
      body: payload,
      csrfToken: csrfToken(),
    });
    setUsers((current) => current.map((user) => (user.id === response.data.id ? response.data : user)));
    return response.data;
  }

  async function loadSupportPolicy() {
    setSupportPolicyLoading(true);
    setSupportPolicyError('');
    try {
      const response = await apiFetch<ApiResponse<SupportPolicy>>('/api/admin/support-policy');
      setSupportPolicy(response.data || defaultSupportPolicy);
      setSupportPolicyLoaded(true);
      return response;
    } catch (caught) {
      setSupportPolicyError(errorMessage(caught));
      return null;
    } finally {
      setSupportPolicyLoading(false);
    }
  }

  async function updateSupportPolicy(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<SupportPolicy>>('/api/admin/support-policy', {
      method: 'PUT',
      body: payload,
      csrfToken: csrfToken(),
    });
    setSupportPolicy(response.data || defaultSupportPolicy);
    setSupportPolicyLoaded(true);
    return response;
  }

  async function loadDataPolicy() {
    setDataPolicyLoading(true);
    setDataPolicyError('');
    try {
      const response = await apiFetch<ApiResponse<DataPolicy>>('/api/admin/data-policy');
      setDataPolicy(response.data || defaultDataPolicy);
      setDataPolicyLoaded(true);
      return response;
    } catch (caught) {
      setDataPolicyError(errorMessage(caught));
      return null;
    } finally {
      setDataPolicyLoading(false);
    }
  }

  async function updateDataPolicy(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<DataPolicy>>('/api/admin/data-policy', {
      method: 'PUT',
      body: payload,
      csrfToken: csrfToken(),
    });
    setDataPolicy(response.data || defaultDataPolicy);
    setDataPolicyLoaded(true);
    return response;
  }

  async function exportAccountData(payload: ApiPayload) {
    return apiFetch<ApiResponse<PortableExportPayload>>('/api/admin/data-export', {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
  }

  async function runRetention(payload: ApiPayload) {
    return apiFetch<ApiResponse<{ counts?: CountSummary }>>('/api/admin/retention/run', {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
  }

  async function sendExpirationNotificationTest(payload: ApiPayload = {}) {
    return apiFetch<ApiResponse<NotificationTestSummary>>('/api/admin/notifications/expiration/test', {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
  }

  async function deleteAccountData(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<{ counts?: CountSummary }>>('/api/admin/data-delete', {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
    await onDataDeleted();
    return response;
  }

  return {
    users,
    userInvites,
    usersLoading,
    usersLoaded,
    usersError,
    supportPolicy,
    supportPolicyLoading,
    supportPolicyLoaded,
    supportPolicyError,
    dataPolicy,
    dataPolicyLoading,
    dataPolicyLoaded,
    dataPolicyError,
    resetAdminState,
    loadUsers,
    createInvite,
    revokeInvite,
    updateUser,
    loadSupportPolicy,
    updateSupportPolicy,
    loadDataPolicy,
    updateDataPolicy,
    exportAccountData,
    runRetention,
    sendExpirationNotificationTest,
    deleteAccountData,
  };
}
