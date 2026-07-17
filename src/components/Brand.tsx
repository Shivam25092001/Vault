export function Brand({ sm }: { sm?: boolean }) {
  return (
    <div className={`brand${sm ? ' sm' : ''}`}>
      <span className="mark" aria-hidden>
        V
      </span>
      <span className="word">Vault</span>
    </div>
  );
}
