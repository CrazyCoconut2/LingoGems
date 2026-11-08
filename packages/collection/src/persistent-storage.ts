/** Ask the browser to exempt this origin from storage eviction. */
export function requestPersistentStorage(): Promise<boolean> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  if (!storage?.persist) return Promise.resolve(false);
  return storage.persist().then(
    (granted) => granted === true,
    () => false,
  );
}

export function storageIsPersistent(): Promise<boolean> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  if (!storage?.persisted) return Promise.resolve(false);
  return storage.persisted().then(
    (persisted) => persisted === true,
    () => false,
  );
}
