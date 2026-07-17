import type { CSSProperties, ReactNode } from 'react';

/** Page frame: dark background, centered content column. */
export function Shell({
  children,
  center,
  maxWidth,
}: {
  children: ReactNode;
  center?: boolean;
  maxWidth?: number;
}) {
  const style: CSSProperties | undefined = maxWidth ? { maxWidth } : undefined;
  return (
    <div className={`page${center ? ' center' : ''}`}>
      <div className="container" style={style}>
        {children}
      </div>
    </div>
  );
}
