import {
  ApplicationConfig,
  ENVIRONMENT_INITIALIZER,
  inject,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { setElementWriteListener } from 'collection';
import { GemStatsJob } from './elements/gem-stats-job';

export function provideApp(): ApplicationConfig['providers'] {
  return [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        const job = inject(GemStatsJob);
        setElementWriteListener((language) => job.invalidate(language));
        job.resumePending();
      },
    },
  ];
}
