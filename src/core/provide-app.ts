import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter, Routes } from '@angular/router';
import { Home } from './app';
import { Onboarding } from './onboarding/onboarding';
import { leaveOnboardingWhenDone, requireOnboarding } from './onboarding/onboarding.guards';

const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    component: Home,
    canActivate: [requireOnboarding],
  },
  {
    path: 'onboarding',
    component: Onboarding,
    canActivate: [leaveOnboardingWhenDone],
  },
];

export function provideApp(): ApplicationConfig['providers'] {
  return [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
  ];
}
