# Fringe: the words for what they love

**Tagline:** An AI agent that builds personal AAC communication boards from Qloo's taste graph, so people who can't rely on speech can talk about what they love.

- **Live demo:** https://fringe-aac.vercel.app (no login; open a persona and the agent builds the board live)
- **Code:** https://github.com/Arnav020/fringe (MIT)

---

## Inspiration

About 4 million Americans can't reliably meet their daily communication needs with their own speech (Beukelman & Mirenda, cited by the National Academies). Many of them speak through **AAC**: augmentative and alternative communication, the tablets and picture boards that turn a tap into a voice.

Look at a typical AAC board and you'll find *eat, drink, toilet, help, pain*. That's technically functional. But when adults rank why they communicate, **social closeness** comes first, ahead of needs (Light's purposes of communicative interaction). Closeness runs on *fringe vocabulary*, the personal words for a favourite show, a band, a team or a local place. Today a parent or speech-language pathologist adds those words **by hand**, one button at a time, and they go stale the moment tastes change.

An 8-year-old whose board can say "juice" but not "Bluey" can't join the conversation at school. This hackathon asks for the case where cultural intelligence is the difference between "technically functional" and "actually good". For AAC, it's the difference between asking for things and making friends.

## What it does

A caregiver writes one sentence: *"Loves Bluey, Taylor Swift, Encanto, Minecraft, mac and cheese, swimming."* Fringe's agent builds a working, talking AAC board of about 50 picture buttons in roughly 10 seconds, and every step streams live into the studio.

- **Talking board.** A sentence strip with text-to-speech; 16 core words in **fixed positions**, colour-coded with the Modified Fitzgerald Key, as AAC practice recommends for motor planning; and personal topic folders (Shows, Movies, Music, Games, Books, People, Places, Food) with real pictures and natural first-person phrases ("Can we watch Bluey?"), plus social-closeness phrases ("Have you seen it?").
- **Evidence on every button.** The Qloo affinity score, why it was suggested, which age groups it lands with, the address for places, and the Qloo entity id.
- **Reads the room.** Qloo demographics tell Maya that Bluey is a *parents & teachers* topic, and tell Ruth (71) that Casablanca also lands with her *grandkids*.
- **Talk with someone specific.** For a named partner (Grandpa Joe, 68), the agent compares both taste profiles with Qloo Compare. It finds shared themes (Country, Blues, Folk, Comedy, Family), searches with both profiles as the signal, and keeps topics with positive affinity in **both** age groups. *Little House on the Prairie* scores +22 for Maya's age group and +13 for Grandpa's. Each age-affinity pair is drawn as a bar chart.
- **Keeps it current.** *"She's obsessed with dinosaurs now. Find somewhere she can swim. Remove Hello Neighbor, it scares her."* A **tool-calling agent** plans the changes and runs Qloo-backed tools. Dinosaurs becomes a Qloo tag used as a hard filter and ranked by *her* taste: *The Land Before Time* and *We're Back! A Dinosaur's Story*, not just Jurassic Park. It also finds real swimming pools in Austin and removes the scary game.
- **Human in the loop.** Favourites the caregiver named go straight in. Everything the agent suggests waits in a review queue for a parent or SLP to keep or remove.
- **Culturally specific, not US-template.** Aarav (12, Mumbai) gets Chhota Bheem, Motu Patlu, Lagaan, Shreya Ghoshal and Shah Rukh Khan. Tell the agent *"he's crazy about Virat Kohli now, find a cricket ground near him"* and it adds Sachin Tendulkar and Rohit Sharma, plus Wankhede Stadium and local gymkhanas.
- **Access-aware.** "Large targets" mode gives eye-gaze, switch and motor-access users fewer, bigger buttons. It's on by default for Leo, who uses eye-gaze.
- **No lock-in.** One-click export to **Open Board Format (.obz)**, the open interchange format for AAC boards.
- **"Without Qloo", run live.** The same model fills the same board with no taste graph, and every suggestion is checked against Qloo. On Maya's note, 9 of 12 LLM-only suggestions just restate the note, and its local "places" are events that can't be verified. It has no pictures and no audience signal.

## How it's Qloo-powered

The LLM handles language. **Qloo decides what goes on the board**: the curation step may only choose from ids Qloo returned (sent to the model as short handles), and a verifier drops anything else.

| Qloo capability | How Fringe uses it |
|---|---|
| `GET /search` | Resolves each favourite to a canonical entity **and its picture**. A pre-literate child or a person with aphasia navigates by image. If a name resolves to a person or album, the agent widens the search and re-picks a boardable type. |
| `GET /v2/insights` × 5 types | Cross-domain expansion (tv_show, movie, artist, videogame, book). Age guard rails use `filter.content_rating` and children's book tags; if a filter is too tight, the agent self-corrects with a popularity floor. |
| `GET /v2/tags` + place insights | Food → `menu_highlight` / `specialty_dish` tags → where to eat it (Lou Malnati's and Giordano's for Leo's deep dish). Real places in the person's city that people with this taste over-index on. |
| `urn:demographics` | Age-group affinity per topic, which drives "who it lands with" and the bridge scoring. |
| `GET /v2/analysis/compare` | The taste themes two people share. |
| Joint-signal insights | Topics for a specific conversation partner, re-ranked by positive affinity in both age groups. |
| Tag-filtered insights | Turns a theme ("dinosaurs") into taste-personalised titles. |

## How I built it

- **Next.js 16** (TypeScript, App Router) on **Vercel**. Agent runs stream as NDJSON, so the UI shows each step and endpoint live.
- **Agents:** a build agent (understand → resolve → expand → localise → read the room → curate → verify), a bridge agent, and a **tool-calling refine agent** (Groq function calling, bounded to 4 turns, with tools `add_interest`, `find_places`, `remove_buttons` and `add_phrases`). The reply shown to the user is built from what the tools actually did, never from the model's own claims.
- **LLM:** Groq (`gpt-oss-120b`, falling back to `gpt-oss-20b` and `qwen3.8-27b`) in JSON mode. Every LLM step has a deterministic fallback, so the demo never dead-ends.
- **Qloo client:** a typed wrapper with stable cache keys, an in-memory TTL cache with in-flight de-duplication, retries and response trimming.
- **Design:** soft neumorphism for the device chrome, with all content at full contrast. AAC users often have low vision or motor impairments, so the softness is in the shell, never in the words.

## Challenges

- **Free-tier token limits** (8K tokens per minute per model) forced a lean design: short handles instead of UUIDs, trimmed Qloo responses, a model fallback chain and template fallbacks.
- **Silent API behaviour:** invalid parameters return empty results rather than errors, so every step checks for thin results and changes strategy.
- **A fair control experiment:** the first version of "Without Qloo" used strict name matching and undercounted the LLM. I rewrote it to match generously, because a rigged comparison proves nothing.

## What's next

1. **Families:** free, in the browser.
2. **SLPs and schools:** a caseload studio with one board per student, refreshed each term, plus partner pages for classmates and aides.
3. **AAC platforms:** Fringe as an API and agent tool, giving AAC apps a taste layer through Open Board Format.

AAC devices are routinely funded by insurers and schools; the labour of making them personal is not. Fringe turns that labour into a one-sentence review task.

## Built with

Qloo Taste AI API · Next.js · TypeScript · Tailwind CSS · Groq (gpt-oss-120b) · Web Speech API · JSZip (Open Board Format) · Vercel

## Testing instructions

No login is needed. Open https://fringe-aac.vercel.app/studio?p=maya; the first build takes about 10 seconds while the agent works live.

1. Tap pictures and core words to hear speech and build a sentence. Tap the info button on a picture for its Qloo evidence.
2. Tap a "Tastes change" example to run the tool-calling agent.
3. Open "Talk with Grandpa Joe" and build the bridge.
4. Open "Without Qloo" and run the control.
5. Switch to Aarav (Mumbai), Leo or Ruth, or "Your own".
