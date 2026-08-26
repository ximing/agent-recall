import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './markdown.css';

export function MarkdownView({ content, clamp = false }: { content: string; clamp?: boolean }) {
  const body = (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
  return clamp ? <div className="clamp">{body}</div> : body;
}
