# Fringe: the words for what they love

**Tagline:** An AI agent that builds personal AAC communication boards from Qloo's taste graph, so people who can't rely on speech can talk about what they love.

- **Live demo:** https://fringe-aac.vercel.app (no login; open a persona and the agent builds the board live)
- **Code:** https://github.com/Arnav020/fringe (MIT)

---

## Inspiration

About 4 million Americans can't reliably meet their daily communication needs with their own speech (Beukelman & Mirenda, cited by the National Academies). Many of them speak through **AAC**: augmentative and alternative communication, the tablets and picture boards that turn a tap into a voice.

Look at a typical AAC board and you'll find *eat, drink, toilet, help, pain*. That's technically functional. But when adults rank why they communicate, **social closeness** comes first, ahead of needs (Light's purposes of communicative interaction). Closeness runs on *fringe vocabulary*, the personal words for a favourite show, a band, a team or a local place. Today a parent or speech-language pathologist adds those words **by hand**, one button at a time, and they go stale the moment tastes change.

About 30% of autistic children remain minimally verbal even after years of intervention (Tager-Flusberg & Kasari, 2013), and AAC doesn't stop speech: across 27 cases, none spoke less and most spoke more (Millar, Light & Schlosser, 2006). Yet stale and ill-fitting boards get abandoned. In a survey of 275 AAC specialists, *not maintaining or adjusting the system* and *poor fit* were among the factors most often linked to abandonment (Johnson et al., 2006). The fit is cultural too: AAC practice is shaped by Western norms (Kulkarni & Parmar, 2017), and speech therapists have asked the open-source AAC app Cboard for country-specific tiles since 2022.

An 8-year-old whose board can say "juice" but not "Bluey" can't join the conversation at school. This hackathon asks for the case where cultural intelligence is the difference between "technically functional" and "actually good". For AAC, it's the difference between asking for things and making friends.

## What it does

A caregiver writes one sentence: *"Loves Bluey, Taylor Swift, Encanto, Minecraft, mac and cheese, swimming."* Fringe's agent builds a working, talking AAC board of about 50 picture buttons in roughly 10 seconds, and every step streams live into the studio.

- **Talking board.** A sentence strip with text-to-speech; 24 core words with symbols in **fixed positions** (including *help*, *stop* and *all done*), colour-coded with the Modified Fitzgerald Key, as AAC practice recommends for motor planning; and personal topic folders (Shows, Movies, Music, Games, Books, People, Places, Food) with real pictures and natural first-person phrases ("Can we watch Bluey?"), plus social-closeness phrases ("Have you seen it?").
- **Evidence on every button.** The Qloo affinity score; **which of the person's favourites led to it**, from Qloo explainability (*Wings of Fire*: Bluey 35%, Minecraft 30%); how widely known it is (an easy opener, or a niche pick); which age groups it lands with; the address for places; and the Qloo entity id.
- **Knows where their taste lives.** A Qloo heatmap of the person's city finds the neighbourhoods where their kind of taste concentrates. Places come from inside those hot-spots, and for children only outing categories (parks, pools, museums, playgrounds) via Qloo category tags. The studio draws the map with the board's places pinned on it.
- **Snacks they'd ask for.** Qloo brand insights for food & beverage turn a taste profile into request words with pictures (Oreo, Doritos, Skittles), with coffee, alcohol and energy drinks filtered out for minors.
- **Reads the room.** Qloo demographics tell Maya that Bluey is a *parents & teachers* topic, and tell Ruth (71) that Casablanca also lands with her *grandkids*.
- **Talk with someone specific.** For a named partner (Grandpa Joe, 68), the agent compares both taste profiles with Qloo Compare. It finds shared themes (Country, Blues, Folk, Comedy, Family), searches with both profiles as the signal, adds Qloo's retirement audience as a signal when someone is 60+, and keeps topics with positive affinity in **both** age groups. Explainability then shows how much each topic draws on each person's favourites, and the agent prefers topics that draw on both: *The Waltons* draws 55% on Maya's favourites and 45% on Grandpa Joe's, and lands with both age groups (+25 and +20).
- **Keeps it current.** *"She's obsessed with dinosaurs now. Find somewhere she can swim. Remove Hello Neighbor, it scares her."* A **tool-calling agent** plans the changes and runs Qloo-backed tools. Dinosaurs becomes a Qloo tag used as a hard filter and ranked by *her* taste: *The Land Before Time* and *We're Back! A Dinosaur's Story*, not just Jurassic Park. It also finds real swimming pools in Austin and removes the scary game. It **learns from use**, too: taps are counted on the device, and "More like what Maya taps" sends her most-tapped buttons to Qloo as the signal, so the board grows from what she actually says.
- **Lets them choose.** Many AAC users can't tell anyone what they like. **This or that** runs a paired-choice preference session, a standard method in AAC and behaviour analysis: two pictures at a time from Qloo, one more like what they just picked and one from a different domain of their taste. The next pair follows their choice, and the picks go onto the board as favourites *they* chose, then steer more suggestions.
- **Human in the loop.** Favourites the caregiver named go straight in. Everything the agent suggests waits in a review queue for a parent or SLP to keep or remove.
- **Culturally specific, not US-template, in the family's language.** Aarav (12, Mumbai) gets Chhota Bheem, Motu Patlu, Lagaan, Shreya Ghoshal and Shah Rukh Khan, and the cricket grounds near him. One switch speaks the whole board in Hindi, using Qloo's own localised names where it has them. Tell the agent *"he's crazy about Virat Kohli now, find a cricket ground near him"* and it adds Sachin Tendulkar and Rohit Sharma, plus Wankhede Stadium and local gymkhanas.
- **Access-aware.** "Large targets" mode gives eye-gaze, switch and motor-access users fewer, bigger buttons. It's on by default for Leo, who uses eye-gaze.
- **Plugs into other agents.** Fringe is an **MCP server** (`/api/mcp`, tools `build_aac_board`, `this_or_that` and `talk_with_partner`), so Qloo-grounded AAC vocabulary can be wired into agents people already use.
- **No lock-in.** One-click export to **Open Board Format (.obz)**, the open interchange format for AAC boards.
- **"Without Qloo", run live.** The same model fills the same board with no taste graph, and every suggestion is checked against Qloo. On Maya's note, 9 of 12 LLM-only suggestions just restate the note, and its local "places" are events that can't be verified. It has no pictures and no audience signal.

## How it's Qloo-powered

The LLM handles language. **Qloo decides what goes on the board**: the curation step may only choose from ids Qloo returned (sent to the model as short handles), and a verifier drops anything else.

| Qloo capability | How Fringe uses it |
|---|---|
| `GET /search` | Resolves each favourite to a canonical entity **and its picture**. A pre-literate child or a person with aphasia navigates by image. If a name resolves to a person or album, the agent widens the search and re-picks a boardable type. |
| `GET /v2/insights` × 6 types | Cross-domain expansion (tv_show, movie, artist, videogame, book, person). Age guard rails use `filter.content_rating`, children's book tags, and the ESRB rating Qloo stores on each game (Qloo ignores the rating filter for games, so Fringe filters on the property). |
| `feature.explainability` | Which of the person's favourites drove each pick, on every button; in the bridge, how much a topic draws on each person. |
| `urn:heatmap` → `filter.location.geohash` | Where their kind of taste concentrates in their city, then real places inside the top hot-spots. |
| `filter.tags` + `operator.filter.tags=union` | Outing categories for kids' places (park, pool, museum, playground, ice cream); dish tags for food; theme tags for "dinosaurs". |
| `urn:entity:brand` (food & beverage) | Snacks and treats that fit the taste profile, as request words with pictures. |
| `GET /v2/tags` | Food → `menu_highlight` / `specialty_dish` tags → where to eat it (Lou Malnati's and Giordano's for Leo's deep dish); themes → tags. |
| `urn:demographics` | Age-group affinity per topic, which drives "who it lands with" and the bridge scoring. |
| `GET /v2/analysis/compare` | The taste themes two people share. |
| `signal.demographics.audiences` | Qloo's retirement audience as an extra bridge signal for grandparents. |
| `properties.akas` | Localised names (Hindi) for the home-language board. |

**What I tested and left out.** `signal.demographics.age` on the main expansion pulled an Indian 12-year-old's board towards US youth titles, so it's used only for snacks. `/v2/trending` in the hackathon snapshot ends in June 2026 and is flat week to week, so Fringe uses each entity's popularity percentile to show how widely known a topic is instead.

## How I built it

- **Next.js 16** (TypeScript, App Router) on **Vercel**. Agent runs stream as NDJSON, so the UI shows each step and endpoint live.
- **Agents:** a build agent (understand → resolve → expand · localise · map hot-spots · find snacks → read the room → curate → verify → translate), a bridge agent, an adaptive **This or that** loop (each choice becomes the Qloo signal for the next pair; no language model involved), and a **tool-calling refine agent** (Groq function calling, bounded to 4 turns, with tools `add_interest`, `more_like`, `find_places`, `remove_buttons` and `add_phrases`).
- **Tests:** vitest unit tests for the age guard rails, ESRB filter, place filters, curation handles, core vocabulary and the Open Board Format export, plus an end-to-end check of all four personas against the live API. The reply shown to the user is built from what the tools actually did, never from the model's own claims.
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
3. **AAC platforms:** the MCP server and Open Board Format export already exist, giving AAC apps a taste layer.

AAC devices are routinely funded by insurers and schools; the labour of making them personal is not. Fringe turns that labour into a one-sentence review task.

## Built with

Qloo Taste AI API · Next.js · TypeScript · Tailwind CSS · Groq (gpt-oss-120b) · Web Speech API · JSZip (Open Board Format) · Vercel

## Testing instructions

No login is needed. Open https://fringe-aac.vercel.app/studio?p=maya; the first build takes about 10 seconds while the agent works live.

1. Tap pictures and core words to hear speech and build a sentence. Tap the info button on a picture for its Qloo evidence (affinity, which favourites led to it, reach, who it lands with). Scroll the left column for the taste heatmap.
2. Tap a "Tastes change" example to run the tool-calling agent.
3. Open "Talk with Grandpa Joe" and build the bridge.
4. Open "This or that" and tap one picture six times; add the picks to the board.
5. Open "Without Qloo" and run the control.
6. Switch to Aarav (Mumbai) and turn on **Speak Hindi**; try Leo or Ruth, or "Your own".
