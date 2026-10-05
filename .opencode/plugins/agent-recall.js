/**
 * agent-recall plugin for OpenCode.ai
 *
 * Registers the repository's skills/ directory via the config hook so
 * OpenCode discovers agent-recall-init without symlinks or manual config edits.
 * Zero dependencies. This file does not record session events.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentRecallSkillsDir = path.resolve(__dirname, '../../skills');

export const AgentRecallPlugin = async () => {
  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(agentRecallSkillsDir)) {
        config.skills.paths.push(agentRecallSkillsDir);
      }
    },
  };
};
