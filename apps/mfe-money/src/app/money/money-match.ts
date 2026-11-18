import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  MatchesDto,
  MatchPayableDto,
  MatchSuggestion,
  MovementLinkDto,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
} from '@life-island/design-system';
import { dateText, errorText, euro } from '@life-island/records-ui';
import type { Observable } from 'rxjs';
import { MoneyApi } from '../api/money-api';
import {
  candidates,
  CONFIDENCE,
  leftOf,
  openItems,
  pickAmount,
} from './match-view';

const SERVICE = 'svc-money';

/** What a link's status tells you, when it is not simply fine. */
const LINK_STATUS: Partial<Record<MovementLinkDto['status'], string>> = {
  gone: 'No longer in its area',
  changed: 'It costs less now',
};

/**
 * The "To match" tab (docs/guides/money-matching.md): the payments Money
 * found in your movements, to confirm one by one; the items still to pay,
 * with the movements that could have paid them; and the links you made, to
 * undo. Each confirmation marks the item paid in its own area.
 */
@Component({
  selector: 'money-match',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiEmptyState,
    UiIcon,
  ],
  templateUrl: './money-match.html',
  styleUrl: './money-match.css',
})
export class MoneyMatch {
  private readonly api = inject(MoneyApi);

  /** The page's movements: when they change (an import), Money looks again. */
  readonly movements = input<unknown>();
  /** A link was made or undone: the page reloads, and so does this tab. */
  readonly changed = output<void>();
  /** You want to bring in newer movements. */
  readonly importCsv = output<void>();

  protected readonly data = signal<MatchesDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** The movement you picked for each open item, by item key. */
  protected readonly picked = signal<Record<string, string>>({});

  protected readonly euro = euro;
  protected readonly dateText = dateText;
  protected readonly confidence = CONFIDENCE;
  protected readonly linkStatus = LINK_STATUS;
  protected readonly leftOf = leftOf;

  protected readonly down = computed(
    () => this.data()?.sources.filter((s) => !s.ok) ?? [],
  );
  protected readonly sure = computed(
    () => this.data()?.suggestions.filter((s) => s.confidence === 'sure') ?? [],
  );
  protected readonly open = computed(() => {
    const data = this.data();
    return data ? openItems(data) : [];
  });
  private readonly movementsById = computed(
    () => new Map((this.data()?.movements ?? []).map((m) => [m.id, m])),
  );
  private readonly payablesByKey = computed(
    () => new Map((this.data()?.payables ?? []).map((p) => [p.key, p])),
  );

  constructor() {
    effect(() => {
      this.movements();
      untracked(() => this.load());
    });
  }

  protected load(): void {
    this.api.matches().subscribe({
      next: (data) => {
        this.data.set(data);
        this.error.set(null);
      },
      error: (error: unknown) =>
        this.error.set(
          errorText(error, 'Could not look for payments to match.', SERVICE),
        ),
    });
  }

  protected movement(id: string) {
    return this.movementsById().get(id) ?? null;
  }

  protected payable(key: string) {
    return this.payablesByKey().get(key) ?? null;
  }

  protected candidatesOf(payable: MatchPayableDto) {
    const data = this.data();
    return data ? candidates(data, payable) : [];
  }

  protected pickedFor(payable: MatchPayableDto): string {
    return (
      this.picked()[payable.key] ?? this.candidatesOf(payable)[0]?.id ?? ''
    );
  }

  protected pick(payable: MatchPayableDto, movementId: string): void {
    this.picked.update((p) => ({ ...p, [payable.key]: movementId }));
  }

  protected confirm(suggestion: MatchSuggestion): void {
    this.save(
      this.api.link({
        movementId: suggestion.movementId,
        items: suggestion.payableKeys.map((payableKey, i) => ({
          payableKey,
          amount: suggestion.amounts[i],
        })),
      }),
      'Could not confirm it.',
    );
  }

  /** Every sure pair, one after the other; a refusal stops the rest. */
  protected confirmAllSure(): void {
    const queue = [...this.sure()];
    const next = (): void => {
      const suggestion = queue.shift();
      if (!suggestion) {
        this.busy.set(false);
        this.reload();
        return;
      }
      this.api
        .link({
          movementId: suggestion.movementId,
          items: suggestion.payableKeys.map((payableKey, i) => ({
            payableKey,
            amount: suggestion.amounts[i],
          })),
        })
        .subscribe({
          next,
          error: (error: unknown) => {
            this.busy.set(false);
            this.error.set(
              errorText(error, 'Could not confirm them all.', SERVICE),
            );
            this.reload();
          },
        });
    };
    this.busy.set(true);
    next();
  }

  protected reject(suggestion: MatchSuggestion): void {
    this.save(
      this.api.reject({
        movementId: suggestion.movementId,
        payableKeys: suggestion.payableKeys,
      }),
      'Could not set it aside.',
    );
  }

  protected linkPicked(payable: MatchPayableDto): void {
    const movement = this.movement(this.pickedFor(payable));
    if (!movement) return;
    this.save(
      this.api.link({
        movementId: movement.id,
        items: [
          { payableKey: payable.key, amount: pickAmount(payable, movement) },
        ],
      }),
      'Could not link it.',
    );
  }

  protected pickedAmount(payable: MatchPayableDto): number | null {
    const movement = this.movement(this.pickedFor(payable));
    return movement ? pickAmount(payable, movement) : null;
  }

  protected unlink(link: MovementLinkDto): void {
    this.save(this.api.unlink(link.id), 'Could not undo the link.');
  }

  private save(request: Observable<unknown>, fallback: string): void {
    this.busy.set(true);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.error.set(null);
        this.reload();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(errorText(error, fallback, SERVICE));
        // What made it fail (an item gone, a link made elsewhere) shows on reload.
        this.load();
      },
    });
  }

  private reload(): void {
    this.changed.emit();
  }
}
