import { Pipe, PipeTransform } from '@angular/core';

const LOW_DOUBLE_QUOTE = '\u201E';
const HIGH_DOUBLE_QUOTE = '\u201C';

/** The low German opening quote sits on the baseline. Show the high quote instead. */
@Pipe({ name: 'upwardQuote' })
export class UpwardQuotePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    const text = value ?? '';
    return text.includes(LOW_DOUBLE_QUOTE)
      ? text.replaceAll(LOW_DOUBLE_QUOTE, HIGH_DOUBLE_QUOTE)
      : text;
  }
}
