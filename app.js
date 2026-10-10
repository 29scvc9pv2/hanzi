/* Hànzì — apprendre quelques caractères chinois par jour. Vanilla JS, hors ligne, données locales. */
"use strict";
const VERSION = "2.0";
const KEY = "hanzi.v1";
const BY = Object.fromEntries(CONTENT.map((x, i) => [x.c, Object.assign({ i }, x)]));
const MAX_REVIEWS = 30;   // révisions max par session
const BACKLOG = 15;       // au-delà, pas de nouveaux caractères : on rattrape d'abord

/* ---------- utilitaires ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function today() { // jour local, bascule à 4 h du matin
  const d = new Date(Date.now() - 4 * 3600e3);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2400); }
function haptic() { try { navigator.vibrate && navigator.vibrate(10); } catch (e) {} }
const plural = (n, s, p) => n + " " + (n > 1 ? (p || s + "s") : s);

/* ---------- état ---------- */
const DEFAULT = () => ({ settings: { newPerDay: 3, writeInReview: true, toneColors: true, rate: 0.75 }, cards: {}, log: {}, streak: { last: null, count: 0, freeze: null }, primerDone: false, revCount: 0, lastExport: null });
let S = load();
function sanitize(s) {
  const d = DEFAULT();
  s = Object.assign(d, s, { settings: Object.assign(d.settings, s.settings || {}), streak: Object.assign(d.streak, s.streak || {}) });
  const ok = (v) => typeof v === "number" && isFinite(v);
  for (const c of Object.keys(s.cards || {})) { // caractère retiré du contenu ou carte corrompue
    const k = s.cards[c];
    if (!BY[c] || !k || !ok(k.ivl) || !ok(k.ease) || !ok(k.due)) delete s.cards[c];
  }
  return s;
}
function load() { try { const raw = localStorage.getItem(KEY); if (raw) return sanitize(JSON.parse(raw)); } catch (e) {} return DEFAULT(); }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast("Impossible d'enregistrer la progression"); } }
function logToday() { const d = today(); return (S.log[d] = S.log[d] || { new: 0, rev: 0, bonus: 0 }); }
function jokerFree(d) { return S.streak.freeze == null || d - S.streak.freeze >= 7; }
function touchStreak() { // série de jours ; 1 jour manqué toléré par semaine (joker)
  const d = today(), last = S.streak.last;
  if (last === d) return;
  if (last === d - 1) S.streak.count++;
  else if (last === d - 2 && jokerFree(d)) { S.streak.count++; S.streak.freeze = d - 1; }
  else S.streak.count = 1;
  S.streak.last = d;
}
function currentStreak() { const d = today(), l = S.streak.last; return l === d || l === d - 1 || (l === d - 2 && jokerFree(d)) ? S.streak.count : 0; }
function status(c) { const k = S.cards[c]; if (!k) return "new"; return k.ivl >= 21 ? "mastered" : "learning"; }
function dueList() { const d = today(); return Object.keys(S.cards).filter((c) => S.cards[c].due <= d).sort((a, b) => S.cards[a].due - S.cards[b].due || BY[a].i - BY[b].i); }
function newQuota() { const l = S.log[today()] || { new: 0, bonus: 0 }; return Math.max(0, S.settings.newPerDay + (l.bonus || 0) - (l.new || 0)); }
function nextNew(n) { return CONTENT.filter((x) => !S.cards[x.c]).slice(0, n).map((x) => x.c); }

/* ---------- répétition espacée (SM-2 simplifié) ---------- */
function preview(card, g) { // nouvel intervalle en jours
  if (g === 1) return 0;
  const ivl = card.ivl || 0, ease = card.ease || 2.5;
  let n;
  if (ivl === 0) n = g === 4 ? 3 : 1;
  else if (ivl === 1) n = g === 2 ? 1 : g === 3 ? 3 : 5;
  else n = Math.round(ivl * (g === 2 ? 1.2 : g === 3 ? ease : ease * 1.3));
  if (g >= 3) n = Math.max(n, ivl + 1);
  return Math.min(n, 365);
}
function grade(c, g) {
  const k = S.cards[c];
  const n = preview(k, g);
  if (g === 1) { k.lapses = (k.lapses || 0) + 1; k.ease = Math.max(1.3, k.ease - 0.2); }
  if (g === 2) k.ease = Math.max(1.3, k.ease - 0.15);
  if (g === 4) k.ease = Math.min(3.2, k.ease + 0.15);
  const fuzz = n >= 7 ? Math.round(n * (Math.random() * 0.1 - 0.05)) : 0;
  k.ivl = n + fuzz; k.due = today() + k.ivl; k.reps = (k.reps || 0) + 1;
}
function relearned(c, g) { // 2e passage dans la même session : pas de double pénalité
  const k = S.cards[c]; k.ivl = g === 4 ? 3 : 1; k.due = today() + k.ivl;
}
const ivlLabel = (n) => n === 0 ? "< 10 min" : n < 30 ? n + " j" : n < 365 ? Math.round(n / 30) + " mois" : "1 an";

/* ---------- audio ---------- */
let VOICE = null;
function pickVoice() {
  if (!("speechSynthesis" in window)) return;
  const vs = speechSynthesis.getVoices();
  VOICE = vs.find((v) => v.lang === "zh-CN" && /ting|li-mu|yu-shu/i.test(v.name)) || vs.find((v) => v.lang === "zh-CN") || vs.find((v) => /^zh/i.test(v.lang) && !/HK|TW/i.test(v.lang)) || null;
}
if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(text) {
  if (!("speechSynthesis" in window)) { toast("Synthèse vocale indisponible"); return; }
  if (!VOICE) pickVoice();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN"; if (VOICE) u.voice = VOICE; u.rate = S.settings.rate;
  // WebKit perd parfois un énoncé lancé juste après cancel()
  if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); setTimeout(() => speechSynthesis.speak(u), 60); }
  else speechSynthesis.speak(u);
}
const sayChar = (c) => speak(BY[c].s || c);

/* ---------- rendu commun ---------- */
const py = (it) => `<span class="t${it.t}">${esc(it.p)}</span>`;
const SPK = "🔊";
const spk = (text, label = "Écouter") => `<button class="speak" data-say="${esc(text)}" aria-label="${label}">${SPK}</button>`;
const GRID = `<svg class="grid" viewBox="0 0 100 100" preserveAspectRatio="none"><g stroke="currentColor" stroke-width=".4" stroke-dasharray="2 2" opacity=".22" fill="none"><line x1="0" y1="50" x2="100" y2="50"/><line x1="50" y1="0" x2="50" y2="100"/><line x1="0" y1="0" x2="100" y2="100"/><line x1="100" y1="0" x2="0" y2="100"/></g></svg>`;
function details(it) {
  const comps = it.k && it.k.length ? `<div class="card"><div class="label">Composants</div><div class="chips">${it.k.map(([f, n]) => `<span class="chip"><b>${esc(f)}</b>${esc(n)}</span>`).join("")}</div></div>` : "";
  const ety = it.e ? `<div class="card"><div class="label">Origine</div>${esc(it.e)}</div>` : "";
  return `${comps}${ety}
  <div class="card"><div class="label">Astuce pour retenir</div>${esc(it.n)}</div>
  <div class="card"><div class="label">Mot exemple</div><div class="word"><span class="hz">${esc(it.w[0])}</span><div class="grow"><b>${esc(it.w[1])}</b><div class="muted">${esc(it.w[2])}</div></div>${spk(it.w[0], "Écouter le mot")}</div></div>`;
}
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
const loader = (ch, ok) => ok(STROKES[ch]);
function makeWriter(el, c, o = {}) {
  el.innerHTML = GRID;
  const size = el.clientWidth || 280;
  const host = document.createElement("div"); el.appendChild(host);
  return HanziWriter.create(host, c, Object.assign({
    width: size, height: size, padding: Math.round(size * 0.06), charDataLoader: loader,
    strokeColor: css("--ink"), outlineColor: css("--outline"), drawingColor: css("--accent"), highlightColor: css("--t3"),
    drawingWidth: Math.max(14, Math.round(size / 18)),
    strokeAnimationSpeed: 1.1, delayBetweenStrokes: 220, showCharacter: false, showOutline: true,
  }, o));
}
// Caractère « statique » rendu avec les mêmes formes que le tracé (cohérence visuelle)
function staticGlyph(el, c) {
  const s = el.clientWidth || 150;
  HanziWriter.create(el, c, { width: s, height: s, padding: 4, charDataLoader: loader, strokeColor: css("--ink"), showOutline: false, showCharacter: true, renderer: "svg" });
}
function flashErr(el) { haptic(); el.classList.add("err"); setTimeout(() => el.classList.remove("err"), 350); }
document.addEventListener("click", (e) => { const b = e.target.closest("[data-say]"); if (b) speak(b.dataset.say); });

/* ---------- navigation ---------- */
let TAB = "today";
$("#tabbar").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (!b) return; TAB = b.dataset.tab; render(); });
function render(keepScroll) {
  document.body.classList.toggle("notone", !S.settings.toneColors);
  document.querySelectorAll("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === TAB));
  ({ today: viewToday, collection: viewCollection, settings: viewSettings })[TAB]();
  if (!keepScroll) window.scrollTo(0, 0);
}
const OV = $("#overlay");
let savedScroll = 0;
function openOverlay(html) {
  if (OV.classList.contains("hidden")) savedScroll = window.scrollY;
  OV.innerHTML = html; OV.classList.remove("hidden"); document.body.style.overflow = "hidden";
  OV._lock = Date.now() + 350; // évite qu'un double tap valide l'écran suivant
}
const locked = () => Date.now() < (OV._lock || 0);
function closeOverlay() {
  if (OV._writer) { try { OV._writer.cancelQuiz(); } catch (e) {} } OV._writer = null;
  OV.classList.add("hidden"); OV.innerHTML = ""; document.body.style.overflow = "";
  render(true); window.scrollTo(0, savedScroll);
}

/* ---------- Aujourd'hui ---------- */
function viewToday() {
  const due = dueList();
  const backlog = due.length > BACKLOG;
  const news = backlog ? [] : nextNew(newQuota());
  const sessDue = due.slice(0, MAX_REVIEWS);
  const learned = Object.keys(S.cards).length, mastered = CONTENT.filter((x) => status(x.c) === "mastered").length;
  const streak = currentStreak();
  const dateStr = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const nothing = !due.length && !news.length;
  const remaining = CONTENT.length - learned;
  const finishedAll = remaining === 0;
  $("#view").innerHTML = `
  <p class="sub" style="margin:0">${esc(dateStr.charAt(0).toUpperCase() + dateStr.slice(1))}</p>
  <h1><span class="hz">今天</span> · Aujourd'hui</h1>
  <div class="row" style="margin:10px 0 16px;flex-wrap:wrap;gap:8px"><span class="pill">🔥 ${streak ? plural(streak, "jour") + " d'affilée" : "Commence ta série aujourd'hui"}</span><span class="pill">${learned} / ${CONTENT.length} appris</span></div>
  ${!S.primerDone ? `<div class="card row"><div class="grow"><b>Débutant ?</b><div class="muted small">Découvre le pinyin et les 4 tons en 2 minutes avant de commencer.</div></div><button class="btn small" id="primer">Les tons</button></div>` : ""}
  <div class="card">
    ${nothing ? `<div class="center"><div class="done-emoji">✓</div><b>${finishedAll ? "Tu as découvert tous les caractères !" : "Tout est fait pour aujourd'hui"}</b><p class="muted small">${finishedAll ? "Continue tes révisions chaque jour pour les garder en mémoire." : "Reviens demain : la régularité compte plus que la quantité."}</p></div>
      ${remaining ? `<button class="btn ghost" id="bonus">Apprendre 1 caractère de plus</button>` : ""}`
    : `<div class="row" style="justify-content:space-around;text-align:center;margin-bottom:14px">
        <div><div class="big-num">${sessDue.length}</div><div class="muted small">${sessDue.length > 1 ? "révisions" : "révision"}</div></div>
        <div><div class="big-num">${news.length}</div><div class="muted small">${news.length > 1 ? "nouveaux" : "nouveau"}</div></div>
      </div>
      ${backlog ? `<p class="muted small center" style="margin:0 0 12px">${due.length} révisions en retard : on rattrape d'abord, les nouveaux caractères reprendront ensuite.</p>` : ""}
      ${news.length ? `<div class="preview">${news.map((c) => `<span class="hz">${esc(c)}</span>`).join("")}</div><div style="height:14px"></div>` : ""}
      <button class="btn" id="go">${sessDue.length ? "Commencer la session" : "Découvrir les nouveaux caractères"}</button>
      <p class="muted small center" style="margin:10px 0 0">≈ ${Math.max(2, Math.round(sessDue.length * 0.4 + news.length * 2.5))} min</p>`}
  </div>
  <h2>Progression</h2>
  <div class="card">
    <div class="row" style="margin-bottom:8px"><span class="grow">Caractères appris</span><b>${learned}</b></div>
    <div class="bar"><i style="width:${(learned / CONTENT.length) * 100}%"></i></div>
    <div class="row" style="margin:12px 0 8px"><span class="grow">Maîtrisés <span class="muted small">(révision ≥ 3 semaines)</span></span><b>${mastered}</b></div>
    <div class="bar"><i style="width:${(mastered / CONTENT.length) * 100}%;background:var(--ok)"></i></div>
  </div>`;
  const go = $("#go"); if (go) go.onclick = () => startSession(sessDue, news);
  const p = $("#primer"); if (p) p.onclick = openPrimer;
  const b = $("#bonus"); if (b) b.onclick = () => { logToday().bonus++; save(); startSession([], nextNew(1)); };
}

/* ---------- Session ---------- */
let SESS = null;
function startSession(due, news) {
  const steps = [];
  due.forEach((c) => steps.push({ type: "review", c, mode: S.settings.writeInReview && (S.cards[c].reps || 0) % 2 === 1 ? "write" : "read" }));
  // découvrir + tracer chaque caractère, PUIS l'écrire de mémoire dans le désordre (vrai rappel, pas mémoire immédiate)
  news.forEach((c) => steps.push({ type: "learn", c, phase: 0, stopAt: 1 }));
  shuffle(news).forEach((c) => steps.push({ type: "learn", c, phase: 2 }));
  if (news.length) steps.push({ type: "quiz", list: shuffle(news), qi: 0, news: news.slice() });
  SESS = { steps, i: 0, done: { rev: 0, new: 0, again: 0 } };
  if (steps.length) next(true);
}
function sessionHead(frac = 0) {
  const pct = Math.min(100, ((SESS.i + frac) / Math.max(1, SESS.steps.length)) * 100);
  return `<div class="ohead"><button class="x" id="close" aria-label="Fermer">✕</button><div class="progress"><div class="bar"><i style="width:${pct}%"></i></div></div></div>`;
}
function bindClose() { $("#close").onclick = () => { if (SESS && SESS.i < SESS.steps.length && !confirm("Quitter la session ? Ce qui est déjà fait est enregistré.")) return; SESS = null; closeOverlay(); }; }
function next(first) {
  if (!first) SESS.i++;
  if (SESS.i >= SESS.steps.length) return finish();
  const st = SESS.steps[SESS.i];
  ({ review: stepReview, learn: stepLearn, quiz: stepQuiz })[st.type](st);
}
function finish() {
  touchStreak(); save();
  const d = SESS.done; SESS.i = SESS.steps.length;
  const parts = [];
  if (d.new) parts.push(plural(d.new, "nouveau caractère", "nouveaux caractères"));
  if (d.rev) parts.push(plural(d.rev, "révision"));
  openOverlay(`${sessionHead()}<div class="obody center">
    <div class="done-emoji">🎉</div><h1>Bravo !</h1>
    <p class="muted">${parts.join(" · ") || "Session terminée"}</p>
    <div class="card"><span class="pill">🔥 ${plural(currentStreak(), "jour")} d'affilée</span>
    ${d.again ? `<p class="small" style="margin:10px 0 0">${plural(d.again, "caractère")} à revoir : ${d.again > 1 ? "ils reviendront" : "il reviendra"} dès demain.</p>` : ""}
    ${d.new ? `<p class="muted small" style="margin:10px 0 0">Les nouveaux caractères reviendront demain, puis à intervalles croissants.</p>` : ""}</div>
  </div><div class="ofoot"><button class="btn" id="end">Terminer</button></div>`);
  $("#end").onclick = () => { SESS = null; closeOverlay(); };
  bindClose();
}

/* Révision : lecture (caractère → sens/son) ou écriture (sens/son → caractère) */
function stepReview(st) {
  const it = BY[st.c], k = S.cards[st.c];
  const nStrokes = STROKES[st.c].strokes.length;
  const gradesHtml = (sug) => `<div class="grades">${[1, 2, 3, 4].map((g) => `<button class="g${g} ${g === sug ? "sug" : ""}" data-g="${g}">${["Oublié", "Difficile", "Bien", "Facile"][g - 1]}<small>${st.relearn ? (g === 4 ? "3 j" : "1 j") : ivlLabel(preview(k, g))}</small></button>`).join("")}</div>`;
  const apply = (g) => {
    if (locked()) return;
    haptic();
    if (st.relearn) relearned(st.c, g);
    else {
      grade(st.c, g); SESS.done.rev++; logToday().rev++; S.revCount = (S.revCount || 0) + 1;
      if (g === 1) { SESS.done.again++; SESS.steps.splice(Math.min(SESS.steps.length, SESS.i + 4), 0, { type: "review", c: st.c, mode: "read", relearn: true }); }
    }
    touchStreak(); save(); next();
  };
  const bindGrades = () => { $("#foot").onclick = (e) => { const b = e.target.closest("[data-g]"); if (b) apply(+b.dataset.g); }; };
  if (st.mode === "read") {
    openOverlay(`${sessionHead()}<div class="obody"><div class="stage">
      <p class="muted small">${st.relearn ? "On revoit celui-ci" : "Que signifie ce caractère ? Comment se prononce-t-il ?"}</p>
      <div class="gw" id="g"></div><div id="ans"></div></div></div>
      <div class="ofoot" id="foot"><button class="btn" id="reveal">Afficher la réponse</button></div>`);
    staticGlyph($("#g"), st.c);
    $("#reveal").onclick = () => {
      if (locked()) return;
      $("#ans").innerHTML = `<div class="pinyin">${py(it)} ${spk(it.s || it.c)}</div><p class="meaning">${esc(it.m)}</p><div style="text-align:left;margin-top:14px">${details(it)}</div>`;
      sayChar(st.c);
      const tip = (S.revCount || 0) < 5 ? `<p class="muted small center" style="margin:0 0 8px">Note-toi honnêtement : c'est ce qui rend les révisions efficaces.</p>` : "";
      $("#foot").innerHTML = tip + gradesHtml(0);
      OV._lock = Date.now() + 300; bindGrades();
    };
  } else {
    openOverlay(`${sessionHead()}<div class="obody"><div class="stage">
      <p class="muted small">Écris de mémoire le caractère qui signifie</p>
      <p class="meaning"><b>${esc(it.m)}</b></p><div class="pinyin" style="font-size:22px">${py(it)} ${spk(it.s || it.c)}</div>
      <div class="writer lg" id="w"></div><div class="hint" id="hint">${plural(nStrokes, "trait")}</div></div></div>
      <div class="ofoot" id="foot"><button class="btn ghost" id="idk">Je ne sais pas</button></div>`);
    const box = $("#w"), w = makeWriter(box, st.c, { showOutline: false });
    OV._writer = w;
    const end = (mist, gaveUp) => {
      const sug = gaveUp ? 1 : mist <= Math.ceil(nStrokes / 4) ? 3 : mist <= Math.ceil(nStrokes / 2) + 1 ? 2 : 1;
      const msg = gaveUp ? "Regarde bien l'ordre des traits." : mist === 0 ? "Parfait !" : plural(mist, "erreur");
      $("#hint").innerHTML = `<b>${esc(msg)}</b> · ${esc(it.m)}`;
      if (gaveUp) { w.showCharacter(); w.animateCharacter(); }
      $("#foot").innerHTML = `<p class="muted small center" style="margin:0 0 8px">Note suggérée encadrée, ajuste si besoin</p>${gradesHtml(sug)}`;
      OV._lock = Date.now() + 400; bindGrades();
    };
    w.quiz({ showHintAfterMisses: 3, leniency: 1.1, onMistake: () => flashErr(box), onComplete: (d) => end(d.totalMistakes, false) });
    $("#idk").onclick = () => { try { w.cancelQuiz(); } catch (e) {} end(0, true); };
  }
  bindClose();
}

/* Nouveau caractère : 0 découvrir → 1 tracer sur le modèle → (plus tard) 2 écrire de mémoire */
function stepLearn(st) {
  const it = BY[st.c];
  if (st.phase === 2 && S.cards[st.c]) return next(); // écriture passée plus tôt
  const dots = (p) => `<div class="steps">${[0, 1, 2].map((i) => `<i class="${i <= p ? "on" : ""}"></i>`).join("")}</div>`;
  const nStrokes = STROKES[st.c].strokes.length;
  const create = (mist) => {
    if (!S.cards[st.c]) {
      S.cards[st.c] = { ivl: 1, ease: mist > 3 ? 2.3 : 2.5, due: today() + 1, reps: 0, lapses: 0, introduced: today(), mist };
      logToday().new++; SESS.done.new++; touchStreak(); save();
    }
  };
  if (st.phase === 0) {
    openOverlay(`${sessionHead(0)}<div class="obody">${dots(0)}<div class="stage">
      <p class="muted small" style="margin:0">Nouveau caractère</p>
      <div class="writer" id="w"></div>
      <div class="row" style="justify-content:center;gap:10px"><button class="btn small ghost" id="replay">↻ Ordre des traits</button><span class="muted small">${plural(nStrokes, "trait")}</span></div>
      <div class="pinyin" style="margin-top:10px">${py(it)} ${spk(it.s || it.c)}</div>
      <p class="meaning">${esc(it.m)}</p></div>
      <div style="margin-top:16px">${details(it)}</div></div>
      <div class="ofoot"><button class="btn" id="nx">Je le trace →</button></div>`);
    const w = makeWriter($("#w"), st.c, { showCharacter: false, showOutline: true });
    OV._writer = w;
    setTimeout(() => { try { w.animateCharacter(); } catch (e) {} }, 400);
    sayChar(st.c);
    $("#replay").onclick = () => { w.hideCharacter(); w.animateCharacter(); };
    $("#nx").onclick = () => { if (locked()) return; st.phase = 1; stepLearn(st); };
  } else {
    const trace = st.phase === 1;
    openOverlay(`${sessionHead(trace ? 0.5 : 0)}<div class="obody">${dots(st.phase)}<div class="stage">
      <p class="muted small" style="margin:0">${trace ? "Trace par-dessus le modèle, dans l'ordre" : "De mémoire : écris ce caractère"}</p>
      ${trace ? `<div class="glyph hz" style="font-size:36px;margin:2px 0">${esc(st.c)}</div>` : ""}
      <div class="pinyin" style="font-size:22px;margin-top:${trace ? 0 : 8}px">${py(it)} ${trace ? "" : spk(it.s || it.c)} · <span style="font-weight:400">${esc(it.m)}</span></div>
      <div class="writer lg" id="w"></div><div class="hint" id="hint">${trace ? "En cas d'erreur, le trait attendu s'illumine" : "Un indice apparaît après 3 erreurs sur un trait"}</div></div></div>
      <div class="ofoot" id="foot"><button class="btn ghost" id="skip">Passer l'écriture</button></div>`);
    const box = $("#w"), w = makeWriter(box, st.c, { showOutline: trace });
    OV._writer = w;
    w.quiz({
      showHintAfterMisses: trace ? 1 : 3, leniency: trace ? 1.4 : 1.1, onMistake: () => flashErr(box),
      onComplete: (d) => {
        haptic();
        if (trace) {
          $("#hint").innerHTML = "<b>Bien tracé !</b> Tu l'écriras de mémoire dans un instant.";
          $("#foot").innerHTML = `<button class="btn" id="nx">Continuer →</button>`;
          OV._lock = Date.now() + 300;
          $("#nx").onclick = () => { if (locked()) return; if (st.stopAt === 1) next(); else { st.phase = 2; stepLearn(st); } };
        } else {
          create(d.totalMistakes);
          $("#hint").innerHTML = d.totalMistakes === 0 ? "<b>Parfait, sans aucune erreur !</b>" : `<b>Réussi</b> · ${plural(d.totalMistakes, "erreur")}`;
          $("#foot").innerHTML = `<button class="btn" id="nx">Continuer</button>`;
          OV._lock = Date.now() + 300;
          $("#nx").onclick = () => { if (!locked()) next(); };
        }
      },
    });
    $("#skip").onclick = () => { try { w.cancelQuiz(); } catch (e) {} create(2); next(); };
  }
  bindClose();
}

/* Mini-quiz de consolidation : alterne « sens » (caractère → sens) et « écoute » (son → caractère) */
function stepQuiz(st) {
  const c = st.list[st.qi], it = BY[c];
  const audio = st.qi % 2 === 1;
  // distracteurs : d'abord les caractères du jour et déjà appris, puis les suivants du parcours
  const known = [...new Set([...st.news, ...Object.keys(S.cards)])].filter((x) => x !== c);
  const near = CONTENT.filter((x) => !S.cards[x.c] && !st.news.includes(x.c)).slice(0, 12).map((x) => x.c);
  const pool = [...shuffle(known), ...shuffle(near)].map((x) => BY[x]).filter((x) => x.m !== it.m && (!audio || x.p !== it.p));
  const opts = shuffle([it, ...pool.slice(0, 3)]);
  const frac = st.qi / Math.max(1, st.list.length);
  openOverlay(`${sessionHead(frac)}<div class="obody"><div class="stage">
    <p class="muted small">Petit quiz · ${st.qi + 1}/${st.list.length}</p>
    ${audio ? `<div style="margin:18px 0 8px"><button class="speak" style="width:88px;height:88px;font-size:38px" data-say="${esc(it.s || it.c)}" aria-label="Réécouter">${SPK}</button></div><p class="muted">Quel caractère entends-tu ?</p>`
      : `<div class="gw" id="g"></div><p class="muted">Que signifie ce caractère ?</p>`}</div>
    <div class="opts ${audio ? "hz4" : ""}" id="opts">${opts.map((o) => `<button class="opt" data-c="${esc(o.c)}">${esc(audio ? o.c : o.m)}</button>`).join("")}</div></div>
    <div class="ofoot" id="foot"></div>`);
  if (audio) setTimeout(() => sayChar(c), 250); else staticGlyph($("#g"), c);
  let answered = false;
  $("#opts").onclick = (e) => {
    const b = e.target.closest(".opt"); if (!b || answered || locked()) return; answered = true;
    const ok = b.dataset.c === c; haptic();
    b.classList.add(ok ? "right" : "wrong");
    if (!ok) { $(`.opt[data-c="${CSS.escape(c)}"]`).classList.add("right"); st.missed = st.missed || {}; if (!st.missed[c]) { st.missed[c] = 1; st.list.push(c); } }
    if (!audio) sayChar(c);
    $("#foot").innerHTML = `<p class="center" style="margin:0 0 10px">${ok ? "✓ Exact" : "✗ On le revoit dans un instant"} · <span class="hz">${esc(c)}</span> ${py(it)} · ${esc(it.m)}</p><button class="btn" id="nx">Continuer</button>`;
    OV._lock = Date.now() + 300;
    $("#nx").onclick = () => { if (locked()) return; st.qi++; if (st.qi < st.list.length) stepQuiz(st); else next(); };
  };
  bindClose();
}

/* ---------- Collection ---------- */
let FILTER = "all";
function viewCollection() {
  const list = CONTENT.filter((x) => FILTER === "all" || (FILTER === "learned" ? S.cards[x.c] : !S.cards[x.c]));
  $("#view").innerHTML = `<h1><span class="hz">字</span> · Collection</h1><p class="sub">${CONTENT.length} caractères, du plus simple au plus composé.</p>
  <div class="seg" id="seg">${[["all", "Tous"], ["learned", "Appris"], ["new", "À découvrir"]].map(([k, l]) => `<button data-f="${k}" class="${FILTER === k ? "on" : ""}">${l}</button>`).join("")}</div>
  <div class="grid" id="grid">${list.map((x) => `<button class="tile ${status(x.c)}" data-c="${esc(x.c)}"><span class="hz">${esc(x.c)}</span><small>${esc(x.p)}</small></button>`).join("") || `<p class="muted">Rien ici pour l'instant.</p>`}</div>
  <div class="legend"><span>┄ à découvrir</span><span style="color:var(--accent)">▢ en cours</span><span style="color:var(--ok)">▢ maîtrisé</span></div>`;
  $("#seg").onclick = (e) => { const b = e.target.closest("[data-f]"); if (b) { FILTER = b.dataset.f; viewCollection(); } };
  $("#grid").onclick = (e) => { const b = e.target.closest("[data-c]"); if (b) openDetail(b.dataset.c); };
}
function openDetail(c) {
  const it = BY[c], k = S.cards[c];
  const info = k ? `<span class="pill">${status(c) === "mastered" ? "Maîtrisé" : "En cours"} · révision ${k.due <= today() ? "aujourd'hui" : "dans " + plural(k.due - today(), "jour")}</span>` : `<span class="pill">Pas encore appris</span>`;
  openOverlay(`<div class="ohead"><button class="x" id="close" aria-label="Fermer">✕</button><div class="grow"></div>${info}</div>
  <div class="obody"><div class="stage">
    <div class="writer" id="w"></div>
    <div class="row" style="justify-content:center;gap:8px"><button class="btn small ghost" id="anim">↻ Traits</button><button class="btn small ghost" id="prac">✎ S'entraîner</button></div>
    <div class="pinyin" style="margin-top:10px">${py(it)} ${spk(it.s || it.c)}</div>
    <p class="meaning">${esc(it.m)}</p><div class="hint" id="hint"></div></div>
    <div style="margin-top:8px">${details(it)}</div></div>
  ${!k ? `<div class="ofoot"><button class="btn" id="learn">Apprendre maintenant</button></div>` : ""}`);
  const box = $("#w"), w = makeWriter(box, c, { showCharacter: true, showOutline: true });
  OV._writer = w;
  $("#close").onclick = closeOverlay;
  $("#anim").onclick = () => { try { w.cancelQuiz(); } catch (e) {} w.hideCharacter(); w.animateCharacter(); $("#hint").textContent = ""; };
  $("#prac").onclick = () => {
    w.hideCharacter(); $("#hint").textContent = "Écris le caractère (le contour sert de guide)";
    w.quiz({ showHintAfterMisses: 2, onMistake: () => flashErr(box), onComplete: (d) => { $("#hint").innerHTML = `<b>${d.totalMistakes ? plural(d.totalMistakes, "erreur") : "Parfait !"}</b>`; } });
  };
  const l = $("#learn"); if (l) l.onclick = () => { logToday().bonus++; save(); try { w.cancelQuiz(); } catch (e) {} OV._writer = null; startSession([], [c]); };
}

/* ---------- Introduction aux tons ---------- */
function openPrimer() {
  const T = [["妈", "mā", 1, "haut et plat", "M5,8 L45,8"], ["麻", "má", 2, "montant", "M5,30 L45,6"], ["马", "mǎ", 3, "descend puis remonte", "M5,16 Q22,40 45,10"], ["骂", "mà", 4, "tombant, sec", "M5,6 L45,36"], ["吗", "ma", 5, "léger, neutre", "M20,24 L30,24"]];
  openOverlay(`<div class="ohead"><button class="x" id="close" aria-label="Fermer">✕</button><b class="grow">Pinyin et tons</b></div><div class="obody">
  <div class="card"><b>Le pinyin</b> est l'écriture du son des caractères en alphabet latin. Chaque syllabe porte un <b>ton</b> : la même syllabe change de sens selon la mélodie.</div>
  <div class="card"><div class="label">Touche pour écouter « ma » sur les 4 tons</div>
  <div class="tones">${T.map(([c, p, t, d, path]) => `<button data-say="${c}"><span class="hz t${t}">${c}</span><b class="t${t}">${p}</b><svg viewBox="0 0 50 44" width="44" height="34" class="t${t}"><path d="${path}" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/></svg><div class="small muted">${d}</div></button>`).join("")}</div>
  <p class="small muted" style="margin:10px 0 0">mā maman · má chanvre · mǎ cheval · mà gronder · ma (question)</p></div>
  <div class="card"><div class="label">Les couleurs de l'app</div>
  Le pinyin est coloré selon le ton : <b class="t1">1er</b>, <b class="t2">2e</b>, <b class="t3">3e</b>, <b class="t4">4e</b>, <b class="t5">neutre</b>. Associer une couleur au ton aide à le mémoriser (désactivable dans les réglages).</div>
  <div class="card"><div class="label">3 règles de changement de ton</div>
  <p style="margin:0 0 8px">• Deux 3e tons de suite : le premier se prononce comme un 2e. <span class="hz">你好</span> nǐ hǎo → « ní hǎo ».</p>
  <p style="margin:0 0 8px">• <span class="hz">不</span> bù devient bú devant un 4e ton : <span class="hz">不是</span> bú shì.</p>
  <p style="margin:0">• <span class="hz">一</span> yī devient yí devant un 4e ton, yì devant les autres.</p></div>
  <div class="card"><div class="label">Comment fonctionne l'app</div>
  Chaque jour : d'abord les <b>révisions</b>, puis quelques <b>nouveaux caractères</b> : tu les découvres, tu les traces sur le modèle, puis tu les écris <b>de mémoire</b> un peu plus tard. Les révisions reviennent à intervalles croissants selon ta réponse : c'est la <b>répétition espacée</b>, la méthode la plus efficace pour retenir à long terme.</div>
  </div><div class="ofoot"><button class="btn" id="ok">C'est parti</button></div>`);
  $("#close").onclick = closeOverlay;
  $("#ok").onclick = () => { S.primerDone = true; save(); closeOverlay(); };
}

/* ---------- Réglages ---------- */
function viewSettings() {
  const s = S.settings;
  const sw = (id, on, label) => `<button class="switch ${on ? "on" : ""}" id="${id}" role="switch" aria-checked="${on}" aria-label="${label}"></button>`;
  const ago = S.lastExport == null ? "jamais" : today() - S.lastExport === 0 ? "aujourd'hui" : "il y a " + plural(today() - S.lastExport, "jour");
  $("#view").innerHTML = `<h1><span class="hz">设置</span> · Réglages</h1>
  <h2>Apprentissage</h2><div class="card">
    <div class="set"><div><b>Nouveaux caractères par jour</b><div class="muted small">3 à 5 est un bon rythme</div></div><div class="stepper"><button id="minus" aria-label="Moins">−</button><b id="npd">${s.newPerDay}</b><button id="plus" aria-label="Plus">+</button></div></div>
    <div class="set"><div><b>Écriture dans les révisions</b><div class="muted small">Une révision sur deux te demande d'écrire</div></div>${sw("wir", s.writeInReview, "Écriture dans les révisions")}</div>
    <div class="set"><div><b>Couleurs des tons</b><div class="muted small">Colore le pinyin selon le ton</div></div>${sw("tc", s.toneColors, "Couleurs des tons")}</div>
  </div>
  <h2>Voix</h2><div class="card">
    <div class="set"><div><b>Vitesse</b><div class="muted small">${VOICE ? "Voix : " + esc(VOICE.name) : "Voix chinoise par défaut"}</div></div><input type="range" min="0.5" max="1" step="0.05" value="${s.rate}" id="rate" aria-label="Vitesse de la voix"></div>
    <div class="set"><button class="btn small ghost" data-say="你好，我是你的中文老师。">${SPK} Tester la voix</button></div>
    <p class="muted small" style="margin:6px 0 0">Pas de son ou voix étrange ? Sur iPhone : Réglages › Accessibilité › Contenu énoncé › Voix › Chinois (Chine continentale), puis télécharge « Tingting » (ou une voix « améliorée »). Vérifie aussi que le mode silencieux est désactivé.</p>
  </div>
  <h2>Aide</h2><div class="card"><button class="btn ghost" id="primer">Revoir l'introduction aux tons</button></div>
  <h2>Sauvegarde</h2><div class="card">
    <p class="muted small" style="margin:0 0 10px">Ta progression est stockée uniquement sur ce téléphone. Exporte-la de temps en temps (Fichiers, iCloud Drive…). Dernier export : <b>${ago}</b>.</p>
    <div class="row"><button class="btn ghost" id="exp">Exporter</button><button class="btn ghost" id="imp">Importer</button></div>
    <input type="file" id="file" accept="application/json,.json" hidden>
  </div>
  <div class="card"><button class="btn ghost" id="reset" style="color:var(--bad)">Tout réinitialiser</button></div>
  <p class="muted small center">Hànzì v${VERSION} · ${CONTENT.length} caractères<br>Ordre des traits : Hanzi Writer (MIT) et Make Me a Hanzi<br>(données © Arphic Technology, Arphic Public License)</p>`;
  const set = (k, v) => { s[k] = v; save(); render(true); };
  $("#minus").onclick = () => set("newPerDay", Math.max(1, s.newPerDay - 1));
  $("#plus").onclick = () => set("newPerDay", Math.min(10, s.newPerDay + 1));
  $("#wir").onclick = () => set("writeInReview", !s.writeInReview);
  $("#tc").onclick = () => set("toneColors", !s.toneColors);
  $("#rate").onchange = (e) => { s.rate = +e.target.value; save(); speak("你好"); };
  $("#primer").onclick = openPrimer;
  $("#exp").onclick = exportData;
  $("#imp").onclick = () => $("#file").click();
  $("#file").onchange = importData;
  $("#reset").onclick = () => { if (confirm("Effacer toute ta progression ? Cette action est définitive.") && confirm("Vraiment tout effacer ?")) { S = DEFAULT(); save(); render(); toast("Progression réinitialisée"); } };
}
async function exportData() {
  const name = "hanzi-sauvegarde-" + new Date().toISOString().slice(0, 10) + ".json";
  const blob = new Blob([JSON.stringify({ app: "hanzi", version: VERSION, data: S })], { type: "application/json" });
  const done = () => { S.lastExport = today(); save(); render(true); };
  try {
    const file = new File([blob], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Sauvegarde Hànzì" }); return done(); }
  } catch (e) { if (e && e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); done();
}
function importData(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const j = JSON.parse(r.result); const d = j.data || j;
      if (!d || typeof d.cards !== "object" || typeof d.settings !== "object") throw new Error("format");
      if (!confirm("Remplacer ta progression actuelle par cette sauvegarde ?")) return;
      S = sanitize(d); save(); render(); toast("Sauvegarde importée : " + plural(Object.keys(S.cards).length, "caractère"));
    } catch (err) { toast("Fichier de sauvegarde invalide"); }
  };
  r.readAsText(f); e.target.value = "";
}

/* ---------- démarrage ---------- */
render();
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
  // nouvelle version installée : recharger si aucune session en cours (pas au tout premier lancement)
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded && !SESS && OV.classList.contains("hidden")) { reloaded = true; location.reload(); } });
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && OV.classList.contains("hidden")) render(true); });
try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (OV.classList.contains("hidden")) render(true); }); } catch (e) {}
