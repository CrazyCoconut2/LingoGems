import { bootstrapApplication } from '@angular/platform-browser';
import { loadPhraseTranslations } from 'collection';
import { App } from '@app/core';
import { startKeepingStorage } from '@app/core/storage/keep-storage';
import { appConfig } from './app.config';

startKeepingStorage();
void start().catch((err) => console.error(err));

async function start(): Promise<void> {
  try {
    await loadPhraseTranslations();
  } catch (err) {
    console.error(err);
  }
  await bootstrapApplication(App, appConfig);
}
