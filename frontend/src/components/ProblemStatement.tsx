import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight, oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

import { useTheme } from "@/hooks/useTheme";

import styles from "./ProblemStatement.module.css";

interface Props {
  title: string;
  leetcodeId: number | null;
  externalId: string | null;
  category: string;
  isCore: boolean;
  markdown: string;
  problemId?: number;
}

export function ProblemStatement({
  title,
  leetcodeId,
  externalId,
  category,
  isCore,
  markdown,
  problemId,
}: Props) {
  const { theme } = useTheme();
  const codeStyle = theme === "dark" ? oneDark : oneLight;

  return (
    <article className={styles.article}>
      <header className={styles.header}>
        <div className={styles.meta}>
          <span className={styles.id}>
            {leetcodeId !== null
              ? `LeetCode ${leetcodeId}`
              : externalId ?? "—"}
          </span>
          <span className={styles.dot}>·</span>
          <span className={styles.category}>{category}</span>
          {isCore && <span className={styles.core} title="核心题">★</span>}
          {problemId !== undefined && (
            <Link
              to={`/history/${problemId}`}
              state={{ fromProblem: true }}
              className={styles.historyLink}
            >
              历史
            </Link>
          )}
        </div>
        <h1 className={styles.title}>{title}</h1>
      </header>
      <div className={`${styles.body} prose-serif`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node, ...props }) => (
              <a {...props} target="_blank" rel="noopener noreferrer" />
            ),
            code(props) {
              const { children, className, node: _node, ...rest } = props as {
                children?: React.ReactNode;
                className?: string;
                node?: unknown;
              };
              const match = /language-(\w+)/.exec(className || "");
              const isInline = !match && !String(children ?? "").includes("\n");
              if (isInline) {
                return <code className={className}>{children}</code>;
              }
              return (
                <SyntaxHighlighter
                  style={codeStyle as { [key: string]: React.CSSProperties }}
                  language={match ? match[1] : "text"}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    background: "var(--bg-soft)",
                    fontSize: 13,
                    borderRadius: 6,
                  }}
                  {...rest}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              );
            },
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </article>
  );
}
