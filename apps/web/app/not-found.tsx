export default function NotFound() {
  return (
    <main className="public">
      <span className="eyebrow">DIM / 404</span>
      <h1>Este caminho não existe.</h1>
      <p>Volte ao seu espaço de operação.</p>
      <a className="button" href="/dashboard">
        Abrir dashboard
      </a>
    </main>
  );
}
