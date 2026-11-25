import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlertIcon } from 'lucide-react';

import type { PendingPermissionRequest } from '@/shared/types';
import { buildClaudeToolPermissionEntry, formatToolInputForDisplay } from '@/modules/chat/utils/chatPermissions';
import { getClaudeSettings } from '@/modules/chat/utils/chatStorage';
import { getPermissionPanel, registerPermissionPanel } from '@/modules/chat/tools/configs/permissionPanelRegistry';
import { AskUserQuestionPanel } from '@/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel';
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from '@/modules/chat/composer/Confirmation';

registerPermissionPanel('AskUserQuestion', AskUserQuestionPanel);

type PermissionRequestsBannerProps = {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
};

/**
 * Rendered by chat's ChatComposer above the input to surface pending tool
 * permission requests and their allow/deny/remember actions.
 */
export default function PermissionRequestsBanner({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
}: PermissionRequestsBannerProps) {
  const { t } = useTranslation();
  // Filter out plan tool requests — they are handled inline by PlanDisplay
  const filteredRequests = pendingPermissionRequests.filter(
    (r) => r.toolName !== 'ExitPlanMode' && r.toolName !== 'exit_plan_mode'
  );

  if (!filteredRequests.length) {
    return null;
  }

  return (
    <div className="mb-3 space-y-2">
      {filteredRequests.map((request) => {
        const CustomPanel = getPermissionPanel(request.toolName);
        if (CustomPanel) {
          return (
            <CustomPanel
              key={request.requestId}
              request={request}
              onDecision={handlePermissionDecision}
            />
          );
        }

        const rawInput = formatToolInputForDisplay(request.input);
        const permissionEntry = buildClaudeToolPermissionEntry(request.toolName, rawInput);
        const settings = getClaudeSettings();
        const alreadyAllowed = permissionEntry ? settings.allowedTools.includes(permissionEntry) : false;
        const rememberLabel = alreadyAllowed ? '已记住规则' : '始终允许';
        const matchingRequestIds = permissionEntry
          ? pendingPermissionRequests
              .filter(
                (item) =>
                  buildClaudeToolPermissionEntry(item.toolName, formatToolInputForDisplay(item.input)) === permissionEntry,
              )
              .map((item) => item.requestId)
          : [request.requestId];

        return (
          <Confirmation
            key={request.requestId}
            approval="pending"
            className="rounded-2xl border border-amber-500/30 bg-card/95 p-3.5 shadow-lg backdrop-blur-md"
          >
            <ConfirmationTitle className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <ShieldAlertIcon className="h-3.5 w-3.5" />
              </span>
              <ConfirmationRequest>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-foreground">需要操作确认</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted/80 px-2 py-0.5 text-xs text-muted-foreground">
                    <span>工具</span>
                    <code className="font-mono font-medium text-foreground">{request.toolName}</code>
                  </span>
                </div>
                {permissionEntry && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>放行规则</span>
                    <code className="rounded-md bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground/90">
                      {permissionEntry}
                    </code>
                  </div>
                )}
              </ConfirmationRequest>
            </ConfirmationTitle>

            {rawInput && (
              <details className="mt-2.5 rounded-xl border border-border/50 bg-muted/35 px-2.5 py-1.5">
                <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
                  查看调用参数
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-background/70 p-2 font-mono text-[11px] text-muted-foreground">
                  {rawInput}
                </pre>
              </details>
            )}

            <ConfirmationActions className="mt-3 gap-2">
              <ConfirmationAction
                variant="outline"
                className="rounded-full px-3.5 text-xs"
                onClick={() => handlePermissionDecision(request.requestId, { allow: false, message: t('chat:misc.userDeniedTool') })}
              >
                拒绝
              </ConfirmationAction>
              <ConfirmationAction
                variant="outline"
                className="rounded-full px-3.5 text-xs"
                onClick={() => {
                  if (permissionEntry && !alreadyAllowed) {
                    handleGrantToolPermission({ entry: permissionEntry, toolName: request.toolName });
                  }
                  handlePermissionDecision(matchingRequestIds, { allow: true, rememberEntry: permissionEntry });
                }}
                disabled={!permissionEntry}
              >
                {rememberLabel}
              </ConfirmationAction>
              <ConfirmationAction
                variant="default"
                className="rounded-full px-4 text-xs shadow-sm"
                onClick={() => handlePermissionDecision(request.requestId, { allow: true })}
              >
                允许本次
              </ConfirmationAction>
            </ConfirmationActions>
          </Confirmation>
        );
      })}
    </div>
  );
}
