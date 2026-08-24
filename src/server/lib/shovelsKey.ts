import {
  clearAppSetting,
  getSetting,
  getSettingStatus,
  loadAppSettings,
  maskKey,
  setAppSetting,
  settingStatus,
} from './appSettings.js';

export { maskKey, loadAppSettings as loadPersistedShovelsKey };

export function getShovelsApiKey(): string {
  return getSetting('shovels_api_key');
}

export function hasShovelsApi(): boolean {
  return Boolean(getShovelsApiKey());
}

export function shovelsKeyStatus() {
  return settingStatus('shovels_api_key');
}

export async function getShovelsKeyStatus() {
  await loadAppSettings();
  return getSettingStatus('shovels_api_key');
}

export async function setShovelsApiKey(opts: {
  api_key: string;
  set_by?: string;
  persist?: boolean;
}): Promise<Record<string, unknown>> {
  const result = await setAppSetting({
    key: 'shovels_api_key',
    api_key: opts.api_key,
    set_by: opts.set_by,
    persist: opts.persist,
  });
  if (result.ok) {
    result.assistant_instructions =
      'Key is set. Never repeat the full key in chat. Show only the masked fingerprint, then call shovels_estimate_credits if they want a credit quote.';
  }
  return result;
}

export async function clearShovelsApiKey(opts: { set_by?: string } = {}): Promise<Record<string, unknown>> {
  return clearAppSetting({ key: 'shovels_api_key', set_by: opts.set_by });
}
