import Link from "next/link";
import { FREE_MATCH_LABEL } from "../lib/lobby-copy";

const ENTRIES = [
  {
    href: "/play?mode=vs_bot",
    title: "本地人机",
    blurb: "本座对局 · 其余座位自动",
  },
  {
    href: "/lobby?mode=create",
    title: "联机 · 建房",
    blurb: "生成房间码 · 满 4 开局",
  },
  {
    href: "/lobby?mode=join",
    title: "联机 · 加入",
    blurb: "输入房间码入座",
  },
  {
    href: "/lobby?mode=match",
    title: FREE_MATCH_LABEL,
    blurb: "排队入桌 · 无需二次确认",
  },
] as const;

export default function HomePage() {
  return (
    <main className="shell open-shell">
      <header className="hero open-hero">
        <p className="eyebrow">Requirement Storm</p>
        <h1>需求风暴</h1>
        <p className="lede">Web 联机职场卡牌 · 规则 v1.2</p>
      </header>

      <nav className="open-entries" aria-label="开局入口">
        {ENTRIES.map((entry) => (
          <Link key={entry.href} className="open-entry" href={entry.href}>
            <span className="open-entry-title">{entry.title}</span>
            <span className="open-entry-blurb">{entry.blurb}</span>
          </Link>
        ))}
      </nav>

      <p className="open-rules muted">
        <Link href="/rules">规则手册（占位）</Link>
      </p>
    </main>
  );
}
