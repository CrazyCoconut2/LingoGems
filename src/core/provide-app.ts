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
    path: 'languages/:code/:elementId',
    redirectTo: ({ params, queryParams }) => {
      const search = new URLSearchParams({ element: String(params['elementId'] ?? '') });
      const q = queryParams['q'];
      if (typeof q === 'string' && q) search.set('q', q);
      return `/languages/${params['code']}?${search.toString()}`;
    },
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
