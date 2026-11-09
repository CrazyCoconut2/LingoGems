import { signal } from '@angular/core';
import { requestPersistentStorage, storageIsPersistent } from 'collection';

export const storageKept = signal<boolean | null>(null);
export const storageRefused = signal(false);
export const standaloneApp = signal(false);

let started = false;
let refreshing: Promise<boolean> | null = null;

export function startKeepingStorage(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  syncInstallState();
  window.addEventListener('appinstalled', onInstalled);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onVisible);
  watchDisplayMode();
  void refreshKeptStorage();
  void watchPermission();
}

export function refreshKeptStorage(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = storageIsPersistent()
    .then((already) => {
      if (already) {
        markKept(true);
        return true;
      }
      return requestPersistentStorage().then((granted) => {
        markKept(granted);
        return granted;
      });
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** persist() has to run inside the click, before any await, or Firefox will not prompt. */
export function keepStorageFromUser(): Promise<boolean> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  if (!storage?.persist) {
    markKept(false);
    storageRefused.set(true);
    return Promise.resolve(false);
  }
  return storage.persist().then(
    (granted) => {
      const kept = granted === true;
      markKept(kept);
      storageRefused.set(!kept);
      return kept;
    },
    () => {
      markKept(false);
      storageRefused.set(true);
      return false;
    },
  );
}

export function keepStorageMessage(): string {
  if (storageRefused()) {
    return 'Storage is still unlocked. This browser may clear your languages and keys.';
  }
  return 'Ask this browser to keep your languages and keys on this device.';
}

function markKept(granted: boolean): void {
  const previous = storageKept();
  storageKept.set(granted);
  if (granted) storageRefused.set(false);
  if (previous !== granted) {
    console.info(`LingoGems storage ${granted ? 'persistent' : 'best-effort'}`);
  }
}

function onInstalled(): void {
  syncInstallState();
  void refreshKeptStorage();
}

function onVisible(): void {
  if (document.visibilityState === 'hidden') return;
  if (storageKept() === true) return;
  void refreshKeptStorage();
}

function watchDisplayMode(): void {
  for (const mode of ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']) {
    window.matchMedia(`(display-mode: ${mode})`).addEventListener('change', () => {
      syncInstallState();
      if (standaloneApp()) void refreshKeptStorage();
    });
  }
}

function syncInstallState(): void {
  standaloneApp.set(launchedInstalled());
}

function launchedInstalled(): boolean {
  const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
  if (modes.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)) return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function watchPermission(): Promise<void> {
  if (!navigator.permissions?.query) return Promise.resolve();
  return navigator.permissions
    .query({ name: 'persistent-storage' as PermissionName })
    .then((status) => {
      const apply = () => {
        if (status.state === 'granted') markKept(true);
        else if (status.state === 'denied') markKept(false);
      };
      apply();
      status.onchange = apply;
    })
    .catch(() => undefined);
}
