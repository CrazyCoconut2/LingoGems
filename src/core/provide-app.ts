import {
  ApplicationConfig,
  ENVIRONMENT_INITIALIZER,
  inject,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { setElementWriteListener, setPhraseTranslationListener } from 'collection';
import { StatsJob } from './elements/stats-job';
import { applyScoreColors } from './settings/score-colors';

export function provideApp(): ApplicationConfig['providers'] {
  return [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        applyScoreColors();
        const job = inject(StatsJob);
        setElementWriteListener((language) => job.invalidate(language));
        setPhraseTranslationListener((language) => job.invalidate(language));
        job.resumePending();
      },
    },
  ];
}
