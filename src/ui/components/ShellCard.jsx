export function ShellCard({ eyebrow, title, children, className = '' }) {
  return (
    <section className={`shell-card ${className}`.trim()}>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}
