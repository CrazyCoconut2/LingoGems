import { bootstrapApplication } from '@angular/platform-browser';
import { App } from '@app/core';
import { startKeepingStorage } from '@app/core/storage/keep-storage';
import { appConfig } from './app.config';

startKeepingStorage();
bootstrapApplication(App, appConfig).catch((err) => console.error(err));
