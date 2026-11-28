import {
  learningPath,
  type LifeAttentionItemDto,
  type StudiesOverviewDto,
} from '@life-island/contracts';

/*
 * What Studies needs you for with no date of its own, for the Agenda and
 * every "Needs you" (GET /attention `items`): what the resource scout found,
 * a path behind its target, weeks without study. Dated things (renewals,
 * exams, certifications, target dates) reach the Agenda through
 * GET /deadlines.
 */

/** Where the scout's findings wait for you: Fresh resources. */
export const FRESH_LINK = '/studies?tab=fresh';

/** Where the recall questions wait: Overview, the Recall block. */
export const RECALL_LINK = '/studies#studies-recall';

/** Where a path opens in Studies: its tab, with the path selected. */
export const pathLink = (pathId: string) =>
  `/studies?tab=paths&path=${encodeURIComponent(pathId)}`;

export function studyAttentionItems(
  overview: Pick<
    StudiesOverviewDto,
    'scout' | 'reminders' | 'catalogue' | 'paths'
  > &
    Partial<Pick<StudiesOverviewDto, 'recall'>>,
): LifeAttentionItemDto[] {
  const items: LifeAttentionItemDto[] = [];
  const nameOf = (id: string) =>
    learningPath(id, overview.catalogue)?.name ?? id;

  // The scout's findings, one line per path.
  const byPath = new Map<
    string,
    { fresh: number; outdated: number; changes: number; since: string | null }
  >();
  const entry = (pathId: string) => {
    let e = byPath.get(pathId);
    if (!e) {
      e = { fresh: 0, outdated: 0, changes: 0, since: null };
      byPath.set(pathId, e);
    }
    return e;
  };
  const earliest = (a: string | null, b: string) =>
    !a || b.slice(0, 10) < a ? b.slice(0, 10) : a;
  for (const r of overview.scout.resources) {
    if (r.status === 'suggested') {
      const e = entry(r.pathId);
      e.fresh++;
      e.since = earliest(e.since, r.foundAt);
    } else if (r.outdated) {
      const e = entry(r.pathId);
      e.outdated++;
      e.since = earliest(e.since, r.foundAt);
    }
  }
  for (const c of overview.scout.proposals) {
    const e = entry(c.pathId);
    e.changes++;
    e.since = earliest(e.since, c.createdAt);
  }
  for (const [pathId, e] of byPath) {
    const parts = [
      e.fresh ? `${e.fresh} new resource${e.fresh === 1 ? '' : 's'}` : null,
      e.outdated ? `${e.outdated} outdated` : null,
      e.changes
        ? `${e.changes} change${e.changes === 1 ? '' : 's'} to the path`
        : null,
    ].filter(Boolean);
    items.push({
      id: `scout:${pathId}`,
      kind: 'scout',
      title: `Review what the scout found for ${nameOf(pathId)}`,
      detail: parts.join(', '),
      since: e.since,
      path: FRESH_LINK,
      action: 'Review',
    });
  }

  // Recall questions that came back today.
  const due = overview.recall?.due ?? [];
  if (due.length)
    items.push({
      id: 'recall',
      kind: 'recall',
      title: `Answer ${due.length} recall question${due.length === 1 ? '' : 's'}`,
      detail: 'Two minutes now keeps what you studied from fading.',
      since: due[0].dueOn,
      path: RECALL_LINK,
      action: 'Answer',
    });

  for (const r of overview.reminders) {
    if (r.kind === 'target' && r.refId)
      items.push({
        id: `target:${r.refId}`,
        kind: 'target',
        title: r.title,
        detail: r.detail,
        since: null,
        path: pathLink(r.refId),
        action: 'Plan it',
      });
    if (r.kind === 'idle')
      items.push({
        id: 'idle',
        kind: 'idle',
        title: r.title,
        detail: r.detail,
        since: null,
        path: '/studies#studies-next',
        action: 'Study now',
      });
  }
  return items;
}
