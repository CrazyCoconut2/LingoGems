import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { isOnboarded } from '../credentials/credentials';

export const requireOnboarding: CanActivateFn = () => {
  if (isOnboarded()) return true;
  return inject(Router).createUrlTree(['/onboarding']);
};

export const leaveOnboardingWhenDone: CanActivateFn = () => {
  if (!isOnboarded()) return true;
  return inject(Router).createUrlTree(['/']);
};
