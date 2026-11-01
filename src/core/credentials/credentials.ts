const ONBOARDED_KEY = 'lingogem.is-onboarded';

export function isOnboarded(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(ONBOARDED_KEY) === 'true';
}

export function markOnboarded(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(ONBOARDED_KEY, 'true');
}
