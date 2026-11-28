import React, { memo, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTranslation } from 'react-i18next';

import { MermaidDiagram } from '@/modules/code-editor';
import { normalizeInlineCodeFences } from '@/modules/chat/utils/chatFormatting';
import { copyTextToClipboard } from '@/shared/utils';
import { SyntaxHighlighter } from '@/shared/syntaxHighlighter';
import { usePaletteOps } from '@/modules/command-palette';
import { buildSyntaxTheme } from '@/modules/chat/utils/syntaxHighlightTheme';
import type { PrismStyleSheet } from '@/modules/chat/utils/syntaxHighlightTheme';

type MarkdownProps = {
  children: React.ReactNode;
  className?: string;
  /** Render single newlines as hard line breaks (for user-typed messages). */
  breaks?: boolean;
};

// Links to the wider web (or in-page anchors) keep normal browser navigation;
// everything else is treated as a workspace file reference.
const isExternalHref = (href?: string): boolean =>
  !!href && (/^(https?:|mailto:|tel:|data:)/i.test(href) || href.startsWith('#'));

// Strip a trailing `:line` / `:line:col` suffix (e.g. `src/foo.ts:130`).
const stripLineSuffix = (value: string): string => value.replace(/:\d+(?::\d+)?$/, '');

const VIDEO_EXT_PATTERN = /\.(mp4|webm|mov|m4v|ogv)(?:[?#].*)?$/i;
const AUDIO_EXT_PATTERN = /\.(mp3|wav|ogg|m4a|aac|flac)(?:[?#].*)?$/i;
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|svg|bmp|ico)(?:[?#].*)?$/i;

const resolveLocalMediaUrl = (rawSrc: string): string => {
  if (rawSrc.startsWith('file://') || (rawSrc.startsWith('/') && !rawSrc.startsWith('/api/'))) {
    const cleanPath = rawSrc.replace(/^file:\/\//, '');
    return `/api/media/file?path=${encodeURIComponent(cleanPath)}`;
  }
  return rawSrc;
};

const getMediaKind = (rawSrc: string): 'video' | 'audio' | 'image' => {
  if (VIDEO_EXT_PATTERN.test(rawSrc)) return 'video';
  if (AUDIO_EXT_PATTERN.test(rawSrc)) return 'audio';
  return 'image';
};

const isPlayableOrImageMedia = (rawPath: string): boolean =>
  VIDEO_EXT_PATTERN.test(rawPath) || AUDIO_EXT_PATTERN.test(rawPath) || IMAGE_EXT_PATTERN.test(rawPath);

// A usable file path contains a separator or a filename with an extension.
const looksLikeFilePath = (value?: string): value is string => {
  if (!value) {
    return false;
  }
  const cleaned = stripLineSuffix(value.trim());
  if (!cleaned || cleaned === '#') {
    return false;
  }
  return /[\\/]/.test(cleaned) || /\.[a-z0-9]+$/i.test(cleaned);
};

// Extract plain text from link children so a reference rendered only as link
// text (e.g. `[src/foo.ts]()` with an empty href) can still be opened.
const childrenToText = (children: React.ReactNode): string => {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(childrenToText).join('');
  }
  if (React.isValidElement(children)) {
    return childrenToText((children.props as { children?: React.ReactNode }).children);
  }
  return '';
};

// The delimiters `remark-math` recognizes with `singleDollarTextMath` off.
const MATH_DELIMITER = /\$\$|\\\(|\\\[/;

const EMPTY_PLUGINS: never[] = [];

type CodeBlockProps = {
  node?: any;
  className?: string;
  children?: React.ReactNode;
  /** Set by the custom `pre` renderer: this code element is a fenced/indented block. */
  forceBlock?: boolean;
};

// `node` is destructured out so react-markdown's hast node never reaches the DOM.
const CodeBlock = ({ node: _node, className, children, forceBlock, ...props }: CodeBlockProps) => {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  // Fenced blocks carry a trailing newline in the tree; trim it so the
  // highlighter doesn't render an empty final line.
  const raw = (Array.isArray(children) ? children.join('') : String(children ?? '')).replace(/\n$/, '');
  // react-markdown v9+ dropped the `inline` prop: block code is whatever the
  // `pre` renderer hands us (forceBlock). Multiline is kept as a safety net.
  const shouldInline = !forceBlock && !/[\r\n]/.test(raw);

  if (shouldInline) {
    return (
      <code
        className={`whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[0.875em] text-foreground ${className || ''
          }`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';
  const languageLabel = language.charAt(0).toUpperCase() + language.slice(1);

  if (language === 'mermaid') {
    return <MermaidDiagram code={raw} />;
  }

  return (
    <div className="group my-3 overflow-hidden rounded-xl border border-border bg-muted/50 shadow-sm dark:bg-zinc-900">
      {/* Label row shares the block's background — no divider, ChatGPT-style */}
      <div className="flex items-center justify-between px-4 pt-2">
        <span className="select-none text-xs text-muted-foreground">{languageLabel}</span>
        <button
          type="button"
          onClick={() =>
            copyTextToClipboard(raw).then((success) => {
              if (success) {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            })
          }
          className={`rounded-md p-1 transition-opacity focus-visible:opacity-100 ${copied
            ? 'text-green-600 opacity-100 dark:text-green-500'
            : 'text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100'
            }`}
          title={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
          aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
        >
          {copied ? (
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
            </svg>
          )}
        </button>
      </div>

      <SyntaxHighlighter
        language={language}
        style={syntaxTheme.style}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: '0.8125rem',
          lineHeight: 1.6,
          padding: '0.5rem 1rem 1rem',
          // The container owns the background so the label row and code read as one panel.
          background: 'transparent',
        }}
        codeTagProps={{
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            background: 'transparent',
          },
        }}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
};

/**
 * One style object for both themes: switching between the two Prism objects
 * re-tokenized every mounted code block, so the theme-dependent values are CSS
 * variables and the toggle is a style recalculation instead.
 */
const syntaxTheme = buildSyntaxTheme(oneLight as PrismStyleSheet, oneDark as PrismStyleSheet);

// The `:root`/`.dark` declarations backing syntaxTheme.style. Injected once
// because the values are derived from the Prism theme objects at runtime and so
// cannot live in index.css. ThemeContext toggles `.dark` on <html>, which is
// what repaints the tokens.
const SYNTAX_THEME_STYLE_ELEMENT_ID = 'cc-syntax-theme';
if (!document.getElementById(SYNTAX_THEME_STYLE_ELEMENT_ID)) {
  const styleElement = document.createElement('style');
  styleElement.id = SYNTAX_THEME_STYLE_ELEMENT_ID;
  styleElement.textContent = syntaxTheme.css;
  document.head.appendChild(styleElement);
}

const markdownComponents = {
  code: CodeBlock,
  // Fenced/indented code arrives as <pre><code>. Re-render the child CodeBlock
  // with `forceBlock` so it always gets the block treatment (react-markdown v9+
  // no longer passes an `inline` flag), and skip the outer <pre> so Tailwind
  // Typography doesn't wrap the highlighter in a second dark shell.
  pre: ({ children }: { children?: React.ReactNode }) => {
    const child = Array.isArray(children) ? children.find(React.isValidElement) : children;
    if (React.isValidElement(child) && child.type === CodeBlock) {
      return <CodeBlock {...(child.props as CodeBlockProps)} forceBlock />;
    }
    return <>{children}</>;
  },
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-3 border-l-2 border-primary/50 pl-4 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-t border-border" />,
  p: ({ children }: { children?: React.ReactNode }) => <div className="mb-2 last:mb-0">{children}</div>,
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 list-outside list-disc space-y-1 pl-5 marker:text-current last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 list-outside list-decimal space-y-1 pl-5 marker:text-current last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="[&>div:last-child]:mb-0 [&>div]:mb-1">{children}</li>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      {/* my-0 cancels Tailwind Typography's table margin, which would show as blank bands inside the border */}
      <table className="my-0 min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-muted/60">{children}</thead>,
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="[&:last-child>td]:border-b-0">{children}</tr>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border-b border-border px-3 py-2 text-left font-semibold text-foreground">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border-b border-border/60 px-3 py-2 align-top">{children}</td>
  ),
};

/**
 * Used by chat's MessageComponent, ToolErrorDisplay and MarkdownContent to
 * render model-authored markdown with this module's shared prose styling,
 * code highlighting and table rules.
 */
function MarkdownBodyRenderer({ children, breaks = false }: Omit<MarkdownProps, 'className'>) {
  const content = useMemo(
    () => normalizeInlineCodeFences(String(children ?? '')),
    [children],
  );
  // Math support costs a remark tree pass plus a full KaTeX walk on every
  // render, and almost no assistant message contains math. Only wire the two
  // plugins up when the text has a delimiter they could act on.
  const hasMath = useMemo(() => MATH_DELIMITER.test(content), [content]);
  const remarkPlugins = useMemo(
    () => {
      const plugins: unknown[] = [remarkGfm];
      if (hasMath) {
        plugins.push([remarkMath, { singleDollarTextMath: false }]);
      }
      if (breaks) {
        plugins.push(remarkBreaks);
      }
      return plugins as any;
    },
    [breaks, hasMath],
  );
  const rehypePlugins = useMemo(() => (hasMath ? [rehypeKatex] : EMPTY_PLUGINS), [hasMath]);
  const { openFileInEditor } = usePaletteOps();

  const components = useMemo(
    () => ({
      ...markdownComponents,
      a: ({ href, children: linkChildren }: { href?: string; children?: React.ReactNode }) => {
        // Prefer the href when it is a real path; otherwise fall back to the
        // link text, since models often emit `[src/foo.ts]()` with an empty href.
        const linkText = childrenToText(linkChildren);
        const fileRef = looksLikeFilePath(href) ? href : looksLikeFilePath(linkText) ? linkText : undefined;

        if (fileRef && !isExternalHref(href)) {
          const cleanRef = stripLineSuffix(fileRef);
          if (isPlayableOrImageMedia(cleanRef)) {
            return (
              <a
                href={resolveLocalMediaUrl(cleanRef)}
                className="text-blue-600 hover:underline dark:text-blue-400"
                target="_blank"
                rel="noopener noreferrer"
              >
                {linkChildren}
              </a>
            );
          }
          return (
            <a
              href={href || fileRef}
              className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400"
              onClick={(event) => {
                event.preventDefault();
                openFileInEditor(cleanRef);
              }}
            >
              {linkChildren}
            </a>
          );
        }

        return (
          <a
            href={href}
            className="text-blue-600 hover:underline dark:text-blue-400"
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkChildren}
          </a>
        );
      },
      img: ({ src, alt, title }: { src?: string; alt?: string; title?: string }) => {
        if (!src) return null;

        const resolvedSrc = resolveLocalMediaUrl(src);
        const mediaKind = getMediaKind(src);

        if (mediaKind === 'video') {
          return (
            <span className="my-3 block max-w-full overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-50/50 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
              <video
                src={resolvedSrc}
                controls
                playsInline
                preload="metadata"
                title={title || alt || '视频预览'}
                className="max-h-[540px] w-full bg-black object-contain"
              />
              <span className="flex items-center justify-between gap-2 border-t border-zinc-100 bg-white/70 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400">
                <span className="truncate">🎬 {alt || '生成的视频'}</span>
                <a
                  href={resolvedSrc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-blue-600 hover:underline dark:text-blue-400"
                >
                  新窗口播放 / 下载
                </a>
              </span>
            </span>
          );
        }

        if (mediaKind === 'audio') {
          return (
            <span className="my-3 block max-w-full overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
              <audio src={resolvedSrc} controls preload="metadata" className="w-full" />
              {alt && (
                <span className="mt-1.5 block text-xs text-zinc-600 dark:text-zinc-400">
                  🎵 {alt}
                </span>
              )}
            </span>
          );
        }

        return (
          <span className="my-3 block max-w-full overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-50/50 shadow-sm transition-all hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900/50">
            <a
              href={resolvedSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative block overflow-hidden"
              title={title || alt || '点击在新窗口查看高清原图'}
            >
              <img
                src={resolvedSrc}
                alt={alt || '生成的图片'}
                className="max-h-[560px] w-auto max-w-full rounded-lg object-contain transition-transform duration-300 group-hover:scale-[1.01]"
                loading="lazy"
              />
              <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/70 px-2.5 py-1 text-xs text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                <span>🔍</span> 点击查看高清原图
              </span>
            </a>
            {alt && (
              <span className="block border-t border-zinc-100 bg-white/70 px-3 py-1.5 text-center text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400">
                🖼️ {alt}
              </span>
            )}
          </span>
        );
      },
    }),
    [openFileInEditor],
  );

  // 解析并提取文本中的 <agent-embed> 标签（Generative UI / 内嵌画卷卡片）
  const segments = useMemo(() => {
    if (!content || !content.includes('<agent-embed')) {
      return [{ type: 'markdown' as const, value: content }];
    }

    const result: Array<
      | { type: 'markdown'; value: string }
      | { type: 'embed'; src: string; height: string }
    > = [];

    const regex = /<agent-embed\s+src=["']([^"']+)["'](?:\s+height=["']([^"']+)["'])?[^>]*>(?:<\/agent-embed>)?/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        result.push({
          type: 'markdown',
          value: content.slice(lastIndex, match.index),
        });
      }
      const rawSrc = match[1] || '';
      const cleanSrc = rawSrc.replace(/^file:\/\//, '');
      result.push({
        type: 'embed',
        src: `/api/media/embed?path=${encodeURIComponent(cleanSrc)}`,
        height: match[2] || '520px',
      });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < content.length) {
      result.push({
        type: 'markdown',
        value: content.slice(lastIndex),
      });
    }

    return result;
  }, [content]);

  if (segments.length === 1 && segments[0].type === 'markdown') {
    return (
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components as any}>
        {segments[0].value}
      </ReactMarkdown>
    );
  }

  return (
    <div className="space-y-2">
      {segments.map((seg, idx) => {
        if (seg.type === 'embed') {
          return (
            <div key={idx} className="my-3 overflow-hidden rounded-2xl border border-zinc-200 shadow-md dark:border-zinc-800">
              <iframe
                src={seg.src}
                style={{ width: '100%', height: seg.height, border: 'none' }}
                className="w-full bg-transparent"
                sandbox="allow-scripts allow-same-origin allow-downloads"
              />
            </div>
          );
        }
        return (
          <ReactMarkdown key={idx} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components as any}>
            {seg.value}
          </ReactMarkdown>
        );
      })}
    </div>
  );
}

/**
 * Markdown blocks without the prose wrapper. Used by StreamingMarkdown so a
 * streamed reply's settled and pending halves render as siblings inside ONE
 * prose container — Tailwind Typography's `> :first-child`/`> :last-child`
 * margin rules are per-container, so two containers would zero the gap at the
 * seam and make it pop back when the boundary moves.
 *
 * Memoized so a re-render does not re-run remark, rehype, KaTeX and Prism over
 * text that has not changed.
 */
export const MarkdownBody = memo(MarkdownBodyRenderer);

/** Markdown in its own prose container. The form every non-streaming caller uses. */
export const Markdown = memo(function Markdown({ children, className, breaks }: MarkdownProps) {
  return (
    <div className={className}>
      <MarkdownBody breaks={breaks}>{children}</MarkdownBody>
    </div>
  );
});
