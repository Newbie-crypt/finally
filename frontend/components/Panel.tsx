import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  /** Right-aligned slot in the panel header — counts, filters, small controls. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, aside, children, className = '' }: PanelProps) {
  return (
    <section className={`panel ${className}`} aria-label={title}>
      <header className="panel-head">
        <h2 className="eyebrow">{title}</h2>
        {aside}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}
