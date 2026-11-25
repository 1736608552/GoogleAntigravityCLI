/**
 * The capability matrix mirrors what each runtime actually implements today:
 * - permission modes match the option sets accepted by each CLI/SDK.
 * - only the Claude SDK integration surfaces interactive permission requests.
 * - Cursor has no token usage endpoint support (its store.db has no usage rows).
 */
const PROVIDER_CAPABILITIES = {
    antigravity: {
        provider: 'antigravity',
        permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
        defaultPermissionMode: 'default',
        supportsImages: true,
        supportsFiles: true,
        supportsAbort: true,
        supportsPermissionRequests: true,
        supportsTokenUsage: true,
        supportsEffort: true,
        supportsMessageEditing: false,
        supportsSessionForking: false,
    },
};
/**
 * Application service exposing the provider capability matrix.
 */
export const providerCapabilitiesService = {
    getProviderCapabilities(provider) {
        return (PROVIDER_CAPABILITIES[provider] || PROVIDER_CAPABILITIES.antigravity);
    },
    listAllProviderCapabilities() {
        return Object.values(PROVIDER_CAPABILITIES);
    },
};
//# sourceMappingURL=provider-capabilities.service.js.map