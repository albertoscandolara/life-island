import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  type OnInit,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ENTITY_KIND_LABELS,
  entityLink,
  entityPath,
  type EntityKind,
  type EntityRefDto,
} from '@life-island/contracts';
import { ENTITY_LINK_BASE, EntityDirectory } from './entity-directory';

/**
 * A person, house, car, company or workplace named on a page. Confirmed, it
 * links to its page; suggested by a document and not confirmed yet, it says
 * so and links to where you confirm it; unknown, it is plain text.
 *
 * Give the id when the page has it (`kind` + `entityId`); otherwise the
 * printed name is looked up (`name`, with `kind` to narrow it).
 */
@Component({
  selector: 'li-entity-link',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ref(); as r) {
      @if (base) {
        <a
          class="entity-link"
          [class.entity-link--pending]="r.status === 'pending'"
          [href]="href(r)"
          target="_blank"
          rel="noopener"
          [attr.title]="title(r)"
          (click)="$event.stopPropagation()"
          >{{ label() }}</a
        >
      } @else {
        <a
          class="entity-link"
          [class.entity-link--pending]="r.status === 'pending'"
          [routerLink]="link(r).path"
          [queryParams]="link(r).query"
          [attr.title]="title(r)"
          (click)="$event.stopPropagation()"
          >{{ label() }}</a
        >
      }
      @if (r.status === 'pending') {
        <span class="entity-link__badge">to confirm</span>
      }
    } @else {
      {{ label() }}
    }
  `,
  styles: `
    :host {
      display: inline;
    }
    .entity-link {
      color: inherit;
      font-weight: inherit;
      text-decoration: underline;
      text-decoration-color: var(--accent);
      text-decoration-thickness: 0.1em;
      text-underline-offset: 0.2em;
      border-radius: var(--radius-sm);
    }
    .entity-link:hover {
      color: var(--accent);
    }
    .entity-link:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring);
    }
    .entity-link--pending {
      text-decoration-style: dashed;
      text-decoration-color: var(--tone-warning);
    }
    .entity-link__badge {
      margin-left: var(--space-1);
      padding: 0 var(--space-1);
      border-radius: var(--radius-sm);
      background: var(--tone-warning-soft);
      color: var(--tone-warning);
      font-size: var(--text-xs);
      font-weight: 600;
      white-space: nowrap;
    }
  `,
})
export class EntityLink implements OnInit {
  private readonly directory = inject(EntityDirectory);
  protected readonly base = inject(ENTITY_LINK_BASE).replace(/\/$/, '');

  /** The name as the page shows it; the entity's own name when not given. */
  readonly name = input<string | null | undefined>(null);
  /** The kind (or kinds) it can be; any when not given. */
  readonly kind = input<EntityKind | readonly EntityKind[] | undefined>(
    undefined,
  );
  /** Its id, when the page has it (then `kind` must be one kind). */
  readonly entityId = input<string | null | undefined>(null);
  /** Show the entity's own name once found (for a tax code or a plate given as `name`). */
  readonly showName = input(false);

  protected readonly ref = computed<EntityRefDto | null>(() => {
    const kind = this.kind();
    const id = this.entityId();
    if (id && typeof kind === 'string') {
      const byId = this.directory.byId(kind, id);
      if (byId) return byId;
    }
    return this.directory.find(this.name(), kind);
  });

  protected readonly label = computed(() => {
    const ref = this.ref();
    if (ref && this.showName()) return ref.name;
    return this.name() || ref?.name || '';
  });

  ngOnInit(): void {
    void this.directory.load();
  }

  protected link(ref: EntityRefDto) {
    return entityLink(ref);
  }

  protected href(ref: EntityRefDto): string {
    return `${this.base}${entityPath(ref)}`;
  }

  protected title(ref: EntityRefDto): string {
    const what = ENTITY_KIND_LABELS[ref.kind];
    return ref.status === 'pending'
      ? `${what} read from your documents: open to confirm it`
      : [`Open ${what.toLowerCase()} ${ref.name}`, ref.detail]
          .filter(Boolean)
          .join(' · ');
  }
}
