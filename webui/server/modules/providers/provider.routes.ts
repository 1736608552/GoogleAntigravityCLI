import express, { type Request, type Response } from 'express';

import { providerAuthService } from '@/modules/providers/services/provider-auth.service.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import { providerMcpService } from '@/modules/providers/services/mcp.service.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import { providerTokenUsageService } from '@/modules/providers/services/provider-token-usage.service.js';
import { providerSkillsService } from '@/modules/providers/services/skills.service.js';
import { sessionConversationsSearchService } from '@/modules/providers/services/session-conversations-search.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type {
  CustomProviderModelInput,
  LLMProvider,
  McpScope,
  McpTransport,
  ProviderSkillCreateFile,
  ProviderSkillCreateInput,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

const router = express.Router();

const readPathParam = (value: unknown, name: string): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  throw new AppError(`${name} path parameter is invalid.`, {
    code: 'INVALID_PATH_PARAMETER',
    statusCode: 400,
  });
};

const normalizeProviderParam = (value: unknown): string =>
  readPathParam(value, 'provider').trim().toLowerCase();

const SESSION_ID_PATTERN = /^[a-zA-Z0-9._-]{1,120}$/;

const parseSessionId = (value: unknown): string => {
  const sessionId = readPathParam(value, 'sessionId').trim();
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new AppError('Invalid sessionId.', {
      code: 'INVALID_SESSION_ID',
      statusCode: 400,
    });
  }

  return sessionId;
};

const readOptionalQueryString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const parseOptionalBooleanQuery = (value: unknown, name: string): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = readOptionalQueryString(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  throw new AppError(`${name} must be "true" or "false".`, {
    code: 'INVALID_QUERY_PARAMETER',
    statusCode: 400,
  });
};

const parseMcpScope = (value: unknown): McpScope | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = readOptionalQueryString(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'user' || normalized === 'local' || normalized === 'project') {
    return normalized;
  }

  throw new AppError(`Unsupported MCP scope "${normalized}".`, {
    code: 'INVALID_MCP_SCOPE',
    statusCode: 400,
  });
};

const parseMcpTransport = (value: unknown): McpTransport => {
  const normalized = readOptionalQueryString(value);
  if (!normalized) {
    throw new AppError('transport is required.', {
      code: 'MCP_TRANSPORT_REQUIRED',
      statusCode: 400,
    });
  }

  if (normalized === 'stdio' || normalized === 'http' || normalized === 'sse') {
    return normalized;
  }

  throw new AppError(`Unsupported MCP transport "${normalized}".`, {
    code: 'INVALID_MCP_TRANSPORT',
    statusCode: 400,
  });
};

const parseMcpUpsertPayload = (payload: unknown): UpsertProviderMcpServerInput => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const name = readOptionalQueryString(body.name);
  if (!name) {
    throw new AppError('name is required.', {
      code: 'MCP_NAME_REQUIRED',
      statusCode: 400,
    });
  }

  const transport = parseMcpTransport(body.transport);
  const scope = parseMcpScope(body.scope);
  const workspacePath = readOptionalQueryString(body.workspacePath);

  return {
    name,
    transport,
    scope,
    workspacePath,
    command: readOptionalQueryString(body.command),
    args: Array.isArray(body.args) ? body.args.filter((entry): entry is string => typeof entry === 'string') : undefined,
    env: typeof body.env === 'object' && body.env !== null
      ? Object.fromEntries(
        Object.entries(body.env as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
      : undefined,
    cwd: readOptionalQueryString(body.cwd),
    url: readOptionalQueryString(body.url),
    headers: typeof body.headers === 'object' && body.headers !== null
      ? Object.fromEntries(
        Object.entries(body.headers as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
      : undefined,
    envVars: Array.isArray(body.envVars)
      ? body.envVars.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
    bearerTokenEnvVar: readOptionalQueryString(body.bearerTokenEnvVar),
    envHttpHeaders: typeof body.envHttpHeaders === 'object' && body.envHttpHeaders !== null
      ? Object.fromEntries(
        Object.entries(body.envHttpHeaders as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
      : undefined,
  };
};

const parseProviderSkillCreatePayload = (payload: unknown): ProviderSkillCreateInput => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const rawEntries = Array.isArray(body.entries)
    ? body.entries
    : typeof body.content === 'string'
      ? [{
          content: body.content,
          directoryName: body.directoryName,
          fileName: body.fileName,
          files: body.files,
        }]
      : null;

  if (!rawEntries || rawEntries.length === 0) {
    throw new AppError('At least one skill entry is required.', {
      code: 'PROVIDER_SKILLS_REQUIRED',
      statusCode: 400,
    });
  }

  const entries = rawEntries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new AppError(`Skill entry ${index + 1} must be an object.`, {
        code: 'INVALID_REQUEST_BODY',
        statusCode: 400,
      });
    }

    const record = entry as Record<string, unknown>;
    const content = typeof record.content === 'string' ? record.content : '';
    const directoryName = readOptionalQueryString(record.directoryName);
    const fileName = readOptionalQueryString(record.fileName);
    const rawFiles = record.files;

    if (!content.trim()) {
      throw new AppError(`Skill entry ${index + 1} must include markdown content.`, {
        code: 'PROVIDER_SKILL_CONTENT_REQUIRED',
        statusCode: 400,
      });
    }

    if (rawFiles !== undefined && !Array.isArray(rawFiles)) {
      throw new AppError(`Skill entry ${index + 1} files must be an array.`, {
        code: 'INVALID_REQUEST_BODY',
        statusCode: 400,
      });
    }

    const files: ProviderSkillCreateFile[] | undefined = rawFiles?.map((file, fileIndex) => {
      if (!file || typeof file !== 'object') {
        throw new AppError(`Skill entry ${index + 1} file ${fileIndex + 1} must be an object.`, {
          code: 'INVALID_REQUEST_BODY',
          statusCode: 400,
        });
      }

      const fileRecord = file as Record<string, unknown>;
      const relativePath = readOptionalQueryString(fileRecord.relativePath);
      const fileContent = typeof fileRecord.content === 'string' ? fileRecord.content : null;
      const encoding = fileRecord.encoding === 'utf8' || fileRecord.encoding === 'base64'
        ? fileRecord.encoding
        : null;

      if (!relativePath || fileContent === null || !encoding) {
        throw new AppError(
          `Skill entry ${index + 1} file ${fileIndex + 1} requires relativePath, content, and encoding.`,
          {
            code: 'INVALID_REQUEST_BODY',
            statusCode: 400,
          },
        );
      }

      return {
        relativePath,
        content: fileContent,
        encoding,
      };
    });

    return {
      content,
      directoryName,
      fileName,
      files,
    };
  });

  return { entries };
};

const parseProvider = (value: unknown): LLMProvider => {
  const normalized = normalizeProviderParam(value);
  if (
    normalized === 'claude'
    || normalized === 'codex'
    || normalized === 'cursor'
    || normalized === 'opencode'
    || normalized === 'antigravity'
  ) {
    return normalized;
  }

  throw new AppError(`Unsupported provider "${normalized}".`, {
    code: 'UNSUPPORTED_PROVIDER',
    statusCode: 400,
  });
};

/** Both fields are optional: an empty body forks the whole conversation. */
const parseSessionForkPayload = (payload: unknown): { upToAnchorId?: string; title?: string } => {
  if (payload === undefined || payload === null) {
    return {};
  }
  if (typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const upToAnchorId = typeof body.upToAnchorId === 'string' ? body.upToAnchorId.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  return {
    ...(upToAnchorId ? { upToAnchorId } : {}),
    ...(title ? { title } : {}),
  };
};

const parseSessionRenameSummary = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  if (!summary) {
    throw new AppError('Summary is required.', {
      code: 'INVALID_SESSION_SUMMARY',
      statusCode: 400,
    });
  }

  if (summary.length > 500) {
    throw new AppError('Summary must not exceed 500 characters.', {
      code: 'INVALID_SESSION_SUMMARY',
      statusCode: 400,
    });
  }

  return summary;
};

const parseSessionSearchQuery = (value: unknown): string => {
  const query = readOptionalQueryString(value) ?? '';
  if (query.length < 2) {
    throw new AppError('Query must be at least 2 characters', {
      code: 'INVALID_SEARCH_QUERY',
      statusCode: 400,
    });
  }

  return query;
};

const parseSessionSearchLimit = (value: unknown): number => {
  const raw = readOptionalQueryString(value);
  if (!raw) {
    return 50;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new AppError('limit must be a valid integer.', {
      code: 'INVALID_QUERY_PARAMETER',
      statusCode: 400,
    });
  }

  return Math.max(1, Math.min(parsed, 100));
};

const parseBoundedIntegerQuery = <T extends number | null>(
  value: unknown,
  name: string,
  fallback: T,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number | T => {
  const raw = readOptionalQueryString(value);
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AppError(`${name} must be an integer between ${minimum} and ${maximum}.`, {
      code: 'INVALID_QUERY_PARAMETER',
      statusCode: 400,
    });
  }

  return parsed;
};

const parseSessionModelPayload = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const model = readOptionalQueryString(body.model);
  if (!model) {
    throw new AppError('model is required.', {
      code: 'MODEL_REQUIRED',
      statusCode: 400,
    });
  }

  return model;
};

const parseSessionEffortPayload = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const effort = readOptionalQueryString(body.effort);
  if (!effort) {
    throw new AppError('effort is required.', {
      code: 'EFFORT_REQUIRED',
      statusCode: 400,
    });
  }

  if (effort.length > 32) {
    throw new AppError('effort must be 32 characters or fewer.', {
      code: 'INVALID_EFFORT',
      statusCode: 400,
    });
  }

  return effort;
};

const parseModelRecordId = (value: unknown): number => {
  const rawRecordId = readPathParam(value, 'recordId').trim();
  if (!/^\d+$/.test(rawRecordId)) {
    throw new AppError('recordId must be a positive integer.', {
      code: 'INVALID_MODEL_RECORD_ID',
      statusCode: 400,
    });
  }

  const recordId = Number.parseInt(rawRecordId, 10);
  if (!Number.isSafeInteger(recordId) || recordId < 1) {
    throw new AppError('recordId must be a positive integer.', {
      code: 'INVALID_MODEL_RECORD_ID',
      statusCode: 400,
    });
  }

  return recordId;
};

const parseCustomProviderModelPayload = (payload: unknown): CustomProviderModelInput => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const model = readOptionalQueryString(body.model);
  const id = readOptionalQueryString(body.id);
  if (!model) {
    throw new AppError('model is required.', {
      code: 'MODEL_NAME_REQUIRED',
      statusCode: 400,
    });
  }
  if (!id) {
    throw new AppError('id is required.', {
      code: 'MODEL_ID_REQUIRED',
      statusCode: 400,
    });
  }
  if (model.length > 80) {
    throw new AppError('model must be 80 characters or fewer.', {
      code: 'MODEL_NAME_TOO_LONG',
      statusCode: 400,
    });
  }
  if (id.length > 200 || /\s/.test(id)) {
    throw new AppError('id must be 200 characters or fewer and cannot contain whitespace.', {
      code: 'INVALID_MODEL_ID',
      statusCode: 400,
    });
  }

  return { model, id };
};

router.get(
  '/:provider/auth/status',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const status = await providerAuthService.getProviderAuthStatus(provider);
    res.json(createApiSuccessResponse(status));
  }),
);

router.get(
  '/antigravity/accounts',
  asyncHandler(async (_req: Request, res: Response) => {
    const { antigravityAccountsService } = await import('./list/antigravity/antigravity-accounts.service.js');
    const result = await antigravityAccountsService.listAccounts();
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/antigravity/accounts/switch',
  asyncHandler(async (req: Request, res: Response) => {
    const email = req.body?.email;
    if (!email || typeof email !== 'string') {
      throw new AppError('email is required', { code: 'INVALID_INPUT', statusCode: 400 });
    }
    const { antigravityAccountsService } = await import('./list/antigravity/antigravity-accounts.service.js');
    const result = await antigravityAccountsService.switchAccount(email);
    if (!result.ok) {
      throw new AppError(result.error || 'Failed to switch account', { code: 'ACCOUNT_SWITCH_FAILED', statusCode: 400 });
    }
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/antigravity/accounts/add',
  asyncHandler(async (req: Request, res: Response) => {
    const { label, tokenData } = req.body || {};
    const { antigravityAccountsService } = await import('./list/antigravity/antigravity-accounts.service.js');
    const result = await antigravityAccountsService.addAccount(label, tokenData);
    if (!result.ok) {
      throw new AppError(result.error || 'Failed to add account', { code: 'ACCOUNT_ADD_FAILED', statusCode: 400 });
    }
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/antigravity/accounts/save-current',
  asyncHandler(async (req: Request, res: Response) => {
    const { label } = req.body || {};
    const { antigravityAccountsService } = await import('./list/antigravity/antigravity-accounts.service.js');
    const result = await antigravityAccountsService.addCurrentCliAccount(label);
    if (!result.ok) {
      throw new AppError(result.error || 'Failed to save current CLI account', { code: 'ACCOUNT_SAVE_CURRENT_FAILED', statusCode: 400 });
    }
    res.json(createApiSuccessResponse(result));
  }),
);

router.patch(
  '/antigravity/accounts/:email',
  asyncHandler(async (req: Request, res: Response) => {
    const rawEmail = readPathParam(req.params.email, 'email');
    const email = decodeURIComponent(rawEmail).trim();
    const { label } = req.body || {};
    if (!email) {
      throw new AppError('email is required', { code: 'INVALID_INPUT', statusCode: 400 });
    }
    const { antigravityAccountsService } = await import('./list/antigravity/antigravity-accounts.service.js');
    const result = await antigravityAccountsService.updateAccountLabel(email, String(label || ''));
    if (!result.ok) {
      throw new AppError(result.error || 'Failed to update account label', { code: 'ACCOUNT_UPDATE_FAILED', statusCode: 400 });
    }
    res.json(createApiSuccessResponse(result));
  }),
);

router.delete(
  '/antigravity/accounts/:email',
  asyncHandler(async (req: Request, res: Response) => {
    const rawEmail = readPathParam(req.params.email, 'email');
    const email = decodeURIComponent(rawEmail).trim();
    if (!email) {
      throw new AppError('email is required', { code: 'INVALID_INPUT', statusCode: 400 });
    }
    const { antigravityAccountsService } = await import('./list/antigravity/antigravity-accounts.service.js');
    const result = await antigravityAccountsService.removeAccount(email);
    if (!result.ok) {
      throw new AppError(result.error || 'Failed to remove account', { code: 'ACCOUNT_REMOVE_FAILED', statusCode: 400 });
    }
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/antigravity/accounts/login/start',
  asyncHandler(async (_req: Request, res: Response) => {
    const { antigravityAccountsService } = await import('./list/antigravity/antigravity-accounts.service.js');
    const result = await antigravityAccountsService.cliLoginStart();
    if (!result.ok) {
      throw new AppError(result.error || 'Failed to initiate login', { code: 'CLI_LOGIN_START_FAILED', statusCode: 500 });
    }
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/antigravity/accounts/login/complete',
  asyncHandler(async (req: Request, res: Response) => {
    const { id, code } = req.body || {};
    if (!id || !code) {
      throw new AppError('id and code are required', { code: 'INVALID_INPUT', statusCode: 400 });
    }
    const { antigravityAccountsService } = await import('./list/antigravity/antigravity-accounts.service.js');
    const result = antigravityAccountsService.cliLoginComplete(id, code);
    if (!result.ok) {
      throw new AppError(result.error || 'Failed to submit code', { code: 'CLI_LOGIN_COMPLETE_FAILED', statusCode: 400 });
    }
    res.json(createApiSuccessResponse(result));
  }),
);

router.get(
  '/antigravity/accounts/login/status',
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.query.id || '');
    if (!id) {
      throw new AppError('id query parameter is required', { code: 'INVALID_INPUT', statusCode: 400 });
    }
    const { antigravityAccountsService } = await import('./list/antigravity/antigravity-accounts.service.js');
    const result = await antigravityAccountsService.cliLoginStatus(id);
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/antigravity/accounts/login/cancel',
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.body?.id || '');
    if (id) {
      const { antigravityAccountsService } = await import('./list/antigravity/antigravity-accounts.service.js');
      antigravityAccountsService.cliLoginCancel(id);
    }
    res.json(createApiSuccessResponse({ ok: true }));
  }),
);

router.get(
  '/antigravity/quota',
  asyncHandler(async (req: Request, res: Response) => {
    const force = req.query.force === 'true';
    const email = typeof req.query.email === 'string' && req.query.email.trim() ? req.query.email.trim() : undefined;
    const { antigravityAccountsService } = await import('./list/antigravity/antigravity-accounts.service.js');
    const snapshot = await antigravityAccountsService.fetchLiveQuotaSummary(force, email);
    res.json(createApiSuccessResponse(snapshot));
  }),
);

router.get(
  '/antigravity/quota/snapshot',
  asyncHandler(async (req: Request, res: Response) => {
    const model = typeof req.query.model === 'string' ? req.query.model : undefined;
    const force = req.query.force === 'true';
    const email = typeof req.query.email === 'string' && req.query.email.trim() ? req.query.email.trim() : undefined;
    const { antigravityAccountsService } = await import('./list/antigravity/antigravity-accounts.service.js');
    const snapshot = await antigravityAccountsService.getTurnQuotaSnapshot(model, undefined, undefined, force, email);
    res.json(createApiSuccessResponse(snapshot));
  }),
);

router.get(
  '/antigravity/proxy-toggle',
  asyncHandler(async (_req: Request, res: Response) => {
    const { getProxyToggle } = await import('./list/antigravity/antigravity-proxy.js');
    const mode = getProxyToggle();
    res.json(createApiSuccessResponse({ enabled: mode === 'yes', mode }));
  }),
);

router.post(
  '/antigravity/proxy-toggle',
  asyncHandler(async (req: Request, res: Response) => {
    const { mode, enabled } = req.body || {};
    const targetMode = mode != null ? String(mode) : (enabled ? 'yes' : 'no');
    const { setProxyToggle } = await import('./list/antigravity/antigravity-proxy.js');
    const nextMode = setProxyToggle(targetMode);
    res.json(createApiSuccessResponse({ enabled: nextMode === 'yes', mode: nextMode }));
  }),
);

router.all(
  '/antigravity/proxy-test',
  asyncHandler(async (req: Request, res: Response) => {
    const mode = req.body?.mode || req.query?.mode;
    const { testProxyConnectivity } = await import('./list/antigravity/antigravity-proxy.js');
    const result = await testProxyConnectivity(mode as any);
    res.json(createApiSuccessResponse(result));
  }),
);

router.get(
  '/antigravity/proxy/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const { getProxyStatus } = await import('./list/antigravity/antigravity-proxy.js');
    res.json(createApiSuccessResponse(getProxyStatus()));
  }),
);

router.get(
  '/antigravity/proxy/urn-balance',
  asyncHandler(async (req: Request, res: Response) => {
    const { fetchUrnBalanceDetails } = await import('./list/antigravity/antigravity-proxy.js');
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const balance = await fetchUrnBalanceDetails(forceRefresh);
    res.json(createApiSuccessResponse(balance));
  }),
);

router.get(
  '/antigravity/proxy/locations',
  asyncHandler(async (_req: Request, res: Response) => {
    const { fetchBringYourLocations } = await import('./list/antigravity/bringyour-locations.js');
    const locations = await fetchBringYourLocations();
    const totalProviders = locations.reduce((sum: number, l: any) => sum + (l.count || 0), 0);
    res.json(createApiSuccessResponse({
      ok: true,
      totalCountries: locations.length,
      totalProviders,
      locations,
    }));
  }),
);

router.post(
  '/antigravity/proxy/restart',
  asyncHandler(async (_req: Request, res: Response) => {
    const { restartProxy } = await import('./list/antigravity/antigravity-proxy.js');
    const result = restartProxy();
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/antigravity/proxy/sleep',
  asyncHandler(async (_req: Request, res: Response) => {
    const { sleepProxyNow } = await import('./list/antigravity/antigravity-proxy.js');
    const result = sleepProxyNow();
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/antigravity/proxy/wake',
  asyncHandler(async (_req: Request, res: Response) => {
    const { wakeProxyNow } = await import('./list/antigravity/antigravity-proxy.js');
    const result = await wakeProxyNow();
    res.json(createApiSuccessResponse(result));
  }),
);

router.get(
  '/antigravity/proxy/settings',
  asyncHandler(async (_req: Request, res: Response) => {
    const { readUrnAuth, getProxyToggle } = await import('./list/antigravity/antigravity-proxy.js');
    const urn = readUrnAuth();
    const proxyToggle = getProxyToggle();
    res.json(createApiSuccessResponse({
      proxy: {
        enabled: proxyToggle === 'yes',
        mode: proxyToggle,
        userAuth: urn.userAuth,
        hasPassword: Boolean(urn.password),
        country: urn.country,
        region: urn.region,
        city: urn.city,
        providerId: urn.providerId,
        stable: urn.stable,
        privacy: urn.privacy,
        quantum: urn.quantum,
      },
    }));
  }),
);

router.post(
  '/antigravity/proxy/settings',
  asyncHandler(async (req: Request, res: Response) => {
    const { proxy } = req.body || {};
    const { writeUrnAuth, setProxyToggle, restartProxy } = await import('./list/antigravity/antigravity-proxy.js');
    const changed: string[] = [];

    if (proxy && typeof proxy === 'object') {
      if (proxy.enabled != null || proxy.mode != null) {
        const isEnabled = proxy.mode != null ? (String(proxy.mode).toLowerCase() === 'yes') : Boolean(proxy.enabled);
        const targetMode = isEnabled ? 'yes' : 'no';
        setProxyToggle(targetMode);
        changed.push(`代理模式(${targetMode === 'yes' ? '开启代理' : '直连模式'})`);
      }

      const vals: Record<string, any> = {};
      if (proxy.userAuth != null) vals.userAuth = String(proxy.userAuth).trim();
      if (proxy.password != null && String(proxy.password)) vals.password = String(proxy.password);
      if (proxy.country != null) vals.country = String(proxy.country).trim() || 'United States';
      if (proxy.region != null) vals.region = String(proxy.region).trim();
      if (proxy.city != null) vals.city = String(proxy.city).trim();
      if (proxy.providerId != null) vals.providerId = String(proxy.providerId).trim();
      if (proxy.stable != null) vals.stable = Boolean(proxy.stable);
      if (proxy.privacy != null) vals.privacy = Boolean(proxy.privacy);
      if (proxy.quantum != null) vals.quantum = Boolean(proxy.quantum);

      if (Object.keys(vals).length > 0) {
        writeUrnAuth(vals);
        changed.push('代理凭据/出口节点设置');
      }

      if (proxy.restartImmediately) {
        restartProxy();
        changed.push('已重启 SOCKS5 守护进程');
      }
    }

    res.json(createApiSuccessResponse({
      ok: true,
      changed,
      message: '已保存: ' + (changed.join('、') || '配置无变更'),
    }));
  }),
);

router.get(
  '/:provider/models',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const force = req.query.force === 'true';
    const models = await providerModelsService.getProviderModels(provider, { force });
    res.json(createApiSuccessResponse({ provider, models }));
  }),
);

router.post(
  '/:provider/models',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const input = parseCustomProviderModelPayload(req.body);
    const result = await providerModelsService.createCustomModel(provider, input);
    res.status(201).json(createApiSuccessResponse({ provider, ...result }));
  }),
);

router.patch(
  '/:provider/models/:recordId',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const recordId = parseModelRecordId(req.params.recordId);
    const input = parseCustomProviderModelPayload(req.body);
    const result = await providerModelsService.updateCustomModel(provider, recordId, input);
    res.json(createApiSuccessResponse({ provider, ...result }));
  }),
);

router.delete(
  '/:provider/models/:recordId',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const recordId = parseModelRecordId(req.params.recordId);
    const result = await providerModelsService.deleteCustomModel(provider, recordId);
    res.json(createApiSuccessResponse({ provider, ...result }));
  }),
);

/**
 * Reports which model one session is using. `requestedModel` lets the client
 * pass the default it would otherwise send, so a session that has not been
 * sent on yet resolves to that instead of the catalog default.
 */
router.get(
  '/:provider/sessions/:sessionId/active-model',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const sessionId = parseSessionId(req.params.sessionId);
    const requestedModel = readOptionalQueryString(req.query.requestedModel);
    const result = await providerModelsService.resolveSessionModel(provider, {
      sessionId,
      requestedModel,
    });
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/:provider/sessions/:sessionId/active-model',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const sessionId = parseSessionId(req.params.sessionId);
    const model = parseSessionModelPayload(req.body);
    const stored = providerModelsService.setSessionModel(provider, sessionId, model);
    // A session row only exists once the gateway has allocated one. Report the
    // selection back either way so the client can hold it until the first send.
    res.json(createApiSuccessResponse(
      stored ?? { provider, sessionId, model, effort: null, source: 'session' as const },
    ));
  }),
);

/** Records the reasoning-effort choice for one app session. */
router.post(
  '/:provider/sessions/:sessionId/active-effort',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const sessionId = parseSessionId(req.params.sessionId);
    const effort = parseSessionEffortPayload(req.body);
    const stored = providerModelsService.setSessionEffort(provider, sessionId, effort);
    // Mirror active-model behavior for a composer that picked an effort just
    // before the session gateway created its row.
    res.json(createApiSuccessResponse(
      stored ?? { provider, sessionId, effort, source: 'session' as const },
    ));
  }),
);

// ----------------- Skills routes -----------------
router.get(
  '/:provider/skills',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const skills = await providerSkillsService.listProviderSkills(provider, { workspacePath });
    res.json(createApiSuccessResponse({ provider, skills }));
  }),
);

router.post(
  '/:provider/skills',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const input = parseProviderSkillCreatePayload(req.body);
    const skills = await providerSkillsService.addProviderSkills(provider, input);
    res.json(createApiSuccessResponse({ provider, skills }));
  }),
);

router.delete(
  '/:provider/skills/:directoryName',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const result = await providerSkillsService.removeProviderSkill(provider, {
      directoryName: readPathParam(req.params.directoryName, 'directoryName'),
    });
    res.json(createApiSuccessResponse(result));
  }),
);

// ----------------- MCP routes -----------------
router.get(
  '/:provider/mcp/servers',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const scope = parseMcpScope(req.query.scope);

    if (scope) {
      const servers = await providerMcpService.listProviderMcpServersForScope(provider, scope, { workspacePath });
      res.json(createApiSuccessResponse({ provider, scope, servers }));
      return;
    }

    const groupedServers = await providerMcpService.listProviderMcpServers(provider, { workspacePath });
    res.json(createApiSuccessResponse({ provider, scopes: groupedServers }));
  }),
);

router.post(
  '/:provider/mcp/servers',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const payload = parseMcpUpsertPayload(req.body);
    const server = await providerMcpService.upsertProviderMcpServer(provider, payload);
    res.status(201).json(createApiSuccessResponse({ server }));
  }),
);

router.delete(
  '/:provider/mcp/servers/:name',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const scope = parseMcpScope(req.query.scope);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const result = await providerMcpService.removeProviderMcpServer(provider, {
      name: readPathParam(req.params.name, 'name'),
      scope,
      workspacePath,
    });
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/mcp/servers/global',
  asyncHandler(async (req: Request, res: Response) => {
    const payload = parseMcpUpsertPayload(req.body);
    if (payload.scope === 'local') {
      throw new AppError('Global MCP add supports only "user" or "project" scopes.', {
        code: 'INVALID_GLOBAL_MCP_SCOPE',
        statusCode: 400,
      });
    }

    const results = await providerMcpService.addMcpServerToAllProviders({
      ...payload,
      scope: payload.scope === 'user' ? 'user' : 'project',
    });
    res.status(201).json(createApiSuccessResponse({ results }));
  }),
);

router.get(
  '/capabilities',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(createApiSuccessResponse({
      providers: providerCapabilitiesService.listAllProviderCapabilities(),
    }));
  }),
);

router.get(
  '/:provider/capabilities',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    res.json(createApiSuccessResponse(
      providerCapabilitiesService.getProviderCapabilities(provider),
    ));
  }),
);

// ----------------- Session routes -----------------
/**
 * Session gateway entry point: allocates the stable app-facing session id for
 * a brand-new chat. The frontend must call this before the first `chat.send`
 * so the session id in the URL, the store, and the websocket all agree from
 * the very first message — there is no client-visible session-id handoff.
 */
router.post(
  '/sessions',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const provider = parseProvider(body.provider);
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
    const initialMessage = typeof body.initialMessage === 'string' ? body.initialMessage : '';
    const result = sessionsService.createAppSession(provider, projectPath, initialMessage);
    res.status(201).json(createApiSuccessResponse(result));
  }),
);

router.get(
  '/sessions/running',
  asyncHandler(async (_req: Request, res: Response) => {
    const sessions = sessionsService.listRunningSessions();
    res.json(createApiSuccessResponse({ sessions }));
  }),
);

router.get(
  '/sessions/recent',
  asyncHandler(async (req: Request, res: Response) => {
    const limit = parseBoundedIntegerQuery(req.query.limit, 'limit', 40, 1, 100);
    const offset = parseBoundedIntegerQuery(req.query.offset, 'offset', 0, 0);
    const page = sessionsService.listRecentSessions(limit, offset);
    res.json(createApiSuccessResponse(page));
  }),
);

router.get(
  '/sessions/archived',
  asyncHandler(async (_req: Request, res: Response) => {
    const sessions = sessionsService.listArchivedSessions();
    res.json(createApiSuccessResponse({ sessions }));
  }),
);

router.get(
  '/sessions/:sessionId/provider-id',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const providerSessionId = sessionsService.getProviderSessionId(sessionId);
    res.json(createApiSuccessResponse({ sessionId: providerSessionId }));
  }),
);

router.get(
  '/sessions/:sessionId/token-usage',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const result = await providerTokenUsageService.getSessionTokenUsage(sessionId);
    res.json(createApiSuccessResponse(result));
  }),
);

// Must stay registered after the static and session-specific routes so their
// literals never match the generic `:sessionId` parameter.
router.get(
  '/sessions/:sessionId',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const result = sessionsService.getSessionDetailsById(sessionId);
    res.json(createApiSuccessResponse(result));
  }),
);

router.delete(
  '/sessions/:sessionId',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const force = parseOptionalBooleanQuery(req.query.force, 'force') ?? false;
    const deletedFromDisk = parseOptionalBooleanQuery(req.query.deletedFromDisk, 'deletedFromDisk') ?? force;
    const result = await sessionsService.deleteOrArchiveSessionById(sessionId, {
      force,
      deletedFromDisk,
    });
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/sessions/:sessionId/restore',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const result = sessionsService.restoreSessionById(sessionId);
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/sessions/:sessionId/fork',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const result = await sessionsService.forkSessionById(sessionId, parseSessionForkPayload(req.body));
    res.status(201).json(createApiSuccessResponse(result));
  }),
);

router.put(
  '/sessions/:sessionId',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const summary = parseSessionRenameSummary(req.body);
    const result = sessionsService.renameSessionById(sessionId, summary);
    res.json(createApiSuccessResponse(result));
  }),
);

router.get(
  '/sessions/:sessionId/messages',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const limit = parseBoundedIntegerQuery(req.query.limit, 'limit', null, 0);
    const offset = parseBoundedIntegerQuery(req.query.offset, 'offset', 0, 0);

    const result = await sessionsService.fetchHistory(sessionId, {
      limit,
      offset,
    });
    res.json(createApiSuccessResponse(result));
  }),
);

router.get('/search/sessions', asyncHandler(async (req: Request, res: Response) => {
  const query = parseSessionSearchQuery(req.query.q);
  const limit = parseSessionSearchLimit(req.query.limit);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  const abortController = new AbortController();
  req.on('close', () => {
    closed = true;
    abortController.abort();
  });

  try {
    await sessionConversationsSearchService.search({
      query,
      limit,
      signal: abortController.signal,
      onTitleResults: (titleResults) => {
        if (!closed) {
          res.write(`event: title-results\ndata: ${JSON.stringify({ titleResults })}\n\n`);
        }
      },
      onProgress: ({ projectResult, totalMatches, scannedProjects, totalProjects }) => {
        if (closed) {
          return;
        }

        if (projectResult) {
          res.write(`event: result\ndata: ${JSON.stringify({ projectResult, totalMatches, scannedProjects, totalProjects })}\n\n`);
          return;
        }

        res.write(`event: progress\ndata: ${JSON.stringify({ totalMatches, scannedProjects, totalProjects })}\n\n`);
      },
    });

    if (!closed) {
      res.write('event: done\ndata: {}\n\n');
    }
  } catch (error) {
    console.error('Error searching conversations:', error);
    if (!closed) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Search failed' })}\n\n`);
    }
  } finally {
    if (!closed) {
      res.end();
    }
  }
}));

export default router;
