import { Injectable, signal } from '@angular/core';
import {
  AI_TOOL_MODULES,
  type AiToolDefinition,
  type AppSettingDefinition,
} from '@life-island/contracts';

/** The words of a search, lower case; empty for no search. */
export function searchWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every word appears somewhere in the text. */
function matches(words: readonly string[], ...texts: string[]): boolean {
  const text = texts.join(' ').toLowerCase();
  return words.every((word) => text.includes(word));
}

/** A setting matches by its group, label, description or key. */
export function settingMatches(
  setting: AppSettingDefinition,
  words: readonly string[],
): boolean {
  return matches(
    words,
    setting.group,
    setting.label,
    setting.description,
    setting.key,
    ...(setting.options?.map((option) => option.label) ?? []),
  );
}

/** A tool matches by its name, description, module, where it lives or its models' purpose. */
export function toolMatches(
  tool: AiToolDefinition,
  words: readonly string[],
): boolean {
  const module = AI_TOOL_MODULES.find((m) => m.id === tool.module);
  return matches(
    words,
    'ai',
    tool.name,
    tool.description,
    tool.where.label,
    module?.name ?? '',
    tool.id,
  );
}

/** The search box of Settings, shared by its two pages. */
@Injectable({ providedIn: 'root' })
export class SettingsSearch {
  readonly query = signal('');
}
