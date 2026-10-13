import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { AntigravityProviderAuth } from './antigravity-auth.provider.js';
import { AntigravityProviderModels, antigravityModelsProvider } from './antigravity-models.provider.js';
import { antigravityRuntime } from './antigravity-runtime.provider.js';
import { AntigravityMcpProvider } from './antigravity-mcp.provider.js';
import { AntigravitySessionSynchronizer } from './antigravity-session-synchronizer.provider.js';
import { AntigravitySessionsProvider } from './antigravity-sessions.provider.js';
import { AntigravitySkillsProvider } from './antigravity-skills.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';

export class AntigravityProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = antigravityRuntime;
  readonly models: IProviderModels = antigravityModelsProvider;
  readonly mcp = new AntigravityMcpProvider();
  readonly auth: IProviderAuth = new AntigravityProviderAuth();
  readonly skills: IProviderSkills = new AntigravitySkillsProvider();
  readonly sessions: IProviderSessions = new AntigravitySessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new AntigravitySessionSynchronizer();

  constructor() {
    super('antigravity');
  }
}
