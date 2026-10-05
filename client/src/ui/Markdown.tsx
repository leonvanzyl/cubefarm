import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

// Agent-written prose (the CEO's texts, resumes, job descriptions) rendered as Markdown.
// Safe by default: raw HTML is shown as text, never parsed, and only http(s)/mailto links work.

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

/** Turns raw HTML (`<script>`, `<img onerror>`, …) into plain text, so it's shown exactly as written. */
function remarkHtmlAsText() {
  const walk = (node: MdNode) => {
    if (node.type === 'html') node.type = 'text';
    node.children?.forEach(walk);
  };
  return walk;
}

const SAFE_LINK = /^(https?:|mailto:)/i;
const safeUrl = (url: string) => (SAFE_LINK.test(url.trim()) ? url : '');

const components: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span className="md-deadlink">{children}</span>
    ),
  // Images would load arbitrary URLs and blow up the layout; show them as links instead.
  img: ({ src, alt }) =>
    typeof src === 'string' && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        🖼 {alt || src}
      </a>
    ) : (
      <span>🖼 {alt}</span>
    ),
  table: ({ children }) => (
    <div className="md-table" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
  // Code blocks (and tables, above) scroll sideways: focusable, so the keyboard can scroll them too.
  pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
};

// remark-breaks keeps single line breaks, as the phone showed them before Markdown.
const remarkPlugins = [remarkGfm, remarkHtmlAsText, remarkBreaks];

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ? `md ${className}` : 'md'}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components} urlTransform={safeUrl}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
