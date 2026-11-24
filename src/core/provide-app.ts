import {
  ApplicationConfig,
  ENVIRONMENT_INITIALIZER,
  inject,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { setElementWriteListener } from 'collection';
import { GemStatsJob } from './elements/gem-stats-job';
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
        const job = inject(GemStatsJob);
        setElementWriteListener((language) => job.invalidate(language));
        job.resumePending();
      },
    },
  ];
}
