const features = [
  { label: "Private by design", detail: "A small, self-hosted space for the people who matter." },
  { label: "Conversations, not noise", detail: "Direct chats and small groups in one calm place." },
  { label: "Yours to host", detail: "Your server, your data, your control." },
];
export default function App() {
  return (
    <main className="shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="/" aria-label="Duet home"><span className="brand-mark">d.</span><span>duet</span></a>
        <span className="topbar-note">A quieter kind of connection</span>
      </header>
      <section className="hero">
        <div className="eyebrow"><span className="status-dot" /> YOUR PRIVATE SPACE</div>
        <h1>Closer, without<br /><em>the noise.</em></h1>
        <p className="lead">A thoughtful place for your conversations. Private by design, made for the people who matter.</p>
        <a className="primary-link" href="/login">Enter your space <span aria-hidden="true">↗</span></a>
        <div className="feature-row">{features.map((feature, i) => <article className="feature" key={feature.label}><span className="feature-index">0{i + 1}</span><h2>{feature.label}</h2><p>{feature.detail}</p></article>)}</div>
      </section>
      <footer className="footer"><span>DUET / PRIVATE MESSAGING</span><span>MADE FOR A FEW, NOT EVERYONE.</span></footer>
    </main>
  );
}
