import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Download,
  Fingerprint,
  HeartHandshake,
  Lock,
  MessageSquareText,
  MapPin,
  Music2,
  Search,
  ShieldCheck,
  Sparkles,
  Tv,
  Users,
  Wand2,
  Building2,
  Blocks,
  Home as HomeIcon,
} from "lucide-react";
import Nav, { REPO_URL } from "@/components/Nav";
import { PERSONAS } from "@/lib/personas";
import { FITZGERALD } from "@/lib/vocab";

const STEPS = [
  { icon: Wand2, title: "Understand", body: "Reads one sentence from a parent or SLP and pulls out the shows, songs, games, books, foods and places.", api: "Groq · gpt-oss-120b" },
  { icon: Search, title: "Resolve", body: "Finds each favourite in Qloo's 250M-entity taste graph, with a real picture for the button.", api: "GET /search" },
  { icon: Sparkles, title: "Expand", body: "Follows taste across domains: Bluey → Peppa Pig, Frozen II, Olivia Rodrigo. Age-rated for kids.", api: "GET /v2/insights × 5" },
  { icon: MapPin, title: "Localise", body: "Real places in their city that people with this taste over-index on, plus where to get their favourite food.", api: "GET /v2/tags · insights(place)" },
  { icon: Users, title: "Read the room", body: "Checks which age groups each topic lands with, so the board knows Bluey is a parent topic and Sinatra a grandkid one.", api: "urn:demographics" },
  { icon: HeartHandshake, title: "Bridge", body: "For a named partner, compares the two taste profiles and keeps topics both generations score positively.", api: "GET /v2/analysis/compare" },
  { icon: BadgeCheck, title: "Verify", body: "The LLM can only phrase and choose from ids Qloo returned. Anything else is dropped before it reaches the board.", api: "closed-set check" },
  { icon: MessageSquareText, title: "Keep it current", body: "“She’s into dinosaurs now.” A tool-calling agent turns that into Qloo lookups: a dinosaur tag filtered by her taste, swimming pools nearby.", api: "Groq tools → Qloo" },
];

export default function Home() {
  return (
    <main className="flex-1 overflow-x-hidden">
      <Nav />

      {/* Hero */}
      <section className="mx-auto grid w-full max-w-[1240px] gap-12 px-4 sm:px-6 pt-14 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div className="rise">
          <span className="neu-in-sm inline-flex items-center gap-2 px-3.5 py-1.5 text-[13px] font-semibold text-ink-2">
            <span className="h-2 w-2 rounded-full bg-accent" /> AAC, grounded in Qloo&rsquo;s taste graph
          </span>
          <h1 className="display mt-6 text-[52px] sm:text-[76px] leading-[0.95] text-ink">
            The words for <span className="italic text-accent">what they love.</span>
          </h1>
          <p className="mt-6 max-w-[34rem] text-[18px] leading-relaxed text-ink-2">
            Millions of people speak through AAC: tablets and picture boards that turn a tap into a voice. Those boards are built for needs:
            <i> eat, drink, toilet, pain.</i> Fringe is an agent that gives them the words for <b className="text-ink">Bluey, Sinatra and last night&rsquo;s game</b>,
            so they can do what people mostly talk for: connect.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/studio?p=maya" className="btn-accent inline-flex h-13 items-center gap-2 px-6 py-3.5 text-[16px] font-semibold">
              Open Maya&rsquo;s live board <ArrowRight size={18} />
            </Link>
            <Link href="/studio?p=custom" className="neu-btn inline-flex items-center gap-2 px-6 py-3.5 text-[16px] font-semibold text-ink">
              Build your own
            </Link>
          </div>
          <p className="mt-5 text-[13.5px] text-muted">Live agent · 7 Qloo capabilities · exports to Open Board Format · no account, nothing stored</p>
        </div>

        {/* Before / after */}
        <div className="rise relative" style={{ animationDelay: "120ms" }}>
          <div className="neu p-5 sm:p-6">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted">Maya&rsquo;s board today</div>
            <div className="mt-3 grid grid-cols-4 gap-2.5">
              {["eat", "drink", "toilet", "help", "more", "stop", "pain", "tired"].map((w, i) => (
                <div key={w} className="neu-in-sm grid h-14 place-items-center text-[15px] font-semibold text-muted">
                  {w}
                  <span className="sr-only">{i}</span>
                </div>
              ))}
            </div>
            <div className="my-5 flex items-center gap-3 text-[13px] text-muted">
              <span className="h-px flex-1 bg-line" />
              <span className="flex items-center gap-1.5 font-semibold text-accent">
                <Fingerprint size={15} /> one sentence + Qloo
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted">With Fringe</div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {(
                [
                  ["Bluey", "Can we watch Bluey?", "#F4B98A", Tv],
                  ["Taylor Swift", "Play Taylor Swift!", "#F7DE7E", Music2],
                  ["Grandpa Joe", "Grandpa, remember the prairie?", "#F5B9CF", HeartHandshake],
                ] as const
              ).map(([l, s, c, Icon]) => (
                <div key={l} className="neu-sm p-2">
                  <div className="grid aspect-[4/3] place-items-center rounded-xl" style={{ background: `linear-gradient(140deg, ${c} 0%, #fff7f0 100%)` }}>
                    <Icon size={30} strokeWidth={1.8} className="text-ink/70" />
                  </div>
                  <div className="mt-2 px-0.5 text-[14px] font-semibold text-ink">{l}</div>
                  <div className="px-0.5 pb-1 text-[11.5px] leading-snug text-muted">&ldquo;{s}&rdquo;</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {(["pronoun", "verb", "describe", "question", "social"] as const).map((k) => (
                <span key={k} className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: FITZGERALD[k].bg, color: FITZGERALD[k].ink }}>
                  {FITZGERALD[k].name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto mt-24 w-full max-w-[1240px] px-4 sm:px-6">
        <div className="grid gap-5 md:grid-cols-3">
          {[
            ["~4 million", "Americans can't reliably meet daily communication needs with their own speech.", "Beukelman & Mirenda, via the National Academies (2017)"],
            ["#1", "reason adults communicate is social closeness, ahead of information, etiquette or needs.", "Light's purposes of communicative interaction"],
            ["By hand", "is how personal “fringe” vocabulary gets added today: one button at a time, by a parent or SLP, and it goes stale.", "AAC practice guidance (AssistiveWare, PrAACtical AAC)"],
          ].map(([big, body, src]) => (
            <div key={big} className="neu p-6 sm:p-7">
              <div className="display text-5xl text-accent">{big}</div>
              <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{body}</p>
              <p className="mt-4 text-[12px] text-muted">{src}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-3xl text-center display text-[30px] sm:text-[38px] leading-tight text-ink">
          A board without culture is <span className="italic text-muted">technically functional.</span> A board that knows what someone loves is how they make friends.
        </p>
      </section>

      {/* Personas */}
      <section className="mx-auto mt-24 w-full max-w-[1240px] px-4 sm:px-6">
        <h2 className="display text-[40px] sm:text-[48px] leading-none text-ink">Try it with a real-feeling person</h2>
        <p className="mt-3 max-w-2xl text-[16px] text-muted">Each board below is built live by the agent from a one-line note. Tap a picture to hear it speak; tap <b className="text-ink-2">i</b> to see the Qloo evidence.</p>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {PERSONAS.map((p) => (
            <Link key={p.slug} href={`/studio?p=${p.slug}`} className="neu group block p-6 transition-transform hover:-translate-y-1">
              <div className="flex items-center gap-3">
                <span className="neu-in-sm grid h-12 w-12 place-items-center display text-2xl text-accent">{p.name[0]}</span>
                <div>
                  <div className="display text-2xl leading-none text-ink">
                    {p.name}, {p.age}
                  </div>
                  <div className="mt-1 text-[13px] text-muted">{p.condition}</div>
                </div>
              </div>
              <p className="mt-5 text-[16px] italic leading-snug text-ink-2">{p.headline}</p>
              <p className="mt-4 text-[13.5px] text-muted">Loves {p.likes}.</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent">
                Build {p.name}&rsquo;s board <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto mt-24 w-full max-w-[1240px] scroll-mt-10 px-4 sm:px-6">
        <h2 className="display text-[40px] sm:text-[48px] leading-none text-ink">An agent, not a prompt</h2>
        <p className="mt-3 max-w-2xl text-[16px] text-muted">
          The language model handles language. Qloo decides <i>what</i> goes on the board. Every step is streamed to the studio, so you can watch it work.
        </p>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="neu p-5">
              <div className="flex items-center justify-between">
                <span className="neu-in-sm grid h-11 w-11 place-items-center text-accent">
                  <s.icon size={19} />
                </span>
                <span className="font-mono text-[12px] text-muted">0{i + 1}</span>
              </div>
              <h3 className="mt-4 text-[18px] font-semibold text-ink">{s.title}</h3>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{s.body}</p>
              <p className="mt-3 font-mono text-[12px] text-accent">{s.api}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Why Qloo */}
      <section className="mx-auto mt-24 w-full max-w-[1240px] px-4 sm:px-6">
        <div className="neu grid gap-8 p-6 sm:p-10 lg:grid-cols-2">
          <div>
            <h2 className="display text-[38px] sm:text-[44px] leading-none text-ink">Why it needs a taste graph</h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-2">
              Ask a language model alone and you get a reasonable list of words. The studio runs that experiment live, then checks every suggestion against Qloo.
              The difference is everything an AAC button actually needs.
            </p>
            <Link href="/studio?p=leo" className="neu-btn mt-6 inline-flex items-center gap-2 px-5 py-3 text-[15px] font-semibold text-ink">
              See the side-by-side <ArrowRight size={16} />
            </Link>
          </div>
          <div className="grid gap-3">
            {[
              ["A recognisable picture for every button", "Pre-literate kids and people with aphasia navigate by image, not text."],
              ["Places that exist, near them", "Addresses in their own city, matched to their taste profile, not a guess."],
              ["Who a topic will land with", "Qloo demographics: talk Bluey with parents, Sinatra with the grandkids."],
              ["Common ground with a specific person", "Compare + joint signals find what an 8-year-old and a 68-year-old both love."],
            ].map(([t, b]) => (
              <div key={t} className="neu-in-sm flex gap-3 p-4">
                <BadgeCheck size={20} className="mt-0.5 shrink-0 text-ok" />
                <div>
                  <div className="text-[15px] font-semibold text-ink">{t}</div>
                  <div className="mt-0.5 text-[14px] text-muted">{b}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Built for practice */}
      <section className="mx-auto mt-24 w-full max-w-[1240px] px-4 sm:px-6">
        <h2 className="display text-[40px] sm:text-[48px] leading-none text-ink">Built the way AAC is practised</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [Fingerprint, "Core words never move", "High-frequency words stay in fixed positions so motor plans stay stable. Personal vocabulary lives in topic folders."],
            [ShieldCheck, "A human approves", "Favourites you named go straight in. Everything the agent suggests waits for a parent or SLP to keep or remove."],
            [Download, "No lock-in", "Exports to Open Board Format (.obz), the open interchange format for AAC boards, with pictures and phrases."],
            [HeartHandshake, "Talk with someone", "Build a page for one conversation partner: shared themes, joint topics, and questions to ask them."],
            [Sparkles, "Evidence on every button", "Affinity score, source, age groups and address. Nothing is unexplained."],
            [Lock, "Nothing stored", "No account. Boards live in your browser; the server keeps no personal data."],
          ].map(([Icon, t, b]) => {
            const I = Icon as typeof Lock;
            return (
              <div key={t as string} className="neu p-6">
                <I size={22} className="text-accent" />
                <h3 className="mt-4 text-[18px] font-semibold text-ink">{t as string}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{b as string}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Where it goes */}
      <section className="mx-auto mt-24 w-full max-w-[1240px] px-4 sm:px-6">
        <h2 className="display text-[40px] sm:text-[48px] leading-none text-ink">Who it&rsquo;s for, and where it goes</h2>
        <p className="mt-3 max-w-3xl text-[16px] text-muted">
          AAC hardware and apps are routinely funded by insurance and schools. The labour of making them <i>personal</i> is not: it falls on parents and on
          speech-language pathologists with full caseloads. Fringe turns that labour into a one-sentence review task.
        </p>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            [HomeIcon, "Families", "Free in the browser. Describe your person, review the suggestions, export to the AAC app you already use.", "Today"],
            [Building2, "SLPs & schools", "A caseload studio: one board per student, refreshed each term as tastes change, with partner pages for classmates and aides.", "Next"],
            [Blocks, "AAC platforms", "Fringe as an API and agent tool: the taste layer AAC never had, plugged into existing apps through Open Board Format.", "Then"],
          ].map(([Icon, t, b, when]) => {
            const I = Icon as typeof Lock;
            return (
              <div key={t as string} className="neu p-6">
                <div className="flex items-center justify-between">
                  <I size={22} className="text-accent" />
                  <span className="neu-in-sm px-2.5 py-1 text-[12px] font-semibold text-muted">{when as string}</span>
                </div>
                <h3 className="mt-4 text-[18px] font-semibold text-ink">{t as string}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{b as string}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto mt-24 w-full max-w-[1240px] px-4 sm:px-6">
        <div className="neu-in grid place-items-center px-6 py-14 text-center">
          <h2 className="display text-[40px] sm:text-[56px] leading-none text-ink">
            Give someone <span className="italic text-accent">their</span> words.
          </h2>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/studio?p=maya" className="btn-accent inline-flex items-center gap-2 px-6 py-3.5 text-[16px] font-semibold">
              Open the studio <ArrowRight size={18} />
            </Link>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="neu-btn inline-flex items-center gap-2 px-6 py-3.5 text-[16px] font-semibold text-ink">
              Read the source
            </a>
          </div>
        </div>
      </section>

      <footer className="mx-auto mt-16 flex w-full max-w-[1240px] flex-col gap-2 px-4 sm:px-6 pb-10 text-[13px] text-muted sm:flex-row sm:justify-between">
        <span>Fringe · built for the Qloo Agentic Hackathon · MIT licensed</span>
        <span>Taste data by Qloo Taste AI™. Fringe is not a medical device; boards are reviewed by the people who know the user.</span>
      </footer>
    </main>
  );
}
