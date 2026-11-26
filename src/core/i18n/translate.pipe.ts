import { ChangeDetectorRef, OnDestroy, Pipe, PipeTransform } from '@angular/core';
import { Subscription } from 'rxjs';
import { LanguageService } from './language.service';

@Pipe({
  name: 'translate',
  pure: false,
})
export class TranslatePipe implements PipeTransform, OnDestroy {
  private readonly subscription: Subscription;

  constructor(
    private readonly languageService: LanguageService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.subscription = this.languageService.languageChanged$.subscribe(() => {
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  transform(key: string, params?: Record<string, string>): string {
    return this.languageService.translate(key, params);
  }
}
