import { AbstractProvider } from '../../../../modules/providers/shared/base/abstract.provider.js';
import { AntigravityProviderAuth } from './antigravity-auth.provider.js';
import { antigravityModelsProvider } from './antigravity-models.provider.js';
import { antigravityRuntime } from './antigravity-runtime.provider.js';
import { AntigravityMcpProvider } from './antigravity-mcp.provider.js';
import { AntigravitySessionSynchronizer } from './antigravity-session-synchronizer.provider.js';
import { AntigravitySessionsProvider } from './antigravity-sessions.provider.js';
import { AntigravitySkillsProvider } from './antigravity-skills.provider.js';
export class AntigravityProvider extends AbstractProvider {
    runtime = antigravityRuntime;
    models = antigravityModelsProvider;
    mcp = new AntigravityMcpProvider();
    auth = new AntigravityProviderAuth();
    skills = new AntigravitySkillsProvider();
    sessions = new AntigravitySessionsProvider();
    sessionSynchronizer = new AntigravitySessionSynchronizer();
    constructor() {
        super('antigravity');
    }
}
//# sourceMappingURL=antigravity.provider.js.map