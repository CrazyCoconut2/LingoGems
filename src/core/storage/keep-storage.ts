import { signal } from '@angular/core';
import { requestPersistentStorage, storageIsPersistent } from 'collection';

type InstallPrompt = Event & {
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  prompt(): Promise<void>;
};

export const storageKept = signal<boolean | null>(null);
export const storageRefused = signal(false);
export const installReady = signal(false);
export const justInstalled = signal(false);
export const standaloneApp = signal(false);
export const iosHomeScreen = signal(false);

let started = false;
let promptEvent: InstallPrompt | null = null;
let refreshing: Promise<boolean> | null = null;

export function startKeepingStorage(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  syncInstallState();
  window.addEventListener('beforeinstallprompt', onInstallPrompt);
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

export function installApp(): Promise<void> {
  const event = promptEvent;
  if (!event) return Promise.resolve();
  promptEvent = null;
  installReady.set(false);
  return event
    .prompt()
    .then(() => event.userChoice)
    .then((choice) => {
      if (choice.outcome === 'accepted') justInstalled.set(true);
      return refreshKeptStorage();
    })
    .then(() => undefined);
}

export function keepStorageMessage(): string {
  if (installReady()) {
    return 'Install LingoGems and this browser will keep your languages and keys.';
  }
  if (justInstalled() && !standaloneApp()) {
    return 'Open LingoGems from its icon and this device will keep your languages and keys.';
  }
  if (iosHomeScreen()) {
    return 'In Safari, tap Share, then Add to Home Screen. That keeps your languages and keys.';
  }
  if (storageRefused()) {
    return 'Storage is still unlocked. Install LingoGems and open it from its icon.';
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

function onInstallPrompt(event: Event): void {
  event.preventDefault();
  promptEvent = event as InstallPrompt;
  installReady.set(true);
}

function onInstalled(): void {
  justInstalled.set(true);
  promptEvent = null;
  installReady.set(false);
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
  const standalone = launchedInstalled();
  standaloneApp.set(standalone);
  iosHomeScreen.set(isIos() && !standalone);
}

function launchedInstalled(): boolean {
  const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
  if (modes.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)) return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
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
