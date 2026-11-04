import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiEmptyState } from '@life-island/design-system';

/** Shown when an area's front-end module cannot be loaded (its remote is down). */
@Component({
  selector: 'app-module-unavailable',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiEmptyState, RouterLink],
  template: `
    <ui-empty-state icon="alert" heading="This area is not reachable right now">
      Its module did not load. In development start it with
      <code>npx nx serve mfe-&lt;area&gt;</code> (for example
      <code>mfe-home</code> or <code>mfe-tax730</code>), then reload.
      <a routerLink="/">Back to the island</a>
    </ui-empty-state>
  `,
})
export class ModuleUnavailable {}
