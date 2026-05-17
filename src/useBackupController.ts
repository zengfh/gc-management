import { useState } from 'react';
import { apiDownload, apiFetch } from './api';
import type {
  ApiPayload,
  ImportSummary,
  PortableExportPayload,
} from './appTypes';
import { defaultBackupSettings } from './defaults';
import { errorMessage } from './display';
import type {
  ApiResponse,
  BackupSettings,
} from '../shared/domain';

interface BackupControllerOptions {
  csrfToken: () => string;
  onImported: () => Promise<void>;
}

export function useBackupController({ csrfToken, onImported }: BackupControllerOptions) {
  const [backupSettings, setBackupSettings] = useState(defaultBackupSettings);
  const [backupSettingsLoading, setBackupSettingsLoading] = useState(false);
  const [backupSettingsLoaded, setBackupSettingsLoaded] = useState(false);
  const [backupSettingsError, setBackupSettingsError] = useState('');

  function resetBackupState() {
    setBackupSettings(defaultBackupSettings);
    setBackupSettingsLoaded(false);
    setBackupSettingsError('');
  }

  async function loadBackupSettings() {
    setBackupSettingsLoading(true);
    setBackupSettingsError('');
    try {
      const response = await apiFetch<ApiResponse<BackupSettings>>('/api/settings/backup');
      setBackupSettings(response.data || defaultBackupSettings);
      setBackupSettingsLoaded(true);
      return response;
    } catch (caught) {
      setBackupSettingsError(errorMessage(caught));
      return null;
    } finally {
      setBackupSettingsLoading(false);
    }
  }

  async function updateBackupSettings(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<BackupSettings>>('/api/settings/backup', {
      method: 'PUT',
      body: payload,
      csrfToken: csrfToken(),
    });
    setBackupSettings(response.data || defaultBackupSettings);
    setBackupSettingsLoaded(true);
    return response;
  }

  async function exportPlaintext(payload: ApiPayload) {
    return apiFetch<ApiResponse<PortableExportPayload>>('/api/backup/export', {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
  }

  async function exportEncrypted(payload: ApiPayload) {
    return apiFetch<ApiResponse<PortableExportPayload>>('/api/backup/export-encrypted', {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
  }

  async function exportRawDatabase(payload: ApiPayload) {
    return apiDownload('/api/backup/db-file', {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
  }

  async function importBackup(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<{ summary: ImportSummary }>>('/api/backup/import', {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
    await onImported();
    return response;
  }

  return {
    backupSettings,
    backupSettingsLoading,
    backupSettingsLoaded,
    backupSettingsError,
    resetBackupState,
    loadBackupSettings,
    updateBackupSettings,
    exportPlaintext,
    exportEncrypted,
    exportRawDatabase,
    importBackup,
  };
}
