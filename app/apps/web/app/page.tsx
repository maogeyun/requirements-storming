import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight">需求风暴</h1>
      <p className="text-lg text-slate-300">Requirement Storm · Web 联机版 v1.2</p>
      <p className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-slate-400">
        大厅开发中 — M2 将开放创建房间与加入对局
      </p>
      <nav className="flex gap-4 text-sm">
        <Link className="text-sky-400 hover:underline" href="/rules">
          规则手册
        </Link>
      </nav>
    </main>
  );
}
