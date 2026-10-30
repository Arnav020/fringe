import Link from "next/link";

export const REPO_URL = "https://github.com/Arnav020/fringe";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Fringe home">
      <span className="neu-sm grid h-10 w-10 place-items-center rounded-[13px]">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3" y="3" width="7" height="7" rx="2" fill="#F7DE7E" />
          <rect x="14" y="3" width="7" height="7" rx="2" fill="#A9D6A0" />
          <rect x="3" y="14" width="7" height="7" rx="2" fill="#A9C9EE" />
          <rect x="14" y="14" width="7" height="7" rx="3.5" fill="#d9482b" />
        </svg>
      </span>
      <span className="display text-[28px] leading-none text-ink">Fringe</span>
    </Link>
  );
}

export default function Nav() {
  return (
    <header className="mx-auto flex w-full max-w-[1480px] items-center justify-between px-4 sm:px-6 pt-5">
      <Logo />
      <nav className="flex items-center gap-2 sm:gap-3 text-[14.5px] font-medium text-ink-2">
        <Link href="/#how" className="hidden sm:block px-3 py-2 hover:text-ink">
          How it works
        </Link>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="hidden sm:block px-3 py-2 hover:text-ink">
          Source
        </a>
        <Link href="/studio?p=maya" className="btn-accent px-4 py-2.5 font-semibold">
          Open the studio
        </Link>
      </nav>
    </header>
  );
}
