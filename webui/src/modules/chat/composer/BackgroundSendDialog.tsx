import { useTranslation } from 'react-i18next';

import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import type { BackgroundSendChoice, BackgroundSendPrompt } from '@/shared/types';

type BackgroundSendDialogProps = {
  prompt: BackgroundSendPrompt | null;
  onResolve: (choice: BackgroundSendChoice) => void;
};

/**
 * Rendered by chat's ChatComposer when a message is sent to a session whose
 * turn has ended but whose background work is still running. Sending now
 * stops that work, so the choices are to send anyway, queue the message until
 * the work finishes, or cancel.
 *
 * Cancel comes first in the DOM so Dialog's open-focus lands on it: an Enter
 * pressed right after the send that opened the prompt (a double Enter, a key
 * repeat) cancels instead of stopping the work. Esc and a click outside also
 * cancel. Sending anyway takes a deliberate click or Tab.
 */
export default function BackgroundSendDialog({ prompt, onResolve }: BackgroundSendDialogProps) {
  const { t } = useTranslation('chat');

  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open) {
          onResolve('cancel');
        }
      }}
    >
      <DialogContent aria-describedby="background-send-dialog-description" className="p-5">
        <DialogTitle className="not-sr-only text-base font-semibold text-foreground">
          {t('claudeStatus.backgroundTask.prompt.title', {
            defaultValue: '当前会话仍有后台任务正在运行',
          })}
        </DialogTitle>

        {prompt && prompt.work.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground/90">
            {prompt.work.map((item, index) => (
              <li key={`${index}-${item}`} className="break-words">{item}</li>
            ))}
          </ul>
        )}

        <p id="background-send-dialog-description" className="mt-3 text-sm text-muted-foreground">
          {t('claudeStatus.backgroundTask.prompt.description', {
            defaultValue: '发送新消息将开启新轮次并终止正在运行的后台任务；未汇报的内容可能会丢失。你可以选择排队发送，等待后台任务执行完成后自动发送。',
          })}
        </p>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onResolve('cancel')}>
            {t('claudeStatus.backgroundTask.prompt.cancel', { defaultValue: '取消' })}
          </Button>
          <Button type="button" variant="default" onClick={() => onResolve('queue')}>
            {t('claudeStatus.backgroundTask.prompt.queue', { defaultValue: '排队等待 (Queue)' })}
          </Button>
          <Button type="button" variant="destructive" onClick={() => onResolve('send')}>
            {t('claudeStatus.backgroundTask.prompt.sendAnyway', { defaultValue: '仍要发送 (终止任务)' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
