import { MEMORY_TYPES, type MemoryType } from '@agent-recall/dto';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Code, Link2, List, ListOrdered, TextQuote } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Markdown } from 'tiptap-markdown';
import { fromDateInputValue, toDateInputValue } from '@/utils/format';
import { TYPE_LABEL } from '@/utils/labels';
import { DateField } from '@/components/ui/DateField';
import { Select } from '@/components/ui/Select';
import './editor.css';

/** 提交时随内容一起带回的元数据；expiresAt 为 null 表示清除 */
export type MemoryEditorMeta = {
  type?: MemoryType;
  tags?: string[];
  expiresAt?: string | null;
  project?: string;
  sessionId?: string;
};

type MemoryEditorProps = {
  initialMarkdown: string;
  placeholder: string;
  submitLabel: string;
  submitting?: boolean;
  initialType?: MemoryType | null;
  initialTags?: string[];
  initialExpiresAt?: string | null;
  /** 仅新建时收集项目和会话，编辑接口不改这两项 */
  allowPlacement?: boolean;
  onSubmit: (markdown: string, meta: MemoryEditorMeta) => void;
  onCancel: () => void;
};

function markdownOf(editor: Editor): string {
  return (editor.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown().trim();
}

export function MemoryEditor({
  initialMarkdown,
  placeholder,
  submitLabel,
  submitting,
  initialType,
  initialTags,
  initialExpiresAt,
  allowPlacement,
  onSubmit,
  onCancel,
}: MemoryEditorProps) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const submitRef = useRef<() => void>(() => {});
  const [type, setType] = useState<MemoryType | ''>(initialType ?? '');
  const [tagsText, setTagsText] = useState((initialTags ?? []).join(', '));
  const [expiresAt, setExpiresAt] = useState(toDateInputValue(initialExpiresAt));
  const [project, setProject] = useState('');
  const [sessionId, setSessionId] = useState('');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
      Markdown,
    ],
    content: initialMarkdown,
    autofocus: 'end',
    onTransaction: () => bump(),
    editorProps: {
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          submitRef.current();
          return true;
        }
        return false;
      },
    },
  });

  const submit = (): void => {
    if (!editor) return;
    const tags = tagsText
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    onSubmit(markdownOf(editor), {
      type: type || undefined,
      tags,
      expiresAt: expiresAt ? fromDateInputValue(expiresAt) : null,
      project: allowPlacement ? project.trim() || undefined : undefined,
      sessionId: allowPlacement ? sessionId.trim() || undefined : undefined,
    });
  };
  submitRef.current = submit;

  // 卸载时销毁，避免抽屉快速切换泄漏
  useEffect(() => () => editor?.destroy(), [editor]);

  if (!editor) return null;

  const btn = (active: boolean): string => `wbtn${active ? ' active' : ''}`;
  const setLink = (): void => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('链接地址（留空移除链接）', prev ?? 'https://');
    if (url === null) return;
    if (url.trim() === '') editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url.trim() }).run();
  };

  return (
    <div className="weditor">
      <div className="wtoolbar">
        <button type="button" className={btn(editor.isActive('bold'))} title="加粗" onClick={() => editor.chain().focus().toggleBold().run()}>
          <b>B</b>
        </button>
        <button type="button" className={btn(editor.isActive('italic'))} title="斜体" onClick={() => editor.chain().focus().toggleItalic().run()}>
          <i>I</i>
        </button>
        <button type="button" className={btn(editor.isActive('strike'))} title="删除线" onClick={() => editor.chain().focus().toggleStrike().run()}>
          <s>S</s>
        </button>
        <span className="wsep" />
        <button
          type="button"
          className={btn(editor.isActive('heading', { level: 1 }))}
          title="一级标题"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          H1
        </button>
        <button
          type="button"
          className={btn(editor.isActive('heading', { level: 2 }))}
          title="二级标题"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </button>
        <span className="wsep" />
        <button type="button" className={btn(editor.isActive('bulletList'))} title="无序列表" onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={14} strokeWidth={1.6} />
        </button>
        <button type="button" className={btn(editor.isActive('orderedList'))} title="有序列表" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={14} strokeWidth={1.6} />
        </button>
        <button type="button" className={btn(editor.isActive('blockquote'))} title="引用" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <TextQuote size={14} strokeWidth={1.6} />
        </button>
        <button type="button" className={btn(editor.isActive('code'))} title="行内代码" onClick={() => editor.chain().focus().toggleCode().run()}>
          <Code size={14} strokeWidth={1.6} />
        </button>
        <span className="wsep" />
        <button type="button" className={btn(editor.isActive('link'))} title="链接" onClick={setLink}>
          <Link2 size={14} strokeWidth={1.6} />
        </button>
      </div>
      <EditorContent editor={editor} className="wcontent md" />
      <div className="meta-fields">
        <label className="meta-field">
          <span>类型</span>
          <Select
            ariaLabel="记忆类型"
            value={type}
            options={[{ value: '', label: '未分类' }, ...MEMORY_TYPES.map((value) => ({ value, label: TYPE_LABEL[value] }))]}
            onChange={(next) => setType(next as MemoryType | '')}
          />
        </label>
        <label className="meta-field grow">
          <span>标签（逗号分隔）</span>
          <input
            className="field"
            value={tagsText}
            onChange={(event) => setTagsText(event.target.value)}
            placeholder="例如：前端, 性能"
          />
        </label>
        {allowPlacement ? (
          <>
            <label className="meta-field">
              <span>项目</span>
              <input className="field" value={project} onChange={(event) => setProject(event.target.value)} placeholder="可选" />
            </label>
            <label className="meta-field">
              <span>会话 ID</span>
              <input
                className="field"
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                placeholder="填上后会出现在会话页"
              />
            </label>
          </>
        ) : null}
        <label className="meta-field">
          <span>过期时间</span>
          <DateField ariaLabel="过期时间" value={expiresAt} placeholder="不过期" onChange={setExpiresAt} />
        </label>
      </div>
      <div className="weditor-foot">
        <button type="button" className="btn primary" disabled={submitting || editor.isEmpty} onClick={submit}>
          {submitLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          取消
        </button>
        <span className="spacer" />
        <span className="composer-hint">⌘ + Enter 保存</span>
      </div>
    </div>
  );
}
