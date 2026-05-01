export function PlaceholderPanel({ title, description, bullets = [] }) {
  return (
    <article className="placeholder-panel">
      <h2>{title}</h2>
      <p>{description}</p>
      {bullets.length > 0 ? (
        <ul>
          {bullets.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
    </article>
  );
}
