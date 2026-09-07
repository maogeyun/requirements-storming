import Link from "next/link";

export default function HomePage() {
  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Requirement Storm</p>
        <h1>需求风暴</h1>
        <p className="lede">Web 联机职场卡牌 · 规则 v1.2</p>
      </header>
      <section className="setup">
        <Link className="primary" href="/play" style={{ display: "inline-block", textAlign: "center", textDecoration: "none" }}>
          进入 M1 可玩壳
        </Link>
        <nav className="muted" style={{ marginTop: "0.5rem" }}>
          <Link href="/rules" style={{ color: "inherit" }}>
            规则手册（占位）
          </Link>
        </nav>
      </section>
    </main>
  );
}
