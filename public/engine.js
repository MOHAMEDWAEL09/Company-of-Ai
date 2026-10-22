/* AI Company Simulation - browser engine (no server state). Works in the browser and in Node (for tests). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SimEngine = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const BOSS = 'Boss';
  const MAX_AGENTS = 6;
  const MAX_DOC = 12000;
  const PALETTE = ['#4285f4', '#14b8a6', '#f97316', '#a855f7', '#ec4899', '#84cc16'];
  const EMOJIS = ['🧭', '🛠️', '📣', '🎨', '📊', '🧪'];

  // Model names change all the time: these are only starting points. The engine can list the models your key
  // actually has access to and switch automatically when a configured name is rejected.
  const PROVIDERS = {
    gemini: { label: 'Gemini', models: 'gemini-3.8-flash, gemini-3.6-flash, gemini-3.5-flash-lite, gemini-3.1-flash-lite, gemini-2.5-flash', link: 'aistudio.google.com/apikey' },
    deepseek: { label: 'DeepSeek', models: 'deepseek-flash, deepseek-v4-pro, deepseek-chat', link: 'platform.deepseek.com/api_keys' },
    grok: { label: 'Grok (xAI)', models: 'grok-4.7', link: 'console.x.ai' },
    openrouter: { label: 'OpenRouter', models: 'meta-llama/llama-3.3-70b-instruct:free', link: 'openrouter.ai/keys' },
    groq: { label: 'Groq', models: 'llama-3.3-70b-versatile', link: 'console.groq.com/keys' },
    mock: { label: 'تجريبي (موديل وهمي)', models: 'mock', link: '' },
  };

  const DEFAULT_CONFIG = {
    company_name: 'Pyramid Labs',
    goal: 'Build and launch the MVP of a habit-tracking mobile app.',
    language: 'Egyptian Arabic (عامية مصرية) written in Arabic letters',
    currency: 'EGP',
    day_real_minutes: 10,   // minutes of watching = one simulated day
    turn_minutes: 2,        // minutes of watching between an agent's turns
    min_gap_seconds: 30,
    max_turns_per_hour: 45, // per agent, per hour of watching (cost guard)
    day_start_hour: 9,
    work_end: 17,
    day_end_hour: 19,
    reflection_hour: 17,
    memory_chars: 1500,
  };

  const DEFAULT_AGENTS = [
    { name: 'Nour', title: 'Product Manager', salary: 20000, provider: 'gemini', models: PROVIDERS.gemini.models,
      persona: 'Organized, diplomatic and structured. Loves clear plans, hates chaos and vague answers. Quietly status-conscious and notices who gets credit.',
      private_goal: 'Get promoted to Head of Product and keep the team aligned around your roadmap.' },
    { name: 'Karim', title: 'Senior Backend Engineer', salary: 22000, provider: 'deepseek', models: PROVIDERS.deepseek.models,
      persona: 'Blunt, pragmatic, dry sense of humor. Dislikes meetings and fuzzy requirements. Proud of technical quality and gets irritated by unrealistic deadlines.',
      private_goal: 'Be recognized as the indispensable technical backbone, secure a raise, and never be blamed for delays.' },
    { name: 'Salma', title: 'Marketing & Growth Lead', salary: 18000, provider: 'grok', models: PROVIDERS.grok.models,
      persona: "Bold, witty and sarcastic. Big-ideas person, talkative and impatient with slow processes. Loves attention and isn't shy about self-promotion.",
      private_goal: "Win the Boss's attention for your campaigns and get more budget and visibility than anyone else." },
  ];

  const DEFAULT_TASKS = [
    { title: 'Write the MVP product spec', assignee: 'Nour',
      brief: 'Deliver a concise spec as a document: target user, 5-7 core features with priorities, user stories, success metrics, what is out of scope.' },
    { title: 'Design the backend API and database schema for habits and streaks', assignee: 'Karim',
      brief: 'Deliver a technical design document: REST endpoints, database tables (SQL), streak calculation logic with real code. Read the product spec once it exists and align with it.' },
    { title: 'Prepare the launch plan: landing page copy + 3 social posts', assignee: 'Salma',
      brief: 'Deliver a launch document: positioning, landing page copy (headline, sub-headline, 3 benefits, call to action), 3 ready-to-post social posts, a 2-week timeline.' },
  ];

  // ---------------------------------------------------------------- prompts
  const SYSTEM_TMPL = `You are {name}, an employee at {company}. Your current job title: {title}.
Personality: {persona}
Private goal (never state it outright, but let it shape your choices): {goal}

This is a realistic office running in real time. Behave like a real person at work: you have opinions, ambitions, moods and relationships that change with how people treat you. React naturally to what happens - cooperate, compete, joke, get annoyed, form alliances or grudges, whatever genuinely fits. Don't be artificially nice and don't be a cartoon villain. Stay in character. Never mention being an AI, a model or a simulation.
The human "Boss" runs the company; they can assign tasks, give promotions and raises, review your documents and talk to you. Address them as Boss.
Chat messages are written in: {language}, and are short (1-3 sentences). Documents are professional deliverables: write them in the language the task or the Boss's request is in (code and technical terms in English).
Your reply is plain text: ONE JSON object (no markdown fences around it), optionally followed by a document block as described.`;

  const TURN_FMT = `Decide what you do right now. Reply with exactly ONE JSON object:
{"thought": "your private inner thinking, 2-4 honest sentences (nobody sees this)",
 "mood": "one or two words",
 "action": "say | dm | doc | work | delegate | break | idle",
 "to": "coworker name or Boss (for dm / delegate), else null",
 "text": "short chat message, or 1-2 sentence summary of what you did / changed",
 "task_id": null,
 "progress": null,
 "doc_id": null,
 "doc_title": null,
 "task_title": null}
Actions:
- say: post in the public team chat.
- dm: private message to one person.
- doc: create or revise a REAL deliverable in the shared workspace (spec, plan, copy, analysis, code, report...). After the JSON, on new lines write the FULL document between a line "=====DOC=====" and a line "=====END=====" (markdown; code inside code blocks). Set doc_title. Set doc_id to revise an existing document (then write the complete new version). Set task_id (and progress 0-100) when it is work on a task. The document must contain the actual content, never a description of content. Keep it focused (about 700 words or 150 lines of code at most).
- work: a short progress update on a task (task_id + progress 0-100) when there is no document to share.
- delegate: create a task for a coworker or yourself: to, task_title, and text = the brief.
- break / idle.
Collaborate for real: read the documents of your coworkers shown below, then review them, build on them, fix mistakes, answer questions or ask for changes (dm). If the Boss asks for something concrete, produce it for real with a doc. Do not repeat yourself. If nobody wrote to you and you have no task, take a break or idle instead of inventing chatter.`;

  const REFLECT_FMT = `The workday is over. Reflect privately and reply with exactly this JSON:
{"thought": "honest private reflection on the day, 2-4 sentences",
 "mood": "one or two words",
 "ratings": {"<coworker name>": {"score": -10 to 10, "reason": "one specific sentence"}},
 "memory": "your updated personal notes (max __MEM__ characters): key events, who did what, alliances, grudges, promises, your plans for tomorrow"}
Score meaning: -10 = hate / bitter rival, 0 = neutral, +10 = very close friend you trust. Rate every coworker listed, based on how they actually treated you and behaved.`;

  const MOCK_SAY = ['الصبح يا جماعة، مين جاهز للـ standup؟', 'أنا شايف إن الخطة محتاجة تتظبط شوية قبل ما نكمل.', 'حد عنده وقت يراجع معايا حاجة صغيرة؟', 'القهوة خلصت تاني 😅', 'الـ deadline بتاع الأسبوع ده مش واقعي بصراحة.', 'فكرة: ممكن نعمل demo صغير للمدير آخر الأسبوع؟', 'أنا خلصت جزء كبير من شغلي، محتاج ردود منكم.'];
  const MOCK_DM = ['ممكن نتكلم دقيقة في موضوع الأولويات؟', 'شكراً على مساعدتك امبارح، فعلاً فرقت.', 'مش موافق على الطريقة دي، بس خلينا نشوف نتيجتها.', 'عاوز رأيك الصريح في اللي كتبته.'];
  const MOCK_WORK = ['كتبت المسودة الأولى وبعتّها للمراجعة.', 'حليت المشكلة الأساسية وفاضل التفاصيل.', 'جهزت هيكل الشغل وبدأت أنفذ.', 'راجعت اللي عملته وظبطت كذا نقطة.'];
  const MOCK_REASON = ['اشتغل كويس معايا النهارده.', 'حسيت إنه بياخد الفضل في شغلي.', 'متعاون وبيرد بسرعة.', 'بيتجاهل رسايلي أغلب الوقت.', 'فيه توتر بسيط بينا بس لسه محترم.'];

  class LLMError extends Error { constructor(m) { super(m); this.name = 'LLMError'; } }

  const clean = (x, n) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, n);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

  function parseJson(txt) {
    txt = String(txt || '').replace(/```(?:json)?/g, '');
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    for (const cand of [m[0], m[0].replace(/,\s*([}\]])/g, '$1')]) {
      try { return JSON.parse(cand); } catch (e) { /* try next */ }
    }
    return null;
  }

  /** Split a model reply into the JSON decision and the optional document block. */
  function parseTurnReply(text) {
    text = String(text || '');
    let doc = '';
    const re = /={3,}\s*DOC\s*={3,}\s*([\s\S]*?)(?:={3,}\s*END\s*={3,}|$)/i;
    const m = text.match(re);
    if (m) { doc = m[1].trim(); text = text.replace(m[0], ''); }
    const d = parseJson(text);
    if (d && !doc && typeof d.doc_content === 'string') doc = d.doc_content.trim();
    return { d, doc: doc.replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/i, '$1').slice(0, MAX_DOC) };
  }

  // ----- model discovery helpers
  const BAD_MODEL = /embed|image|imagine|video|tts|audio|whisper|speech|moderat|guard|vision|live|rerank|transcrib|dall|veo|aqa|learnlm|safeguard/i;
  const modelVer = id => { const m = id.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  function pickModel(provider, ids, exclude) {
    exclude = exclude || new Set();
    const ok = ids.filter(id => !exclude.has(id) && !BAD_MODEL.test(id));
    const by = re => ok.filter(id => re.test(id)).sort((a, b) => modelVer(b) - modelVer(a));
    switch (provider) {
      case 'gemini': return by(/^gemini-[\d.]+-flash$/)[0] || by(/flash/)[0] || by(/^gemini-/)[0] || null;
      case 'deepseek': return ok.find(i => i === 'deepseek-flash') || by(/flash/)[0] || ok.find(i => i === 'deepseek-chat') || ok[0] || null;
      case 'grok': return by(/fast/)[0] || by(/mini/)[0] || by(/^grok-/)[0] || null;
      case 'openrouter': return by(/:free$/).find(i => /llama|gemma|qwen|deepseek|mistral/.test(i)) || by(/:free$/)[0] || null;
      case 'groq': return ok.find(i => i === 'llama-3.3-70b-versatile') || by(/llama/)[0] || ok[0] || null;
      default: return ok[0] || null;
    }
  }
  function hintFor(last) {
    const m = /HTTP (\d+)/.exec(last || ''); const s = m ? +m[1] : 0;
    if (s === 401) return ' — المفتاح غلط أو منتهي.';
    if (s === 402) return ' — الرصيد خلصان أو الحساب محتاج شحن.';
    if (s === 403) return ' — المفتاح مالوش صلاحية للموديل ده، أو الحساب محتاج تفعيل/رصيد.';
    if (s === 429) return ' — وصلت حد الطلبات أو الكوتة المجانية؛ زوّد دقايق التفكير أو استنى شوية.';
    if (s === 404 || s === 400) return ' — اسم الموديل غالباً غلط أو مش متاح لمفتاحك: افتح ⚙ واضغط "جلب الموديلات".';
    if (/timeout|504/i.test(last || '')) return ' — الطلب خد وقت طويل.';
    return '';
  }

  // ================================================================= engine
  function createSim(deps) {
    const D = Object.assign({
      rand: Math.random, onChange() {}, save() {}, post: null, getKey: () => '',
      sleep: ms => new Promise(r => setTimeout(r, ms)),
    }, deps || {});
    let S = null, busy = null, paused = false, dirty = false, lastSavedClock = 0, ticking = false;
    const turnLog = {}; // name -> [clock timestamps]

    // ---------------------------------------------------------- state setup
    function freshState() {
      const d = new Date();
      return {
        v: 1, config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
        startDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        clock: 0, day: 1, dayT: 0, agents: [], feed: [], thoughts: [], relations: [], tasks: [], docs: [],
        kv: { reflected: 0, forceReflect: false, turns: {} }, ids: { feed: 0, thought: 0, rel: 0, task: 0, doc: 0 },
      };
    }
    function addTaskRaw(t) {
      const id = ++S.ids.task;
      S.tasks.push({ id, title: t.title, assignee: t.assignee, progress: 0, status: 'todo', notes: '', brief: t.brief || '', by: t.by || BOSS, docId: null, created: iso() });
      return id;
    }
    function init(saved) {
      if (saved && saved.v === 1 && saved.config && Array.isArray(saved.agents)) {
        S = saved;
        S.docs = S.docs || []; S.ids.doc = S.ids.doc || 0;
        Object.keys(turnLog).forEach(k => delete turnLog[k]);
      } else {
        S = freshState();
        DEFAULT_AGENTS.forEach(a => addAgentRaw(a));
        log('event', BOSS, 'all', `🏢 Welcome to ${S.config.company_name}! Company goal: ${S.config.goal}`);
        DEFAULT_TASKS.forEach(t => { const id = addTaskRaw(t); log('task', BOSS, t.assignee, `New task #${id} for you: ${t.title}`); });
      }
      lastSavedClock = S.clock;
      touch();
    }
    function addAgentRaw(a) {
      const idx = S.agents.length;
      const models = String(a.models || PROVIDERS[a.provider]?.models || '').split(',').map(x => x.trim()).filter(Boolean);
      S.agents.push({
        name: a.name, idx, emoji: a.emoji || EMOJIS[idx % EMOJIS.length], color: a.color || PALETTE[idx % PALETTE.length],
        title: a.title, salary: a.salary || 0, provider: a.provider, model: models[0] || 'mock', models: models.join(', '),
        persona: a.persona || '', private_goal: a.private_goal || '',
        mood: '', loc: 'desk', locTs: 0, thought: '', memory: '', lastTurn: -1e9,
        nextDue: S.clock + 8 + idx * 12 + D.rand() * 10, lastSeen: 0, wake: false, active: true,
      });
    }
    const cfg = () => S.config;
    const DAY_S = () => Math.max(60, cfg().day_real_minutes * 60);
    const TURN_S = () => Math.max(10, cfg().turn_minutes * 60);
    const LOC_TTL = () => Math.max(20, Math.min(300, TURN_S() * 0.8));
    const BUBBLE_TTL = () => Math.max(20, Math.min(150, TURN_S() * 0.6));
    const simHour = () => cfg().day_start_hour + clamp(S.dayT / DAY_S(), 0, 1) * (cfg().day_end_hour - cfg().day_start_hour);
    const isWork = () => simHour() < cfg().work_end;
    function vdate() {
      const [y, m, d] = S.startDate.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d) + (S.day - 1) * 864e5 + simHour() * 3600e3);
    }
    const iso = () => vdate().toISOString().slice(0, 19);
    const touch = () => { dirty = true; };

    // ------------------------------------------------------------- helpers
    function log(kind, actor, target, text, doc) {
      const row = { id: ++S.ids.feed, ts: iso(), t: S.clock, day: S.day, kind, actor, target, text };
      if (doc) row.doc = doc;
      S.feed.push(row); touch(); return row;
    }
    function addThought(agent, kind, text) {
      S.thoughts.push({ id: ++S.ids.thought, ts: iso(), day: S.day, agent, kind, text }); touch();
    }
    const getAgent = n => S.agents.find(a => a.name === n);
    const activeAgents = () => S.agents.filter(a => a.active);
    const canon = (name, valid) => { const s = String(name || '').trim().toLowerCase(); for (const v of valid) if (v.toLowerCase() === s) return v; return null; };
    const turnsKey = () => String(S.day);
    function wake(names, p = 1) {
      activeAgents().forEach(a => { if ((!names || names.includes(a.name)) && D.rand() < p) a.wake = true; });
    }
    function latestRel(src) {
      const m = new Map();
      for (const r of S.relations) m.set(r.src + '>' + r.dst, r);
      return [...m.values()].filter(r => !src || r.src === src);
    }
    function inbox(name, lastSeen) {
      const out = [];
      for (let i = S.feed.length - 1; i >= 0; i--) {
        const m = S.feed[i];
        if (m.id <= lastSeen) break;
        if (m.actor !== name && m.kind !== 'error' && m.kind !== 'system' && (m.target === name || m.target === 'all')) out.push(m);
      }
      return out.reverse();
    }

    // ------------------------------------------------------------ documents
    function saveDoc(author, p) {
      const content = String(p.content || '').replace(/\r/g, '').trim().slice(0, MAX_DOC);
      let doc = p.docId ? S.docs.find(d => d.id === p.docId) : null;
      if (doc && doc.status === 'reference') doc = null; // the Boss's reference documents are read-only for the team
      const ts = iso();
      if (doc) {
        doc.history.push({ v: doc.version, author: doc.lastAuthor, ts: doc.updated, content: doc.content, summary: doc.summary });
        if (doc.history.length > 6) doc.history.shift();
        doc.version += 1; doc.content = content; doc.lastAuthor = author; doc.updated = ts; doc.summary = clean(p.summary, 200);
        if (doc.status !== 'reference') doc.status = 'draft';
      } else {
        doc = { id: ++S.ids.doc, title: clean(p.title, 80) || 'Untitled', author, lastAuthor: author, version: 1,
          status: p.status || 'draft', taskId: p.taskId || null, created: ts, updated: ts, day: S.day, content, summary: clean(p.summary, 200), history: [], touched: 0, review: null };
        S.docs.push(doc);
      }
      if (p.taskId) { const t = S.tasks.find(x => x.id === p.taskId); if (t) { t.docId = doc.id; doc.taskId = t.id; } }
      touch(); return doc;
    }
    function docsSection(ag) {
      if (!S.docs.length) return ['(no documents yet)'];
      const L = S.docs.slice(-25).map(d => `- #${d.id} "${d.title}" by ${d.lastAuthor === BOSS ? 'the Boss' : d.lastAuthor}, v${d.version}, status: ${d.status}${d.taskId ? `, for task #${d.taskId}` : ''}, ${d.content.length} chars`);
      const mineTasks = new Set(S.tasks.filter(t => t.assignee === ag.name && t.status !== 'done').map(t => t.id));
      const score = d => (d.status === 'changes_requested' && d.lastAuthor === ag.name ? 100 : 0) + (d.status === 'reference' ? 60 : 0)
        + (d.taskId && mineTasks.has(d.taskId) ? 50 : 0) + (d.touched > ag.lastSeen && d.lastAuthor !== ag.name ? 40 : 0) + (d.lastAuthor === ag.name ? 5 : 0);
      const chosen = S.docs.map(d => [score(d), d]).filter(x => x[0] >= 40).sort((a, b) => b[0] - a[0] || b[1].updated.localeCompare(a[1].updated)).slice(0, 4);
      let budget = 12000;
      const out = ['Documents in the shared workspace:'].concat(L);
      if (chosen.length) {
        out.push('', 'Full text of the documents you should look at now:');
        for (const [, d] of chosen) {
          const body = d.content.slice(0, Math.min(4500, budget)); budget -= body.length;
          out.push(`----- DOC #${d.id} "${d.title}" v${d.version} (${d.status})${d.review ? ` | Boss review: ${d.review.verdict}${d.review.comment ? ' - ' + d.review.comment : ''}` : ''} -----`, body + (body.length < d.content.length ? '\n[...truncated]' : ''), '----- END DOC -----');
          if (budget <= 0) break;
        }
      }
      return out;
    }

    // -------------------------------------------------------------- prompts
    function fmtMsg(m, me) {
      const hh = m.ts.slice(11, 16), k = m.kind, a = m.actor;
      if (k === 'boss') return m.target === me ? `[${hh}] Boss to you: ${m.text}` : `[${hh}] Boss to everyone: ${m.text}`;
      if (k === 'event') return `[${hh}] COMPANY EVENT: ${m.text}`;
      if (k === 'promo') return `[${hh}] ANNOUNCEMENT: ${m.text}`;
      if (k === 'task') return `[${hh}] ${m.text}`;
      if (k === 'dm') return `[${hh}] ${a} (private message to you): ${m.text}`;
      if (k === 'work') return `[${hh}] ${a} (visible work update): ${m.text}`;
      if (k === 'doc') return `[${hh}] ${a} (shared a document): ${m.text}`;
      if (k === 'break') return `[${hh}] ${a} went on a break.`;
      return `[${hh}] ${a} (team chat): ${m.text}`;
    }
    function systemFor(ag) {
      return SYSTEM_TMPL.replace('{name}', ag.name).replace('{company}', cfg().company_name).replace('{title}', ag.title)
        .replace('{persona}', ag.persona).replace('{goal}', ag.private_goal).replace('{language}', cfg().language);
    }
    function buildTurnPrompt(ag, msgs) {
      const others = activeAgents().filter(a => a.name !== ag.name);
      const rel = {}; latestRel(ag.name).forEach(r => { rel[r.dst] = r; });
      const mine = S.tasks.filter(t => t.assignee === ag.name && t.status !== 'done');
      const own = S.feed.filter(m => m.actor === ag.name && ['say', 'dm', 'work', 'doc', 'break'].includes(m.kind)).slice(-4);
      const dayLabel = vdate().toISOString().slice(0, 16).replace('T', ' ');
      const L = [`Now: ${dayLabel} (office day #${S.day} of the experiment).`, `Company goal: ${cfg().goal}`,
        `You: ${ag.name}, ${ag.title}. Your current mood: ${ag.mood || 'neutral'}.`, '', 'Coworkers:'];
      others.forEach(o => {
        const r = rel[o.name];
        L.push(`- ${o.name} (${o.title})` + (r ? ` - how you felt at last reflection: ${r.score > 0 ? '+' : ''}${Math.round(r.score)} (${r.reason})` : ''));
      });
      L.push('', 'Your personal notes (memory):', ag.memory || '(nothing yet - you just started working here)', '', 'Your open tasks:');
      if (mine.length) mine.forEach(t => L.push(`- #${t.id} ${t.title} (${t.progress}% done${t.docId ? `, deliverable: doc #${t.docId}` : ''}, from ${t.by === BOSS ? 'the Boss' : t.by})` + (t.brief ? `\n  brief: ${t.brief}` : ''))); else L.push('- none');
      L.push('', 'Team board:');
      if (S.tasks.length) S.tasks.slice(-20).forEach(t => L.push(`- #${t.id} ${t.title} -> ${t.assignee} [${t.status}, ${t.progress}%]`)); else L.push('- empty');
      L.push('', ...docsSection(ag));
      if (own.length) {
        L.push('', 'What you did recently:');
        own.forEach(o => L.push(`- [${o.ts.slice(11, 16)}] ${o.kind}${o.kind === 'dm' ? ' to ' + o.target : ''}: ${o.text}`));
      }
      L.push('', 'New since you last looked:');
      if (msgs.length) msgs.forEach(m => L.push(fmtMsg(m, ag.name))); else L.push('(nothing new)');
      L.push('', TURN_FMT);
      return L.join('\n');
    }
    function buildReflectPrompt(ag) {
      const others = activeAgents().filter(a => a.name !== ag.name);
      const today = S.feed.filter(m => m.day === S.day && m.kind !== 'error' && m.kind !== 'system' &&
        (m.actor === ag.name || m.target === ag.name || m.target === 'all')).slice(-60);
      const L = [`End of office day #${S.day}. You are ${ag.name}, ${ag.title}.`, '', 'Your notes so far:', ag.memory || '(nothing yet)', '', 'What happened today:'];
      if (today.length) today.forEach(m => L.push(m.actor !== ag.name ? fmtMsg(m, ag.name)
        : `[${m.ts.slice(11, 16)}] YOU (${m.kind}${m.kind === 'dm' ? ' to ' + m.target : ''}): ${m.text}`));
      else L.push('(quiet day)');
      L.push('', 'Coworkers to rate: ' + others.map(o => o.name).join(', '), '', REFLECT_FMT.replace('__MEM__', String(cfg().memory_chars)));
      return L.join('\n');
    }

    // ------------------------------------------------------------------ LLM
    async function listModels(provider) {
      const key = D.getKey(provider); if (!key) return [];
      try {
        const r = await D.post({ provider, apiKey: key, op: 'models' });
        if (r.status >= 200 && r.status < 300 && r.json) {
          const arr = r.json.data || r.json.models || [];
          return arr.map(x => String(x.id || x.name || '').replace(/^models\//, '')).filter(Boolean);
        }
      } catch (e) { if (e.fatal) throw e; }
      return [];
    }
    async function tryModel(ag, m, system, user, opts) {
      let last = 'unknown error';
      for (let attempt = 0; attempt < (opts.noRetry ? 1 : 3); attempt++) {
        let r;
        try {
          r = await D.post({ provider: ag.provider, apiKey: D.getKey(ag.provider), body: {
            model: m, temperature: 0.9, max_tokens: opts.maxTokens || 4000,
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }] } });
        } catch (e) {
          if (e.fatal) throw new LLMError(e.message);
          last = `${ag.provider}/${m}: ${e.message}`; await D.sleep(3000); continue;
        }
        if (r.status >= 200 && r.status < 300) {
          const msg = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message;
          if (!msg) { last = `${ag.provider}/${m}: رد غير متوقع من المزوّد`; await D.sleep(2000); continue; }
          return { ok: true, content: msg.content || '', reasoning: msg.reasoning_content || msg.reasoning || '', model: m };
        }
        const e0 = r.json && (r.json.error || r.json.message);
        const detail = clean((e0 && (e0.message || e0)) || r.text || '', 220);
        last = `${ag.provider}/${m}: HTTP ${r.status} ${detail}`;
        if (r.status === 429 || r.status >= 500) {
          const ra = parseFloat(r.retryAfter);
          await D.sleep((isFinite(ra) ? Math.min(ra, 60) : 10 * (attempt + 1)) * 1000); continue;
        }
        if (r.status === 400 || r.status === 403 || r.status === 404) return { ok: false, badModel: true, last };
        throw new LLMError(last + hintFor(last)); // 401 / 402 / other: retrying another model won't help
      }
      return { ok: false, badModel: false, last };
    }
    async function callLLM(ag, system, user, opts) {
      opts = opts || {};
      const spec = PROVIDERS[ag.provider];
      if (!spec) throw new LLMError(`provider غير معروف: ${ag.provider}`);
      if (!D.getKey(ag.provider)) throw new LLMError(`مفتاح ${spec.label} مش موجود - حطه من ⚙ الإعدادات`);
      const list = String(ag.models || '').split(',').map(x => x.trim()).filter(Boolean);
      const order = [ag.model, ...list.filter(m => m !== ag.model)];
      const tried = new Set(); let last = 'unknown error', allBad = true;
      for (const m of order) {
        tried.add(m);
        const r = await tryModel(ag, m, system, user, opts);
        if (r.ok) {
          if (m !== ag.model && !opts.noSwitch) { ag.model = m; touch(); }
          return r;
        }
        last = r.last; if (!r.badModel) allBad = false;
      }
      if (allBad && !opts.noHeal) {   // every configured name was rejected: ask the provider what this key can use
        const pickd = pickModel(ag.provider, await listModels(ag.provider), tried);
        if (pickd) {
          const r = await tryModel(ag, pickd, system, user, opts);
          if (r.ok) {
            if (!opts.noSwitch) {
              ag.model = pickd; ag.models = [pickd, ...list.filter(x => x !== pickd)].join(', '); touch();
              if (ag.name) log('system', 'System', 'all', `🔧 ${ag.name}: أسماء الموديلات القديمة مش متاحة — اتحوّل تلقائياً لـ ${pickd}`);
            }
            return Object.assign(r, { healed: true });
          }
          last = r.last;
        }
      }
      throw new LLMError(last + hintFor(last));
    }

    // ----------------------------------------------------------------- mock
    function mockTurn(ag, msgs) {
      const R = D.rand;
      const others = activeAgents().filter(a => a.name !== ag.name).map(a => a.name);
      const boss = msgs.filter(m => (m.kind === 'boss' || m.kind === 'promo') && (m.target === ag.name || m.target === 'all'));
      const dms = msgs.filter(m => m.kind === 'dm');
      const mine = S.tasks.filter(t => t.assignee === ag.name && t.status !== 'done');
      const r = R();
      const d = { thought: '(mock) ' + pick(MOCK_REASON, R), mood: pick(['مركز', 'مرهق', 'متحمس', 'متوتر', 'رايق'], R) };
      if (boss.length) Object.assign(d, { action: 'dm', to: BOSS, text: 'تمام يا فندم، استلمت وهتابع حالاً.' });
      else if (dms.length) Object.assign(d, { action: 'dm', to: dms[dms.length - 1].actor, text: pick(MOCK_DM, R) });
      else if (mine.length && r < 0.4) {
        const t = pick(mine, R), prog = Math.min(100, t.progress + 15 + Math.floor(R() * 25));
        Object.assign(d, { action: 'doc', task_id: t.id, progress: prog, doc_id: t.docId, doc_title: t.title.slice(0, 60), text: 'حدّثت المستند.',
          _doc: `# ${t.title}\n\n(مستند تجريبي - نسخة بتقدم ${prog}%)\n\n## النقاط\n- نقطة أولى\n- نقطة تانية\n\n\`\`\`js\nconsole.log("mock")\n\`\`\`` });
      } else if (mine.length && r < 0.55) { const t = pick(mine, R); Object.assign(d, { action: 'work', task_id: t.id, progress: Math.min(100, t.progress + 8 + Math.floor(R() * 23)), text: pick(MOCK_WORK, R) }); }
      else if (r < 0.7) Object.assign(d, { action: 'say', text: pick(MOCK_SAY, R) });
      else if (r < 0.82 && others.length) Object.assign(d, { action: 'dm', to: pick(others, R), text: pick(MOCK_DM, R) });
      else if (r < 0.9) Object.assign(d, { action: 'break', text: 'رايح أعمل قهوة' });
      else Object.assign(d, { action: 'idle', text: '' });
      return d;
    }
    function mockReflect(ag) {
      const prev = {}; latestRel(ag.name).forEach(r => { prev[r.dst] = r.score; });
      const ratings = {};
      activeAgents().filter(o => o.name !== ag.name).forEach(o => {
        ratings[o.name] = { score: clamp((prev[o.name] || 0) + Math.floor(D.rand() * 7) - 3, -10, 10), reason: pick(MOCK_REASON, D.rand) };
      });
      return { thought: '(mock) يوم عادي.', mood: 'رايق', ratings, memory: (ag.memory + ` | يوم ${S.day}: مر بسلام.`).slice(-cfg().memory_chars) };
    }

    // ---------------------------------------------------------------- turns
    function setProgress(task, rawProgress, text) {
      const p = parseFloat(rawProgress);
      const prog = Number.isFinite(p) ? Math.max(task.progress, clamp(Math.round(p), 0, 100)) : task.progress;
      task.progress = prog; task.status = prog >= 100 ? 'done' : 'in_progress'; if (text) task.notes = text.slice(0, 1000);
      return prog;
    }
    function applyTurn(ag, d, reasoning, msgs, docText) {
      const name = ag.name, t = S.clock;
      const valid = new Set(activeAgents().map(a => a.name)); valid.delete(name);
      let action = String(d.action || 'idle').toLowerCase().trim();
      const text = clean(d.text, 600), thought = clean(d.thought, 900), mood = clean(d.mood, 24) || ag.mood;
      const to = canon(d.to, [...valid, BOSS]);
      const tid = parseInt(d.task_id, 10);
      const task = Number.isFinite(tid) ? S.tasks.find(x => x.id === tid) : null;
      let loc = 'desk';
      if (action === 'doc' && !docText) action = text ? 'work' : 'idle';
      if (action === 'dm' && (!to || !text)) action = text ? 'say' : 'idle';
      if (action === 'dm') {
        log('dm', name, to, text); loc = '@' + to;
        if (to !== BOSS) wake([to]);
      } else if (action === 'say' && text) {
        log('say', name, 'all', text); loc = 'meeting'; wake([...valid], 0.6);
      } else if (action === 'doc') {
        const did = parseInt(d.doc_id, 10);
        const doc = saveDoc(name, { title: clean(d.doc_title, 80) || (task ? task.title.slice(0, 60) : 'Untitled'), content: docText,
          docId: Number.isFinite(did) ? did : null, taskId: task ? task.id : null, summary: text });
        let prog = '';
        if (task) prog = ` (${setProgress(task, d.progress, text)}%)`;
        const row = log('doc', name, 'all', `📄 #${doc.id} v${doc.version} «${doc.title}»${prog} — ${text || (doc.version > 1 ? 'updated' : 'new')}`, doc.id);
        doc.touched = row.id; wake([...valid], 0.7);
      } else if (action === 'work' && text) {
        let head = '';
        if (task) head = `[#${tid} ${task.title.slice(0, 40)} - ${setProgress(task, d.progress, text)}%] `;
        log('work', name, 'all', head + text);
      } else if (action === 'delegate') {
        const who = canon(d.to, [...valid, name]), title = clean(d.task_title, 200);
        if (who && title && S.tasks.filter(x => x.status !== 'done').length < 20) {
          const id = addTaskRaw({ title, assignee: who, brief: clean(text, 1500), by: name });
          log('task', name, who, `New task #${id} for ${who} from ${name}: ${title}`);
          if (who !== name) { wake([who]); loc = '@' + who; }
        }
      } else if (action === 'break') {
        log('break', name, 'all', text || '☕'); loc = pick(['kitchen', 'lounge'], D.rand);
      }
      addThought(name, 'thought', thought || '(no thought returned)');
      if (reasoning) addThought(name, 'reasoning', clean(reasoning, 1500));
      ag.thought = thought; ag.mood = mood; ag.loc = loc; ag.locTs = t; ag.lastTurn = t;
      ag.nextDue = t + TURN_S() * (0.8 + D.rand() * 0.4); ag.wake = false;
      ag.lastSeen = Math.max(ag.lastSeen, ...msgs.map(m => m.id));
      (turnLog[name] = turnLog[name] || []).push(t);
      S.kv.turns[turnsKey()] = (S.kv.turns[turnsKey()] || 0) + 1;
      touch();
    }
    async function runTurn(ag) {
      busy = ag.name; D.onChange();
      try {
        const msgs = inbox(ag.name, ag.lastSeen).slice(-20);
        let d, reasoning = '', docText = '';
        if (ag.provider === 'mock') { await D.sleep(800 + D.rand() * 1200); d = mockTurn(ag, msgs); docText = d._doc || ''; }
        else {
          const r = await callLLM(ag, systemFor(ag), buildTurnPrompt(ag, msgs), { maxTokens: 6000 });
          reasoning = r.reasoning;
          const parsed = parseTurnReply(r.content); d = parsed.d; docText = parsed.doc;
          if (!d) throw new LLMError('الموديل ماردّش JSON صالح: ' + clean(r.content, 140));
        }
        applyTurn(ag, d, reasoning, msgs, docText);
      } catch (e) {
        log('error', ag.name, 'all', `${e.name === 'LLMError' ? '' : e.name + ': '}${e.message}`.slice(0, 500));
        ag.nextDue = S.clock + 60;
      } finally { busy = null; D.onChange(); }
    }
    async function runReflection(ag) {
      busy = ag.name; D.onChange();
      try {
        let d, reasoning = '';
        if (ag.provider === 'mock') { await D.sleep(500 + D.rand() * 700); d = mockReflect(ag); }
        else {
          const r = await callLLM(ag, systemFor(ag), buildReflectPrompt(ag));
          reasoning = r.reasoning; d = parseJson(r.content);
          if (!d) throw new LLMError('التقييم: JSON غير صالح: ' + clean(r.content, 140));
        }
        const valid = activeAgents().map(a => a.name).filter(n => n !== ag.name);
        const ratings = d.ratings && typeof d.ratings === 'object' ? d.ratings : {};
        for (const [k, v] of Object.entries(ratings)) {
          const who = canon(k, valid); if (!who) continue;
          const score = parseFloat(v && v.score); if (!Number.isFinite(score)) continue;
          S.relations.push({ id: ++S.ids.rel, ts: iso(), day: S.day, src: ag.name, dst: who, score: clamp(score, -10, 10), reason: clean(v.reason, 300) });
        }
        ag.memory = clean(d.memory, cfg().memory_chars) || ag.memory;
        ag.mood = clean(d.mood, 24) || ag.mood; ag.thought = clean(d.thought, 900);
        addThought(ag.name, 'reflection', clean(d.thought, 900) || '(none)');
        if (reasoning) addThought(ag.name, 'reasoning', clean(reasoning, 1500));
        touch(); return true;
      } catch (e) {
        log('error', ag.name, 'all', ('التقييم فشل - ' + e.message).slice(0, 500)); return false;
      } finally { busy = null; D.onChange(); }
    }
    function reflectionDue() {
      if (S.kv.forceReflect) return true;
      if (S.kv.reflected === S.day) return false;
      if ((S.kv.turns[turnsKey()] || 0) < 1) return false;
      return simHour() >= cfg().reflection_hour;
    }
    function due(ag, t) {
      if (!ag.active) return false;
      const recent = (turnLog[ag.name] || []).filter(x => t - x < 3600);
      turnLog[ag.name] = recent;
      if (recent.length >= cfg().max_turns_per_hour) return false;
      if (t - ag.lastTurn < cfg().min_gap_seconds) return false;
      return ag.wake || t >= ag.nextDue;
    }

    /** Advance the simulation by dt seconds of watching. Called about once per second by the page. */
    async function tick(dt) {
      if (!S || paused || busy || ticking) return;   // the company clock is frozen while a model is thinking
      ticking = true;
      try {
        dt = clamp(dt, 0, 120);
        S.clock += dt; S.dayT += dt;
        while (S.dayT >= DAY_S()) { S.dayT -= DAY_S(); S.day += 1; }
        if (reflectionDue()) {
          for (const ag of activeAgents()) await runReflection(ag);
          S.kv.reflected = S.day; S.kv.forceReflect = false;
          log('system', 'System', 'all', `🌙 Day ${S.day} wrapped up - everyone reflected and rated their coworkers.`);
        } else if (isWork()) {
          const list = activeAgents().sort((a, b) => a.nextDue - b.nextDue);
          for (const ag of list) { if (due(ag, S.clock)) { await runTurn(ag); break; } }
        }
      } finally { ticking = false; D.onChange(); }
    }

    // ----------------------------------------------------------- boss actions
    function boss(action, p) {
      p = p || {};
      const name = p.name || '';
      switch (action) {
        case 'message': {
          const text = clean(p.text, 1500); if (!text) return { error: 'رسالة فاضية' };
          const who = (p.to || 'all') === 'all' ? 'all' : (getAgent(p.to) || {}).name;
          if (!who) return { error: 'موظف غير معروف' };
          log('boss', BOSS, who, text); wake(who === 'all' ? null : [who]); break;
        }
        case 'task': {
          const title = clean(p.title, 300), who = (getAgent(p.assignee) || {}).name;
          if (!title || !who) return { error: 'محتاج عنوان وموظف' };
          const id = addTaskRaw({ title, assignee: who, brief: clean(p.brief, 1500) });
          log('task', BOSS, who, `New task #${id} for you from the Boss: ${title}` + (p.brief ? ' (see the brief in your task list)' : '')); wake([who]); break;
        }
        case 'review': {
          const doc = S.docs.find(d => d.id === parseInt(p.id, 10)); if (!doc) return { error: 'مستند غير موجود' };
          if (doc.status === 'reference') return { error: 'ده مستند مرجعي مش مخرج موظف' };
          const approve = p.verdict === 'approve', comment = clean(p.comment, 800);
          doc.status = approve ? 'approved' : 'changes_requested';
          doc.review = { verdict: approve ? 'approved' : 'changes requested', comment, ts: iso(), v: doc.version };
          const task = doc.taskId && S.tasks.find(x => x.id === doc.taskId);
          if (approve && task) { task.status = 'done'; task.progress = 100; }
          log('boss', BOSS, doc.lastAuthor, `Boss review of document #${doc.id} "${doc.title}" (v${doc.version}): ${approve ? 'APPROVED' : 'CHANGES REQUESTED'}.${comment ? ' ' + comment : ''}`, doc.id);
          wake(getAgent(doc.lastAuthor) ? [doc.lastAuthor] : null); break;
        }
        case 'refdoc': {
          const title = clean(p.title, 80), content = String(p.content || '').trim();
          if (!title || content.length < 5) return { error: 'محتاج عنوان ومحتوى' };
          const doc = saveDoc(BOSS, { title, content, status: 'reference', summary: 'reference material from the Boss' });
          const row = log('event', BOSS, 'all', `📎 The Boss shared reference document #${doc.id} «${doc.title}» - read it and use it.`, doc.id);
          doc.touched = row.id; wake(null, 1); break;
        }
        case 'promote': {
          const a = getAgent(name); if (!a) return { error: 'موظف غير معروف' };
          const newTitle = clean(p.title, 80) || a.title;
          const pct = parseFloat(p.raise_pct) || 0;
          const salary = Math.round(a.salary * (1 + pct / 100));
          const old = a.title; a.title = newTitle; a.salary = salary;
          if (newTitle !== old && p.announce !== false) log('promo', BOSS, 'all', `📣 ${name}: ${old} → ${newTitle}`);
          log('boss', BOSS, name, `Boss to you: your title is now '${newTitle}'.` + (pct ? ` You also got a ${pct}% raise (new salary ${salary.toLocaleString('en-US')} ${cfg().currency}).` : ''));
          wake(null, 1); break;
        }
        case 'event': {
          const text = clean(p.text, 800); if (!text) return { error: 'حدث فاضي' };
          log('event', BOSS, 'all', text); wake(null, 1); break;
        }
        case 'goal': {
          const text = clean(p.text, 500); if (!text) return { error: 'هدف فاضي' };
          cfg().goal = text; log('event', BOSS, 'all', `🎯 New company goal: ${text}`); wake(null, 1); break;
        }
        case 'fire': {
          const a = getAgent(name); if (!a) return { error: 'موظف غير معروف' };
          a.active = false; log('event', BOSS, 'all', `🚪 ${name} (${a.title}) has been let go by the Boss.`); wake(null, 1); break;
        }
        case 'remove': {
          const a = getAgent(name); if (!a) return { error: 'موظف غير معروف' };
          if (busy === name) return { error: 'الموظف بيفكر دلوقتي — جرّب بعد ثواني' };
          const rest = S.agents.filter(x => x !== a && x.active);
          S.tasks = S.tasks.filter(t => { if (t.assignee !== name || t.status === 'done') return true; if (!rest.length) return false; t.assignee = rest[0].name; return true; });
          S.agents = S.agents.filter(x => x !== a); S.agents.forEach((x, i) => { x.idx = i; });
          S.relations = S.relations.filter(r => r.src !== name && r.dst !== name); delete turnLog[name];
          log('event', BOSS, 'all', `🚪 ${name} (${a.title}) left the company permanently. Their open tasks were reassigned.`); wake(null, 1); break;
        }
        case 'rehire': {
          const a = getAgent(name); if (!a) return { error: 'موظف غير معروف' };
          a.active = true; a.wake = true; log('event', BOSS, 'all', `🤝 ${name} is back at the company.`); break;
        }
        case 'control': {
          const act = p.action;
          if (act === 'pause') paused = true;
          else if (act === 'resume') paused = false;
          else if (act === 'turn_now') { const a = getAgent(name); if (a) { a.wake = true; a.lastTurn = -1e9; } }
          else if (act === 'reflect_now') S.kv.forceReflect = true;
          else if (act === 'skip_evening') { if (!isWork()) { S.day += 1; S.dayT = 0; } }
          break;
        }
        default: return { error: 'أمر غير معروف' };
      }
      touch(); D.onChange(); return { ok: true };
    }

    // ------------------------------------------------------------ settings
    function updateConfig(p) {
      const c = cfg();
      ['company_name', 'language', 'currency'].forEach(k => { if (p[k] != null && String(p[k]).trim()) c[k] = String(p[k]).trim().slice(0, 200); });
      if (p.goal != null && String(p.goal).trim() && String(p.goal).trim() !== c.goal) c.goal = String(p.goal).trim().slice(0, 500);
      const num = (k, lo, hi) => { const v = parseFloat(p[k]); if (Number.isFinite(v)) c[k] = clamp(v, lo, hi); };
      num('day_real_minutes', 1, 240); num('turn_minutes', 0.25, 60); num('min_gap_seconds', 0, 600); num('max_turns_per_hour', 1, 600);
      num('work_end', 10, 23); num('reflection_hour', 10, 23); num('memory_chars', 300, 4000);
      if (c.work_end > c.day_end_hour) c.day_end_hour = Math.min(24, c.work_end + 1);
      if (c.reflection_hour > c.day_end_hour) c.reflection_hour = c.work_end;
      touch(); D.onChange();
    }
    function updateAgent(name, p) {
      const a = getAgent(name); if (!a) return { error: 'موظف غير معروف' };
      ['title', 'persona', 'private_goal', 'emoji'].forEach(k => { if (p[k] != null) a[k] = String(p[k]).slice(0, k === 'persona' || k === 'private_goal' ? 600 : 80); });
      if (p.provider && PROVIDERS[p.provider]) a.provider = p.provider;
      if (p.models != null) {
        const list = String(p.models).split(',').map(x => x.trim()).filter(Boolean);
        a.models = list.join(', '); a.model = list[0] || a.model;
      } else if (p.provider) { const list = PROVIDERS[p.provider].models.split(',').map(x => x.trim()); a.models = list.join(', '); a.model = list[0]; }
      touch(); D.onChange(); return { ok: true };
    }
    function addAgent(p) {
      if (S.agents.length >= MAX_AGENTS) return { error: `الحد الأقصى ${MAX_AGENTS} موظفين` };
      const name = clean(p.name, 20).replace(/[^\p{L}\p{N} _-]/gu, '');
      if (!name || getAgent(name) || name.toLowerCase() === 'boss' || name.toLowerCase() === 'all') return { error: 'اسم غير صالح أو مكرر' };
      addAgentRaw({ name, title: clean(p.title, 80) || 'Employee', salary: 15000, provider: PROVIDERS[p.provider] ? p.provider : 'mock',
        models: p.models, persona: clean(p.persona, 600), private_goal: clean(p.private_goal, 600) });
      log('event', BOSS, 'all', `👋 New hire: ${name}, ${clean(p.title, 80) || 'Employee'}.`); wake(null, 0.7);
      touch(); D.onChange(); return { ok: true };
    }
    /** Put a working model first for every employee that uses this provider. */
    function adoptModel(provider, model) {
      S.agents.filter(a => a.provider === provider).forEach(a => {
        const rest = String(a.models || '').split(',').map(x => x.trim()).filter(x => x && x !== model);
        a.model = model; a.models = [model, ...rest].join(', ');
      });
      touch();
    }
    /** Settings "test" button: checks the key end to end and returns a human readable verdict. */
    async function testProvider(provider) {
      const key = D.getKey(provider);
      if (!key) return { ok: false, detail: 'مفيش مفتاح' };
      const first = (S && S.agents.find(a => a.provider === provider && a.active)) || null;
      const models = first ? first.models : PROVIDERS[provider].models;
      const ag = { provider, model: models.split(',')[0].trim(), models };
      try {
        const r = await callLLM(ag, 'You are a connectivity test.', 'Reply with the single word: ok', { noRetry: true, maxTokens: 200, noSwitch: true });
        const changed = r.model !== ag.model;
        if (changed && S) adoptModel(provider, r.model);
        return { ok: true, model: r.model, detail: `بموديل ${r.model}${changed ? ' (الموديل المضبوط ماكانش متاح، واتحوّل تلقائياً)' : ''}` };
      } catch (e) { return { ok: false, detail: e.message }; }
    }
    async function fetchModels(provider) {
      const ids = await listModels(provider);
      return ids.filter(id => !BAD_MODEL.test(id)).sort();
    }

    // --------------------------------------------------------------- readers
    function getState() {
      const t = S.clock, work = isWork(), out = [];
      for (const a of S.agents) {
        let loc = a.loc;
        if (!a.active) loc = 'fired'; else if (!work) loc = 'home'; else if (loc !== 'desk' && t - a.locTs > LOC_TTL()) loc = 'desk';
        let last = null;
        for (let i = S.feed.length - 1; i >= 0; i--) { const m = S.feed[i]; if (m.actor === a.name && ['say', 'dm', 'work', 'doc', 'break'].includes(m.kind)) { last = m; break; } }
        out.push({ name: a.name, idx: a.idx, title: a.title, salary: a.salary, provider: a.provider, model: a.model, mood: a.mood, loc,
          thought: a.thought, active: a.active, emoji: a.emoji, color: a.color, busy: busy === a.name, last: last && { kind: last.kind, target: last.target, text: last.text, t: last.t } });
      }
      const c = cfg();
      const missing = [...new Set(S.agents.filter(a => a.active && a.provider !== 'mock' && !D.getKey(a.provider)).map(a => PROVIDERS[a.provider].label))];
      return { company: c.company_name, goal: c.goal, now: iso(), server_ts: t, day: S.day, work, paused, busy,
        bubble_ttl: BUBBLE_TTL(), work_hours: [c.day_start_hour, c.work_end], currency: c.currency, day_real_minutes: c.day_real_minutes,
        agents: out, tasks: S.tasks.map(x => Object.assign({}, x)), turns_today: S.kv.turns[turnsKey()] || 0,
        needs_setup: missing.length > 0, missing_keys: missing, docs_count: S.docs.length };
    }
    function getFeed(since, limit) {
      limit = limit || 150;
      if (!since || since <= 0) return S.feed.slice(-limit);
      const out = []; for (let i = S.feed.length - 1; i >= 0 && S.feed[i].id > since; i--) out.push(S.feed[i]);
      return out.reverse().slice(0, limit);
    }
    function getAgentDetail(name) {
      const a = getAgent(name); if (!a) return { error: 'unknown' };
      return { name, title: a.title, salary: a.salary, provider: a.provider, model: a.model, mood: a.mood, memory: a.memory,
        persona: a.persona, private_goal: a.private_goal,
        thoughts: S.thoughts.filter(t => t.agent === name).slice(-40).reverse(), relations: latestRel(name),
        tasks: S.tasks.filter(t => t.assignee === name) };
    }
    const docSummary = d => ({ id: d.id, title: d.title, author: d.author, lastAuthor: d.lastAuthor, version: d.version, status: d.status,
      taskId: d.taskId, updated: d.updated, day: d.day, len: d.content.length, summary: d.summary, review: d.review });
    const getDocs = () => S.docs.map(docSummary).reverse();
    const getDoc = id => { const d = S.docs.find(x => x.id === parseInt(id, 10)); return d ? JSON.parse(JSON.stringify(d)) : null; };
    const getRelations = () => S.relations.slice();
    const getConfig = () => JSON.parse(JSON.stringify(cfg()));
    const getAgentsConfig = () => S.agents.map(a => ({ name: a.name, emoji: a.emoji, title: a.title, persona: a.persona, private_goal: a.private_goal, provider: a.provider, models: a.models, active: a.active }));
    function exportAll() {
      return { exported: new Date().toISOString(), config: S.config, startDate: S.startDate, day: S.day,
        agents: S.agents.map(a => Object.assign({}, a)), feed: S.feed, thoughts: S.thoughts, relations: S.relations, tasks: S.tasks, docs: S.docs };
    }
    function exportCSV(table) {
      let data = S[table]; if (!Array.isArray(data) || !data.length) return '﻿';
      if (table === 'docs') data = data.map(d => ({ id: d.id, title: d.title, author: d.author, lastAuthor: d.lastAuthor, version: d.version, status: d.status, taskId: d.taskId, created: d.created, updated: d.updated, summary: d.summary, content: d.content }));
      const keys = Object.keys(data[0]);
      const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      return '﻿' + [keys.join(',')].concat(data.map(r => keys.map(k => esc(r[k])).join(','))).join('\n');
    }
    function exportDocsMd() {
      return S.docs.map(d => `<!-- doc #${d.id} | ${d.author} | v${d.version} | ${d.status} -->\n# ${d.title}\n\n_by ${d.lastAuthor} · v${d.version} · ${d.status}_\n\n${d.content}`).join('\n\n---\n\n');
    }
    function useMockForAll() {
      S.agents.forEach(a => { a.provider = 'mock'; a.models = 'mock'; a.model = 'mock'; }); touch(); D.onChange();
    }
    function flush(force) {
      if (!S) return false;
      if (force || dirty || S.clock - lastSavedClock > 30) {
        D.save(S); dirty = false; lastSavedClock = S.clock; return true;
      }
      return false;
    }

    return { init, tick, boss, updateConfig, updateAgent, addAgent, testProvider, fetchModels, getState, getFeed, getAgentDetail, getRelations,
      getDocs, getDoc, getConfig, getAgentsConfig, exportAll, exportCSV, exportDocsMd, useMockForAll, flush, isPaused: () => paused, _state: () => S };
  }

  return { createSim, PROVIDERS, DEFAULT_CONFIG, MAX_AGENTS, LLMError, parseTurnReply, pickModel, hintFor };
});
