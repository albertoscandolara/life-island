import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import {
  formatUsd,
  priceOf,
  requestCostUsd,
  type AiRequestStep,
  type AiToolStep,
} from '@life-island/contracts';
import { UiAiBadge, UiBadge, UiDialog } from '@life-island/design-system';
import {
  AI_TOOLS_SETTINGS_URL,
  aiToolSettingsLink,
  SettingsApi,
} from './settings-api';

interface StepView {
  definition: AiToolStep;
  request: AiRequestStep | null;
  model: string;
  modelLabel: string;
  estimateUsd: number;
}

/**
 * The info of an AI tool: what it does, what happens while it is off, and the
 * request it sends step by step (model, effort, thinking, limits, server tools,
 * the system prompt word for word and the user message), its estimated and
 * real cost, and its latest uses.
 */
@Component({
  selector: 'li-ai-tool-info',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiDialog, UiAiBadge, UiBadge, DatePipe, DecimalPipe],
  template: `
    @if (view(); as v) {
      <ui-dialog [(open)]="open" [heading]="v.definition.name" size="lg">
        <p class="lead">{{ v.definition.description }}</p>
        <dl class="facts">
          <div>
            <dt>Cost per {{ v.definition.unit }}</dt>
            <dd>
              {{ usd(v.costUsd) }}
              <span class="muted">{{
                v.costIsEstimate
                  ? '(estimate)'
                  : '(average of ' + v.state?.usage.uses + ' uses)'
              }}</span>
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <ui-ai-badge
                [muted]="!v.active"
                [label]="v.active ? 'Calls the model' : 'Off · ' + v.offReason"
              />
            </dd>
          </div>
          @if (v.state; as state) {
            @if (state.usage.totalCostUsd) {
              <div>
                <dt>Spent so far</dt>
                <dd>{{ usd(state.usage.totalCostUsd) }}</dd>
              </div>
            }
          }
          <div>
            <dt>Runs</dt>
            <dd>{{ triggers[v.definition.trigger] }}</dd>
          </div>
        </dl>
        <p class="muted small">
          <strong>While it is off:</strong> {{ v.definition.whenOff }}
        </p>

        <h3>The request</h3>
        @if (!v.state?.request) {
          <p class="muted small">
            Its service has not reported its request yet (it does at startup),
            so this shows the registry defaults.
          </p>
        }
        @for (step of steps(); track step.definition.id; let i = $index) {
          <section class="step">
            <h4>
              {{ steps().length > 1 ? i + 1 + '. ' : ''
              }}{{ step.definition.label }}
              @if (!step.definition.always) {
                <ui-badge tone="neutral">only sometimes</ui-badge>
              }
            </h4>
            <dl class="grid">
              <dt>Model</dt>
              <dd>
                {{ step.modelLabel }} <code>{{ step.model }}</code>
              </dd>
              <dt>Reasoning</dt>
              <dd>
                effort {{ step.request?.effort ?? step.definition.effort }} ·
                thinking {{ step.request?.thinking ?? 'adaptive (default)' }}
              </dd>
              <dt>Max output</dt>
              <dd>
                {{
                  step.request?.maxTokens ?? step.definition.maxTokens | number
                }}
                tokens
              </dd>
              <dt>Server tools</dt>
              <dd>
                {{
                  (step.request?.tools ?? step.definition.tools).join(', ') ||
                    'none'
                }}
              </dd>
              <dt>Output</dt>
              <dd>{{ step.request?.outputFormat ?? 'structured JSON' }}</dd>
              <dt>Prompt caching</dt>
              <dd>
                {{
                  step.request
                    ? step.request.promptCaching
                      ? 'on'
                      : 'off'
                    : '—'
                }}
              </dd>
              <dt>Typical use</dt>
              <dd>
                {{ step.definition.estimate.inputTokens | number }} in ·
                {{ step.definition.estimate.outputTokens | number }} out
                @if (step.definition.estimate.webSearches) {
                  · {{ step.definition.estimate.webSearches }} searches
                }
                ≈ {{ usd(step.estimateUsd) }}
              </dd>
            </dl>
            @if (step.request; as request) {
              <details>
                <summary>System prompt</summary>
                <pre>{{ request.system }}</pre>
              </details>
              <details>
                <summary>User message</summary>
                <pre>{{ request.userTemplate }}</pre>
              </details>
            }
          </section>
        }

        @if (v.state?.recentUses; as recentUses) {
          @if (recentUses.length) {
            <h3>Latest uses</h3>
            <table class="uses">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Tokens in / out</th>
                  <th scope="col">Cost</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                @for (use of recentUses; track use.usedAt) {
                  <tr>
                    <td>{{ use.usedAt | date: 'dd MMM, HH:mm' }}</td>
                    <td>
                      {{ tokensIn(use.steps) | number }} /
                      {{ tokensOut(use.steps) | number }}
                    </td>
                    <td>{{ usd(use.costUsd) }}</td>
                    <td>
                      {{ use.outcome === 'ok' ? 'ok' : use.error || 'error' }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        }
        <p class="muted small">
          Prices are the Claude API list prices; thinking is billed as output.
          <a [href]="settingsLink()">This tool in Settings</a>
        </p>
      </ui-dialog>
    }
  `,
  styles: `
    .lead {
      margin: 0 0 var(--space-3);
    }
    .muted {
      color: var(--text-secondary);
    }
    .small {
      font-size: var(--text-sm);
    }
    .facts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3) var(--space-6);
      margin: 0 0 var(--space-3);
    }
    .facts dt,
    .grid dt {
      color: var(--text-secondary);
      font-size: var(--text-xs);
    }
    .facts dd,
    .grid dd {
      margin: 0;
    }
    h3 {
      margin: var(--space-6) 0 var(--space-2);
      font-size: var(--text-md);
    }
    h4 {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0 0 var(--space-2);
    }
    .step {
      padding: var(--space-3);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      margin-bottom: var(--space-3);
    }
    .grid {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--space-1) var(--space-3);
      margin: 0 0 var(--space-2);
      align-items: baseline;
    }
    pre {
      max-height: 16rem;
      overflow: auto;
      white-space: pre-wrap;
      font-size: var(--text-xs);
      background: var(--surface-sunken);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-sm);
    }
    summary {
      cursor: pointer;
      color: var(--ai-text);
      margin-top: var(--space-1);
    }
    .uses {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);
    }
    .uses th,
    .uses td {
      text-align: left;
      padding: var(--space-1) var(--space-2);
      border-bottom: 1px solid var(--border-subtle);
    }
  `,
})
export class AiToolInfo {
  private readonly api = inject(SettingsApi);
  protected readonly settingsUrl = inject(AI_TOOLS_SETTINGS_URL);

  readonly toolId = input.required<string>();
  readonly open = model(false);

  protected readonly view = computed(() => this.api.tool(this.toolId()));
  protected readonly settingsLink = computed(() =>
    aiToolSettingsLink(this.settingsUrl, this.toolId()),
  );
  protected readonly steps = computed<StepView[]>(() => {
    const view = this.view();
    if (!view) return [];
    return view.definition.steps.map((definition) => {
      const request =
        view.state?.request?.steps.find((s) => s.stepId === definition.id) ??
        null;
      // The model you picked in Settings applies over what the service reported.
      const model =
        view.state?.models[definition.id] ??
        request?.model ??
        definition.defaultModel;
      return {
        definition,
        request,
        model,
        modelLabel: priceOf(model).label,
        estimateUsd: requestCostUsd(model, definition.estimate),
      };
    });
  });

  protected readonly triggers = {
    'on-demand': 'When you ask',
    'per-document': 'On every document read',
    scheduled: 'On a schedule, and when you start it',
  } as const;

  protected usd(value: number): string {
    return formatUsd(value);
  }

  protected tokensIn(steps: { inputTokens: number }[]): number {
    return steps.reduce((sum, s) => sum + s.inputTokens, 0);
  }

  protected tokensOut(steps: { outputTokens: number }[]): number {
    return steps.reduce((sum, s) => sum + s.outputTokens, 0);
  }
}
