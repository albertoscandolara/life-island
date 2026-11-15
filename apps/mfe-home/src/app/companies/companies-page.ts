import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  entityParam,
  ORGANIZATION_IMAGE_KINDS,
  ORGANIZATION_IMAGE_MAX_BYTES,
  ORGANIZATION_IMAGE_TYPES,
  ORGANIZATION_ROLES,
  updateOrganizationRequestSchema,
  type OrganizationDetailDto,
  type OrganizationDto,
  type OrganizationImageKind,
  type OrganizationRole,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiInput,
  UiPageHeader,
} from '@life-island/design-system';
import { EntityDirectory, EntityLink } from '@life-island/entities-ui';
import type { Observable } from 'rxjs';
import { HomeApi } from '../api/home-api';
import { AreaNav } from '../shared/area-nav';
import { formatDate, formatEuro } from '../shared/format';

const ROLE_LABELS: Record<OrganizationRole, string> = {
  ENERGY_SUPPLIER: 'Supplier',
  DISTRIBUTOR: 'Distributor',
  CONTRACTOR: 'Contractor',
  EMPLOYER: 'Employer',
  BANK: 'Bank',
  OTHER: 'Other',
};

const IMAGE_LABELS: Record<OrganizationImageKind, string> = {
  logo: 'Logo',
  cover: 'Background',
};

/**
 * Companies as entities: every company your documents name (suppliers,
 * contractors, banks, shops). A new one waits for you: confirm it, say which
 * company it really is (merge), or that it is not a company. Once confirmed,
 * its name links here from every page of the island (`?company=<id>`).
 * Its website, your notes, a logo and a background image make it easy to
 * recognize.
 */
@Component({
  selector: 'home-companies-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AreaNav,
    EntityLink,
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiEmptyState,
    UiIcon,
    UiInput,
    UiPageHeader,
  ],
  templateUrl: './companies-page.html',
  styleUrls: ['../shared/kit.css', './companies-page.css'],
})
export class CompaniesPage {
  private readonly api = inject(HomeApi);
  private readonly router = inject(Router);
  private readonly directory = inject(EntityDirectory);

  protected readonly companies = signal<OrganizationDto[] | null>(null);
  protected readonly detail = signal<OrganizationDetailDto | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  /** For each pending company, the confirmed one you say it is. */
  protected readonly sameAs = signal<Record<string, string>>({});
  protected readonly showDismissed = signal(false);
  protected readonly editing = signal(false);
  protected readonly draftRoles = signal<OrganizationRole[]>([]);
  protected readonly roles = ORGANIZATION_ROLES;
  protected readonly imageKinds = ORGANIZATION_IMAGE_KINDS;
  protected readonly imageAccept = ORGANIZATION_IMAGE_TYPES.join(',');
  protected readonly imageMaxMb = ORGANIZATION_IMAGE_MAX_BYTES / 1024 / 1024;

  protected readonly pending = computed(() =>
    (this.companies() ?? []).filter((c) => c.status === 'PENDING'),
  );
  protected readonly confirmed = computed(() =>
    (this.companies() ?? []).filter((c) => c.status === 'CONFIRMED'),
  );
  protected readonly dismissed = computed(() =>
    (this.companies() ?? []).filter((c) => c.status === 'DISMISSED'),
  );

  protected readonly formatDate = formatDate;
  protected readonly formatEuro = formatEuro;
  protected readonly previewUrl = (id: string) => this.api.previewUrl(id);

  constructor() {
    inject(ActivatedRoute)
      .queryParamMap.pipe(takeUntilDestroyed())
      .subscribe((query) => this.open(query.get(entityParam('organization'))));
    this.load();
  }

  protected roleLabel(role: OrganizationRole): string {
    return ROLE_LABELS[role];
  }

  protected imageLabel(kind: OrganizationImageKind): string {
    return IMAGE_LABELS[kind];
  }

  /** The URL of a company's logo or background, or null when it has none. */
  protected imageUrl(
    company: OrganizationDto,
    kind: OrganizationImageKind,
  ): string | null {
    const version = company.images[kind];
    return version === null
      ? null
      : this.api.organizationImageUrl(company.id, kind, version);
  }

  /** Up to two letters standing in for a company without a logo. */
  protected initials(name: string): string {
    const words = name
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
    return (
      words
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase() || '?'
    );
  }

  /** The website without its scheme and trailing slash: "www.acme.it". */
  protected websiteLabel(url: string): string {
    return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }

  protected select(company: OrganizationDto): void {
    void this.router.navigate([], {
      queryParams: { [entityParam('organization')]: company.id, review: null },
      queryParamsHandling: 'merge',
    });
  }

  protected startEdit(company: OrganizationDetailDto): void {
    this.draftRoles.set([...company.roles]);
    this.editing.set(true);
  }

  protected toggleRole(role: OrganizationRole): void {
    this.draftRoles.update((roles) =>
      roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role],
    );
  }

  protected save(
    company: OrganizationDetailDto,
    name: string,
    vatNumber: string,
    taxCode: string,
    aliases: string,
    websiteText: string,
    description: string,
  ): void {
    if (!name.trim()) return;
    const website =
      updateOrganizationRequestSchema.shape.website.safeParse(websiteText);
    if (!website.success) {
      this.error.set(
        'That website does not look right: try something like acme.it or https://www.acme.it.',
      );
      return;
    }
    this.editing.set(false);
    this.run(
      company.id,
      this.api.updateOrganization(company.id, {
        name: name.trim(),
        vatNumber: vatNumber.trim() || null,
        taxCode: taxCode.trim() || null,
        aliases: aliases
          .split('\n')
          .map((a) => a.trim())
          .filter(Boolean),
        roles: this.draftRoles(),
        website: website.data ?? null,
        description: description.trim() || null,
      }),
      'That did not save: another company may have this tax code.',
    );
  }

  /** Uploads the file just picked as the company's logo or background. */
  protected uploadImage(
    company: OrganizationDetailDto,
    kind: OrganizationImageKind,
    event: Event,
  ): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!(ORGANIZATION_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      this.error.set('Pick a PNG, JPEG, WebP or GIF image.');
      return;
    }
    if (file.size > ORGANIZATION_IMAGE_MAX_BYTES) {
      this.error.set(`An image can be at most ${this.imageMaxMb} MB.`);
      return;
    }
    this.run(
      `${company.id}:${kind}`,
      this.api.uploadOrganizationImage(company.id, kind, file),
      'That image did not upload. Is the object storage running?',
    );
  }

  protected removeImage(
    company: OrganizationDetailDto,
    kind: OrganizationImageKind,
  ): void {
    this.run(
      `${company.id}:${kind}`,
      this.api.deleteOrganizationImage(company.id, kind),
    );
  }

  /** Merges the look-alike `from` into the company you are looking at. */
  protected mergeInto(intoId: string, fromId: string): void {
    this.run(intoId, this.api.mergeOrganization(intoId, fromId));
  }

  protected pickSameAs(pendingId: string, targetId: string): void {
    this.sameAs.update((all) => ({ ...all, [pendingId]: targetId }));
  }

  protected confirm(company: OrganizationDto): void {
    this.run(company.id, this.api.setOrganizationStatus(company.id, 'confirm'));
  }

  protected dismiss(company: OrganizationDto): void {
    this.run(company.id, this.api.setOrganizationStatus(company.id, 'dismiss'));
  }

  protected reopen(company: OrganizationDto): void {
    this.run(company.id, this.api.setOrganizationStatus(company.id, 'reopen'));
  }

  protected merge(company: OrganizationDto): void {
    const into = this.sameAs()[company.id];
    if (!into) return;
    this.run(company.id, this.api.mergeOrganization(into, company.id));
  }

  protected confirmAll(): void {
    this.run('all', this.api.confirmPendingOrganizations());
  }

  private run(
    key: string,
    call: Observable<unknown>,
    failure = 'That did not work. Please try again.',
  ): void {
    this.busy.set(key);
    this.error.set(null);
    call.subscribe({
      next: () => {
        this.busy.set(null);
        this.load();
        void this.directory.refresh();
      },
      error: () => {
        this.busy.set(null);
        this.error.set(failure);
      },
    });
  }

  private load(): void {
    this.api.organizations().subscribe({
      next: (companies) => {
        this.companies.set(companies);
        const id = this.selectedId();
        if (id && companies.some((c) => c.id === id)) this.open(id);
        else if (id) this.open(null);
      },
      error: () => {
        this.companies.set([]);
        this.error.set('Could not read your companies. Is svc-home running?');
      },
    });
  }

  private open(id: string | null): void {
    if (id !== this.selectedId()) this.editing.set(false);
    this.selectedId.set(id);
    if (!id) {
      this.detail.set(null);
      return;
    }
    this.api.organization(id).subscribe({
      next: (detail) => {
        if (this.selectedId() === id) this.detail.set(detail);
      },
      error: () => this.detail.set(null),
    });
  }
}
