import { useTranslation } from 'react-i18next';
import { PencilIcon, SendIcon, XIcon } from 'lucide-react';

type QueuedMessageCardProps = {
  content: string;
  attachmentCount?: number;
  onSendNow?: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

/**
 * Rendered by chat's ChatComposer to show the message queued for a busy
 * session, with send-now (abort current + send), edit and delete actions.
 */
export default function QueuedMessageCard({
  content,
  attachmentCount = 0,
  onSendNow,
  onEdit,
  onDelete,
}: QueuedMessageCardProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="settings-content-enter mx-auto w-full max-w-[54.25rem] rounded-2xl border border-primary/20 bg-card/95 px-3.5 py-2.5 shadow-sm backdrop-blur-md transition-all">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary"
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-primary">
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold">
              {t('input.queue.label', { defaultValue: '已排队' })}
            </span>
            <span className="text-muted-foreground/75">
              {t('input.queue.willSend', { defaultValue: '将在当前完成后自动发送' })}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 break-words text-sm leading-relaxed text-foreground/95">
            {content}
          </p>
          {attachmentCount > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {attachmentCount} {attachmentCount === 1 ? '个附件' : '个附件'}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 self-center">
          {onSendNow && (
            <button
              type="button"
              onClick={onSendNow}
              aria-label={t('input.queue.sendNow', { defaultValue: '立即发送' })}
              title={t('input.queue.sendNowHint', { defaultValue: '中止当前回复并立即发送此消息' })}
              className="inline-flex h-7 touch-manipulation items-center gap-1 rounded-full bg-primary px-2.5 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-95"
            >
              <SendIcon className="h-3 w-3" />
              <span>{t('input.queue.sendNow', { defaultValue: '立即发送' })}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            aria-label={t('input.queue.edit', { defaultValue: '编辑排队消息' })}
            title={t('input.queue.edit', { defaultValue: '编辑排队消息' })}
            className="flex h-7 w-7 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t('input.queue.delete', { defaultValue: '删除排队消息' })}
            title={t('input.queue.delete', { defaultValue: '删除排队消息' })}
            className="flex h-7 w-7 touch-manipulation items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
