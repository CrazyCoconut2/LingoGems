import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter, Routes } from '@angular/router';
import { LanguagePage, openSavedLanguage } from './languages/language-page';
import { LanguageList } from './languages/language-list';
import { Onboarding } from './onboarding/onboarding';
import { leaveOnboardingWhenDone, requireOnboarding } from './onboarding/onboarding.guards';

const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    component: LanguageList,
    canActivate: [requireOnboarding],
  },
  {
    path: 'languages/:code',
    component: LanguagePage,
    canActivate: [requireOnboarding, openSavedLanguage],
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
