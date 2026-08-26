import { Service } from '@rabjs/react';
import { TOOL_GROUPS, type GuideGroup } from './catalog';

export class GuideService extends Service {
  query = '';

  setQuery(value: string): void {
    this.query = value;
  }

  get groups(): GuideGroup[] {
    const needle = this.query.trim().toLowerCase();
    if (!needle) return TOOL_GROUPS.map((group) => ({ ...group, tools: [...group.tools] }));
    return TOOL_GROUPS.flatMap((group) => {
      const tools = group.tools.filter(
        (tool) => tool.name.toLowerCase().includes(needle) || tool.summary.toLowerCase().includes(needle),
      );
      return tools.length > 0 ? [{ ...group, tools }] : [];
    });
  }

  get matchCount(): number {
    return this.groups.reduce((count, group) => count + group.tools.length, 0);
  }
}
