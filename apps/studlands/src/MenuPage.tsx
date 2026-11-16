import type { ReactNode } from 'react';
import { Key } from './input-hint.tsx';

/** A full-screen page of the title or pause menu: a Back entry, a big heading and the content. */
export function MenuPage({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <section className="title-page" aria-label={title}>
      <button type="button" className="page-back" onClick={onBack} data-pad-back>
        <span aria-hidden>‹</span> Back <Key k="Esc" pad="B" />
      </button>
      <h2>{title}</h2>
      <div className="page-body panel">{children}</div>
    </section>
  );
}
