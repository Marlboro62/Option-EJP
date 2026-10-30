/*
 * Carte Option EJP — jours EJP (Pointe Mobile) de l'option EJP du Tarif Bleu d'EDF, pour Home Assistant.
 * Même style que la Carte Enedis Linky New et les Cartes Linky Énergie, mais indépendante.
 *
 * La carte lit elle-même le calendrier des jours EJP publié par EDF (celui de particulier.edf.fr) :
 * rien d'autre à installer. Elle peut aussi afficher des capteurs EJP existants (état EJP / Normal).
 *
 *   type: custom:option-ejp-card
 */

(() => {
const CARD_VERSION = "0.1.0-beta.1";

/* ------------------------------------------------------------- affichage */

const fmt = (n, digits = 1) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—"
    : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Classe de thème de la carte :
 *  v2   : style MyElectricalData, toujours bleu nuit ;
 *  auto : style MyElectricalData, bleu nuit si Home Assistant est en mode sombre, clair sinon ;
 *  ha   : couleurs du thème Home Assistant (clair ou sombre). */
const themeClass = (theme, hass) => {
  const light = hass?.themes?.darkMode === false;
  if (theme === "ha") return `th-ha${light ? " light" : ""}`;
  if (theme === "auto") return `th-v2${light ? " light" : ""}`;
  return "th-v2";
};

/* -------------------------------------------------------------- carte EJP */

// Grille Tarif Bleu option EJP au 1er août 2026 (cts € TTC/kWh)
const EJP_DEFAULTS = {
  title: "Option EJP",
  source: "auto", // auto : capteurs EJP s'ils existent, sinon calendrier EDF ; edf ; entities
  zone: "", // facultatif : texte ou entité affiché sous le titre
  today: "sensor.ejp_aujourd_hui",
  tomorrow: "sensor.ejp_demain",
  remaining: "sensor.ejp_jours_restants",
  peak: "binary_sensor.ejp_pointe_mobile",
  price_hn: 17.89,
  price_pm: 43.24,
  total_days: 22,
  show_prices: true,
  show_calendar: true,
  theme: "v2",
};

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const SEASON_MONTHS = [10, 11, 0, 1, 2]; // novembre → mars

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Type de jour d'un état : ejp, normal ou unknown (EJP / Normal du paquet, ou on / rouge / pointe d'autres sources). */
const dayType = (state) => {
  const s = String(state ?? "").trim().toLowerCase();
  if (["ejp", "on", "true", "rouge", "red", "pointe", "pm", "pointe mobile"].includes(s)) return "ejp";
  if (["normal", "non_ejp", "non ejp", "off", "false", "vert", "green", "hn", "heures normales"].includes(s)) return "normal";
  return "unknown";
};

/** Saison EJP (1er novembre → 31 mars) : celle qui commence à `startAttr` (AAAA-11-01) si elle est connue,
 *  sinon celle qui contient `d`, ou la dernière saison si `d` est hors saison.
 *  state : « current » (en cours), « upcoming » (pas commencée) ou « ended » (terminée). */
const seasonOf = (d, startAttr) => {
  const m = d.getMonth();
  const fromAttr = /^(\d{4})-11/.exec(String(startAttr || ""));
  const startYear = fromAttr ? Number(fromAttr[1]) : m >= 10 ? d.getFullYear() : d.getFullYear() - 1;
  const start = new Date(startYear, 10, 1);
  const end = new Date(startYear + 1, 2, 31, 23, 59, 59);
  const state = d < start ? "upcoming" : d > end ? "ended" : "current";
  return { start, end, state, inSeason: state === "current" };
};

/* ------------------------------------------------------ calendrier EDF */

// API du site particulier.edf.fr (non documentée : elle peut changer sans préavis)
const EDF_API = "https://api-commerce.edf.fr/commerce/activet/v1";
const EDF_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Situation-Usage": "Jours Effacement",
  "Application-Origine-Controlee": "site_RC",
};
const EDF_TTL = 30 * 60 * 1000; // relecture toutes les 30 minutes
const EDF_RETRY = 5 * 60 * 1000; // nouvel essai 5 minutes après une erreur
const EDF_CACHE_KEY = "option-ejp-card:edf";

// Date au format EDF : 2026-1-5 (sans zéro devant le mois et le jour)
const edfDate = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** GET JSON chez EDF : avec les en-têtes du site EDF, puis sans eux si le navigateur refuse. */
const edfGet = async (url) => {
  const read = async (opts) => {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`EDF a répondu ${r.status}`);
    return r.json();
  };
  try {
    return await read({ headers: EDF_HEADERS, credentials: "omit" });
  } catch (err) {
    return read({ credentials: "omit" });
  }
};

/** Cache partagé par toutes les cartes de la page, gardé aussi dans le navigateur. */
const EDF = { data: null, at: 0, error: null, promise: null, listeners: new Set() };
try {
  const saved = JSON.parse(localStorage.getItem(EDF_CACHE_KEY) || "null");
  if (saved?.data) Object.assign(EDF, { data: saved.data, at: saved.at || 0 });
} catch (err) { /* stockage indisponible */ }

const loadEdf = () => {
  const age = Date.now() - EDF.at;
  if (EDF.promise || (EDF.data && age < EDF_TTL) || (EDF.error && age < EDF_RETRY)) return;
  const now = new Date();
  const from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const calUrl = `${EDF_API}/calendrier-jours-effacement?option=EJP&dateApplicationBorneInf=${edfDate(from)}&dateApplicationBorneSup=${edfDate(to)}&identifiantConsommateur=src`;
  const seasonUrl = `${EDF_API}/saisons/search?option=EJP&dateReference=${dayKey(now)}`;
  EDF.promise = Promise.all([edfGet(calUrl), edfGet(seasonUrl).catch(() => null)])
    .then(([cal, season]) => {
      const options = cal?.content?.options;
      if (!Array.isArray(options) || !options.length) throw new Error("réponse EDF sans calendrier");
      EDF.data = { options, season: Array.isArray(season?.content) ? season.content[0] || null : null };
      EDF.error = null;
      try { localStorage.setItem(EDF_CACHE_KEY, JSON.stringify({ data: EDF.data, at: Date.now() })); } catch (err) { /* plein */ }
    })
    .catch((err) => { EDF.error = err?.message || String(err); })
    .finally(() => {
      EDF.at = Date.now();
      EDF.promise = null;
      EDF.listeners.forEach((fn) => fn());
    });
};

/** États de la carte (aujourd'hui, demain, jours restants, pointe) calculés à partir du calendrier EDF. */
const edfStates = (data, now) => {
  // EDF envoie un seul calendrier EJP (option « EJP »)
  const opt = data.options.find((o) => Array.isArray(o?.calendrier)) || data.options[0];
  const days = new Map((opt?.calendrier || []).filter((e) => e?.dateApplication).map((e) => [String(e.dateApplication).slice(0, 10), e.statut]));
  const at = (offset) => days.get(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)));
  // NON_EJP et HORS_PERIODE_EJP (avril → octobre) : jour normal ; autre valeur (lendemain pas encore publié) : inconnu
  const toState = (st) => (st === "EJP" ? "EJP" : st === "NON_EJP" || st === "HORS_PERIODE_EJP" ? "Normal" : "Inconnu");
  // Saison donnée par EDF (en cours, ou la prochaine si elle n'a pas commencé), sinon calculée
  const season = seasonOf(now, data.season?.premierJour);
  const from = dayKey(season.start);
  const to = dayKey(season.end);
  const list = [...days].filter(([k, st]) => st === "EJP" && k >= from && k <= to).map(([k]) => k).sort();
  const total = Number(data.season?.nombreJours) || 22;
  const tires = Number(data.season?.nombreJoursTires);
  const used = Number.isFinite(tires) ? tires : list.length;
  const h = now.getHours();
  const peak = (at(0) === "EJP" && h >= 7) || (at(-1) === "EJP" && h < 1);
  const off = (st) => (st === "HORS_PERIODE_EJP" ? { hors_periode: true } : {});
  return {
    today: { state: toState(at(0)), attributes: off(at(0)) },
    tomorrow: { state: toState(at(1)), attributes: off(at(1)) },
    remaining: { state: String(Math.max(0, total - used)), attributes: { total, utilises: used, jours: list, saison_debut: from } },
    peak: { state: peak ? "on" : "off", attributes: {} },
  };
};

class OptionEjpCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("option-ejp-card-editor");
  }

  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    this._config = { ...EJP_DEFAULTS, ...(config || {}) };
    this._sig = null;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    if (!this._clicks) this.shadowRoot.addEventListener("click", (this._clicks = (ev) => {
      const el = ev.target.closest?.("[data-entity]");
      if (!el || !el.dataset.entity) return;
      const e = new Event("hass-more-info", { bubbles: true, composed: true });
      e.detail = { entityId: el.dataset.entity };
      this.dispatchEvent(e);
    }));
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  connectedCallback() {
    // Relecture chaque minute : passage de la Pointe Mobile à 7 h et à 1 h, relecture du calendrier EDF
    clearInterval(this._timer);
    this._timer = setInterval(() => { this._sig = null; this._render(); }, 60 * 1000);
    EDF.listeners.add((this._onEdf = this._onEdf || (() => { this._sig = null; this._render(); })));
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    EDF.listeners.delete(this._onEdf);
  }

  /** Source des jours EJP : calendrier EDF lu par la carte, ou capteurs EJP existants. */
  _useEdf() {
    const c = this._config;
    if (c.source === "edf") return true;
    if (c.source === "entities") return false;
    return !!this._hass && !this._hass.states?.[c.today];
  }

  /** Zone : texte (Nord, Ouest…) ou entité (input_select, sensor). */
  _zone() {
    const z = String(this._config.zone || "");
    return /^[a-z_]+\.[\w]+$/.test(z) ? this._st(z)?.state || "" : z;
  }

  getCardSize() {
    return 6;
  }

  _st(id) {
    return id ? this._hass?.states?.[id] : undefined;
  }

  _render() {
    if (!this._config || !this.shadowRoot) return;
    const c = this._config;
    const hass = this._hass;
    const edf = this._useEdf();
    const ids = edf ? [c.zone] : [c.today, c.tomorrow, c.remaining, c.peak, c.zone];
    const now = new Date();
    const sig = [c.theme, hass?.themes?.darkMode, !!hass, now.getHours(), dayKey(now), edf, EDF.at, EDF.error, ...ids.map((id) => {
      const s = this._st(id);
      return s ? `${s.state}|${s.last_updated}` : "-";
    })].join("§");
    if (sig === this._sig) return;
    this._sig = sig;

    // En mode EDF, les tuiles n'ouvrent aucune entité
    this._ids = edf ? {} : c;
    if (edf) loadEdf();
    const st = edf && EDF.data ? edfStates(EDF.data, now) : null;
    const today = edf ? st?.today : this._st(c.today);
    const tomorrow = edf ? st?.tomorrow : this._st(c.tomorrow);
    const remaining = edf ? st?.remaining : this._st(c.remaining);
    const peak = edf ? st?.peak : this._st(c.peak);
    const zone = this._zone() || remaining?.attributes?.zone || today?.attributes?.zone || "";
    const season = seasonOf(now, remaining?.attributes?.saison_debut);
    const seasonLabel = `saison ${season.start.getFullYear()}-${season.start.getFullYear() + 1}${{ upcoming: " (à venir)", ended: " (terminée)" }[season.state] || ""}`;

    const header = `<header>
        <div class="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true"><path class="house" d="M4 14.5 16 4l12 10.5V27a1.5 1.5 0 0 1-1.5 1.5h-5M10.5 28.5h-5A1.5 1.5 0 0 1 4 27V14.5"/><path class="bolt ejp-bolt" d="M17.6 11.5 12 19.2h3.6l-1.4 6.3 5.8-8h-3.7l1.3-6Z"/></svg>
          <div><div class="title">${esc(c.title)}</div><div class="sub">${zone ? `Zone ${esc(zone)} · ` : ""}${seasonLabel}</div></div>
        </div>
        ${this._periodPill(today, peak, now)}
      </header>`;
    const card = (body) => {
      this.shadowRoot.innerHTML = `${STYLE}${EJP_STYLE}<ha-card class="${themeClass(c.theme, hass)}">${header}${body}</ha-card>`;
    };

    if (edf && !EDF.data) {
      card(EDF.error
        ? `<div class="empty">Impossible de lire le calendrier EDF<span>${esc(EDF.error)}. Nouvel essai dans quelques minutes.</span></div>`
        : `<div class="empty"><span>Lecture du calendrier EDF…</span></div>`);
      return;
    }
    if (!edf && hass && !today && !tomorrow && !remaining) {
      card(`<div class="empty">Capteurs EJP introuvables<span>Choisissez vos capteurs dans l'éditeur de la carte, ou la source « Calendrier EDF ».</span></div>`);
      return;
    }

    const days = `<div class="ejp-days">
        ${this._dayTile("Aujourd'hui", today, now, this._ids.today)}
        ${this._dayTile("Demain", tomorrow, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), this._ids.tomorrow)}
      </div>`;

    card(`${days}${this._quota(remaining, season)}${c.show_prices !== false ? this._prices(today, peak, now) : ""}${c.show_calendar !== false ? this._calendar(remaining, season, now, today, tomorrow) : ""}
      ${!season.inSeason ? `<footer>${season.state === "upcoming" ? "La saison commence le 1er novembre. " : ""}Les jours EJP sont fixés du 1er novembre au 31 mars, de 7 h à 1 h le lendemain.</footer>` : `<footer>Jours EJP de 7 h à 1 h le lendemain, annoncés la veille par EDF.</footer>`}
      ${edf && EDF.error ? `<footer>Dernière lecture EDF en erreur (${esc(EDF.error)}) : données du ${new Date(EDF.at).toLocaleString("fr-FR")} au plus tard.</footer>` : ""}`);
  }

  /** Pointe Mobile en cours : capteur de pointe, sinon jour EJP de 7 h à 1 h (le jour EJP d'hier compte jusqu'à 1 h). */
  _inPeak(today, peak, now) {
    if (peak) return peak.state === "on";
    const h = now.getHours();
    return dayType(today?.state) === "ejp" && h >= 7;
  }

  _periodPill(today, peak, now) {
    if (!today && !peak) return "";
    const on = this._inPeak(today, peak, now);
    return `<div class="pill ejp-pill ${on ? "is-pm" : "is-hn"}" data-entity="${esc(this._ids.peak && peak ? this._ids.peak : this._ids.today || "")}">
        <i class="dot"></i><span class="pill-v">${on ? "Pointe Mobile" : "Heures normales"}</span>
      </div>`;
  }

  _dayTile(label, st, date, id) {
    const t = st ? dayType(st.state) : "unknown";
    const txt = t === "ejp" ? "Jour EJP" : t === "normal" ? "Jour normal" : label === "Demain" ? "Pas encore publié" : "Inconnu";
    const note = t === "ejp" ? "Pointe Mobile de 7 h à 1 h" : st?.attributes?.hors_periode ? "Hors période EJP" : t === "normal" ? "Heures normales toute la journée" : st ? "EDF publie le jour EJP la veille" : "Capteur introuvable";
    const w = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    const when = w.charAt(0).toUpperCase() + w.slice(1);
    return `<div class="ejp-day d-${t}" data-entity="${esc(st && id ? id : "")}">
        <div class="ejp-day-l">${label}<span>${when}</span></div>
        <div class="ejp-day-v"><i class="dot"></i>${txt}</div>
        <div class="ejp-day-n">${note}</div>
      </div>`;
  }

  _quota(remaining, season) {
    const c = this._config;
    const total = Number(remaining?.attributes?.total) || Number(c.total_days) || 22;
    const left = remaining ? Number(remaining.state) : NaN;
    if (!Number.isFinite(left)) {
      return remaining
        ? `<div class="power ejp-quota"><div class="power-t"><span>Jours EJP restants</span><b>—</b></div><div class="power-n">Calendrier EDF pas encore lu</div></div>`
        : "";
    }
    const used = Number(remaining.attributes?.utilises ?? total - left);
    const pct = Math.min(100, Math.max(0, (used / total) * 100));
    return `<div class="power ejp-quota" data-entity="${esc(this._ids.remaining || "")}">
        <div class="power-t"><span>Jours EJP restants</span><b>${left} <small>/ ${total}</small></b></div>
        <div class="gauge"><i style="width:${pct.toFixed(1)}%"></i></div>
        <div class="power-n">${season.state === "upcoming" ? "Saison pas encore commencée" : `${used} jour${used > 1 ? "s" : ""} EJP ${season.inSeason ? "depuis le 1er novembre" : "sur la saison terminée"}`}</div>
      </div>`;
  }

  _prices(today, peak, now) {
    const c = this._config;
    const on = this._inPeak(today, peak, now);
    const hn = Number(c.price_hn);
    const pm = Number(c.price_pm);
    const ratio = hn > 0 && pm > 0 ? pm / hn : null;
    return `<div class="tiles ejp-prices">
        <div class="tile${on ? "" : " on"}"><div class="tile-l"><i class="sw hn"></i>Heures normales</div><div class="tile-v">${fmt(hn, 2)}<span>c€/kWh</span></div><div class="tile-n">${on ? "Hors pointe" : "Prix en cours"}</div></div>
        <div class="tile${on ? " on pm" : ""}"><div class="tile-l"><i class="sw pm"></i>Pointe Mobile</div><div class="tile-v">${fmt(pm, 2)}<span>c€/kWh</span></div><div class="tile-n">${on ? "Prix en cours" : ratio ? `${fmt(ratio, 1)} × le prix normal` : "Jours EJP, 7 h → 1 h"}</div></div>
      </div>`;
  }

  /** Calendrier de la saison : un carré par jour, de novembre à mars. */
  _calendar(remaining, season, now, today, tomorrow) {
    const list = Array.isArray(remaining?.attributes?.jours) ? remaining.attributes.jours.map(String) : [];
    const ejp = new Set(list.map((s) => s.slice(0, 10)));
    const tKey = dayKey(now);
    const tmw = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (dayType(today?.state) === "ejp") ejp.add(tKey);
    if (dayType(tomorrow?.state) === "ejp") ejp.add(dayKey(tmw));
    if (!remaining && !ejp.size) return "";
    const y0 = season.start.getFullYear();
    const rows = SEASON_MONTHS.map((m) => {
      const year = m >= 10 ? y0 : y0 + 1;
      const n = new Date(year, m + 1, 0).getDate();
      let cells = "";
      let count = 0;
      for (let d = 1; d <= n; d++) {
        const date = new Date(year, m, d);
        const k = dayKey(date);
        const isEjp = ejp.has(k);
        if (isEjp) count++;
        const cls = [isEjp ? "e" : "", k === tKey ? "t" : "", date > tmw ? "f" : "", [0, 6].includes(date.getDay()) ? "we" : ""].filter(Boolean).join(" ");
        const name = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
        cells += `<i class="${cls}" title="${name}${isEjp ? " : jour EJP" : ""}"></i>`;
      }
      return `<div class="ejp-m"><span class="ejp-m-l">${MONTHS[m]}</span><div class="ejp-m-d">${cells}</div><b class="ejp-m-n${count ? "" : " z"}">${count}</b></div>`;
    }).join("");
    return `<div class="chart ejp-cal">
        <div class="chart-h"><span>Jours EJP de la saison ${y0}-${y0 + 1}</span><span class="sol-leg"><span><i class="e"></i>EJP</span><span><i class="t"></i>Aujourd'hui</span></span></div>
        ${rows}
      </div>`;
  }
}

const EJP_STYLE = `<style>
ha-card { display: block; --ejp-red: #ee4a4a; --ejp-ok: #5fcf8a; --ejp-hn: var(--med-blue); }
ha-card.light { --ejp-ok: #1d8a4b; --ejp-red: #d63333; }
.brand .ejp-bolt { fill: var(--ejp-red); }
.ejp-pill.is-pm { border-color: var(--ejp-red); } .ejp-pill.is-pm .dot { background: var(--ejp-red); }
.ejp-pill.is-hn .dot { background: var(--ejp-ok); }
.ejp-pill, .ejp-day[data-entity]:not([data-entity=""]), .ejp-quota { cursor: pointer; }
.ejp-days { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin: 4px 12px 0; }
@container (max-width: 360px) { .ejp-days { grid-template-columns: 1fr; } }
.ejp-day { padding: 12px 14px; border-radius: 14px; background: var(--med-surface); border: 1px solid var(--med-line); display: flex; flex-direction: column; gap: 4px; }
.ejp-day-l { font-size: .8rem; color: var(--med-muted); display: flex; flex-direction: column; }
.ejp-day-l span { font-size: .72rem; }
.ejp-day-v { display: flex; align-items: center; gap: 8px; font-size: 1.25rem; font-weight: 700; }
.ejp-day-v .dot { width: 12px; height: 12px; }
.ejp-day-n { font-size: .72rem; color: var(--med-muted); }
.ejp-day.d-ejp { border-color: var(--ejp-red); background: color-mix(in srgb, var(--ejp-red) 14%, var(--med-surface)); }
.ejp-day.d-ejp .dot { background: var(--ejp-red); }
.ejp-day.d-ejp .ejp-day-v { color: var(--ejp-red); }
.ejp-day.d-normal .dot { background: var(--ejp-ok); }
.ejp-day.d-unknown .ejp-day-v { color: var(--med-muted); font-weight: 500; font-size: 1.05rem; }
.ejp-quota .gauge i { background: var(--ejp-red); }
.ejp-quota b small { color: var(--med-muted); font-weight: 400; }
.ejp-prices { grid-template-columns: repeat(2, 1fr) !important; }
.ejp-prices .tile-l { display: flex; align-items: center; gap: 6px; }
.ejp-prices .tile.on { background: var(--med-surface); border-color: var(--ejp-hn); }
.ejp-prices .tile.on.pm { border-color: var(--ejp-red); }
.sw { width: 9px; height: 9px; border-radius: 3px; display: inline-block; flex: none; }
.sw.hn { background: var(--ejp-hn); } .sw.pm { background: var(--ejp-red); }
.sol-leg { display: flex; gap: 10px; }
.sol-leg span { display: inline-flex; align-items: center; gap: 5px; }
.sol-leg i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; background: var(--med-line); }
.sol-leg i.e { background: var(--ejp-red); }
.sol-leg i.t { background: transparent; box-shadow: inset 0 0 0 1.5px var(--med-text); }
.ejp-m { display: grid; grid-template-columns: 44px 1fr 22px; align-items: center; gap: 8px; margin: 3px 4px; }
.ejp-m-l { font-size: .74rem; color: var(--med-muted); text-transform: capitalize; }
.ejp-m-d { display: grid; grid-template-columns: repeat(31, 1fr); gap: 2px; }
.ejp-m-d i { aspect-ratio: 1; border-radius: 2px; background: var(--med-line); }
.ejp-m-d i.we { opacity: .7; }
.ejp-m-d i.f { opacity: .35; }
.ejp-m-d i.e { background: var(--ejp-red); opacity: 1; }
.ejp-m-d i.t { box-shadow: 0 0 0 1.5px var(--med-text); opacity: 1; }
.ejp-m-n { font-size: .78rem; text-align: right; color: var(--ejp-red); }
.ejp-m-n.z { color: var(--med-muted); font-weight: 400; }
</style>`;

/* ------------------------------------------------------------------ style */

const STYLE = `<style>
:host {
  --med-bg: #1a2434; --med-surface: #212d40; --med-line: #2f3d55;
  --med-text: #e7edf5; --med-muted: #8fa0b8;
  --med-green: #96d21f; --med-blue: #1d93e3;
  --med-hc: #4a7bd8; --med-hp: #d27333;
  --t-blue: #3f7ff0; --t-white: #e9eef4; --t-red: #ee4a4a;
  --med-up: #f08a4b; --med-down: #5fcf8a;
}
ha-card { background: var(--med-bg); color: var(--med-text); border: 1px solid var(--med-line);
  border-radius: 18px; overflow: hidden; font-variant-numeric: tabular-nums; container-type: inline-size; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px 8px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 10px; }
.brand svg { width: 34px; height: 34px; fill: none; }
.brand .house { stroke: var(--med-green); stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round; }
.brand .bolt { fill: var(--med-blue); }
.title { font-size: 1.15rem; font-weight: 700; letter-spacing: .2px; }
.sub { font-size: .78rem; color: var(--med-muted); }
.tempo { display: flex; gap: 8px; }
.pill { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px;
  background: var(--med-surface); border: 1px solid var(--med-line); font-size: .78rem; }
.pill-l { color: var(--med-muted); }
.pill-v { font-weight: 600; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: var(--med-muted); flex: none; }
.t-blue .dot { background: var(--t-blue); } .t-white .dot { background: var(--t-white); } .t-red .dot { background: var(--t-red); }
.t-none .pill-v { color: var(--med-muted); font-weight: 400; }
.quotas { display: flex; align-items: center; gap: 14px; padding: 0 18px 10px; font-size: .82rem; }
.quota { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; }
.quota small { color: var(--med-muted); font-weight: 400; }
.quota-l { color: var(--med-muted); }

.hero { margin: 4px 12px 0; padding: 16px; border-radius: 14px; background: var(--med-surface);
  border: 1px solid var(--med-line); display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; }
.hero-l { color: var(--med-muted); font-size: .85rem; }
.hero-v { font-size: 2.4rem; font-weight: 700; line-height: 1.1; }
.hero-v span, .tile-v span { font-size: .9rem; font-weight: 500; color: var(--med-muted); margin-left: 4px; }
.hero-r { text-align: right; align-self: center; }
.cost { font-size: 1.6rem; font-weight: 700; color: var(--med-green); }
.cost.none { color: var(--med-muted); }
.cost.est { color: var(--med-text); opacity: .85; }
.hero-p { font-size: .75rem; color: var(--med-muted); margin-top: 6px; }
.cost-l { font-size: .75rem; color: var(--med-muted); max-width: 160px; }
.evo { font-size: .8rem; font-weight: 600; margin-top: 2px; }
.evo.up { color: var(--med-up); } .evo.down { color: var(--med-down); }
.split { grid-column: 1 / -1; margin-top: 6px; }
.split.wait { font-size: .8rem; color: var(--med-muted); border-top: 1px dashed var(--med-line); padding-top: 8px; }
.bar { display: flex; height: 8px; border-radius: 6px; overflow: hidden; background: var(--med-line); }
.bar i { display: block; } .bar .hc { background: var(--med-hc); } .bar .hp { background: var(--med-hp); }
.split-l { display: flex; justify-content: space-between; font-size: .78rem; margin-top: 6px; }
.k-hc { color: #8fb0f0; } .k-hp { color: #eaa070; }

.tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin: 10px 12px 0; }
@container (min-width: 620px) { .tiles { grid-template-columns: repeat(4, 1fr); } }
@container (min-width: 620px) { .tiles.six { grid-template-columns: repeat(3, 1fr); } }
.tile { padding: 12px; border-radius: 12px; border: 1px solid var(--med-line); }
.tile-l { font-size: .78rem; color: var(--med-muted); }
.tile-v { font-size: 1.35rem; font-weight: 700; margin-top: 2px; }
.tile-n { font-size: .72rem; color: var(--med-muted); margin-top: 4px; }

.chart { margin: 14px 12px 0; }
.chart-h { display: flex; justify-content: space-between; font-size: .82rem; color: var(--med-muted); margin: 0 4px 6px; }
.legend { display: flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; margin-left: 6px; }
.legend .k-hc { background: var(--med-hc); } .legend .k-hp { background: var(--med-hp); }
.chart svg { width: 100%; height: 130px; display: block; }
.chart rect.hc { fill: var(--med-hc); } .chart rect.hp { fill: var(--med-hp); }
.chart rect.partial { fill: var(--med-muted); opacity: .35; }
.chart g.est { opacity: .45; }
.chart rect.sel { fill: rgba(255,255,255,.06); }
.chart rect.hit { fill: transparent; cursor: pointer; }
.days { display: grid; margin-top: 4px; }
.day { all: unset; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 1px;
  padding: 4px 0; border-radius: 8px; font-size: .68rem; color: var(--med-muted); text-transform: capitalize; }
.day b { color: var(--med-text); font-size: .78rem; }
.day .dot { width: 6px; height: 6px; margin-top: 2px; }
.day.on { background: var(--med-surface); }
.day:focus-visible { outline: 2px solid var(--med-blue); }

.detail { margin: 8px 12px 0; padding: 10px 12px; border-radius: 12px; background: var(--med-surface); border: 1px solid var(--med-line); }
.detail-h { display: flex; align-items: center; gap: 8px; font-size: .8rem; color: var(--med-muted); }
.tag { padding: 1px 8px; border-radius: 999px; font-size: .72rem; font-weight: 700; color: #0f1724; }
.tag.t-blue { background: var(--t-blue); color: #fff; } .tag.t-white { background: var(--t-white); } .tag.t-red { background: var(--t-red); color: #fff; }
.detail-v { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 4px; font-size: .9rem; }
.sep { width: 1px; height: 12px; background: var(--med-line); }
.detail-p { font-size: .78rem; color: var(--med-muted); margin-top: 4px; }
.warn { color: var(--t-red); font-style: normal; font-weight: 600; }

.power { margin: 10px 12px 0; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--med-line); }
.power.is-over { border-color: var(--t-red); }
.power-t { display: flex; justify-content: space-between; font-size: .85rem; }
.gauge { height: 6px; border-radius: 6px; background: var(--med-line); margin: 8px 0 6px; overflow: hidden; }
.gauge i { display: block; height: 100%; background: linear-gradient(90deg, var(--med-green), var(--med-blue)); }
.is-over .gauge i { background: var(--t-red); }
.power-n { font-size: .75rem; color: var(--med-muted); }

.eco { margin: 10px 12px 0; padding: 8px 12px; border-radius: 12px; border: 1px solid var(--med-line); font-size: .82rem; display: flex; align-items: center; gap: 8px; }
.eco.e-ok .dot { background: var(--med-down); }
.eco.e-warn { border-color: #f0a33a; } .eco.e-warn .dot { background: #f0a33a; }
.eco.e-alert { border-color: var(--t-red); } .eco.e-alert .dot { background: var(--t-red); }
.eco-l { color: var(--med-muted); }
footer { padding: 10px 18px 14px; font-size: .7rem; color: var(--med-muted); }
.empty { padding: 18px; display: flex; flex-direction: column; gap: 6px; font-size: .9rem; }
.empty span { color: var(--med-muted); }
/* Thème Home Assistant : fond, textes et bordures suivent le thème clair ou sombre */
ha-card.th-ha {
  --med-bg: var(--ha-card-background, var(--card-background-color, #fff));
  --med-surface: color-mix(in srgb, var(--primary-text-color, #000) 5%, transparent);
  --med-line: var(--divider-color, rgba(127, 127, 127, .25));
  --med-text: var(--primary-text-color, #1f2937);
  --med-muted: var(--secondary-text-color, #6b7280);
  border-radius: var(--ha-card-border-radius, 12px);
  border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
}
ha-card.th-ha.light { --med-green: #4c8a0b; --med-up: #c2560f; --med-down: #1d8a4b; }
/* Style MyElectricalData en version claire (theme: auto quand Home Assistant est en mode clair) */
ha-card.th-v2.light {
  --med-bg: #ffffff; --med-surface: #f2f5f9; --med-line: #dbe2ec;
  --med-text: #1a2434; --med-muted: #5b6b82;
  --med-green: #4c8a0b; --med-blue: #1673b8; --med-up: #c2560f; --med-down: #1d8a4b;
  box-shadow: 0 1px 3px rgba(26, 36, 52, .08);
}
ha-card.light .k-hc { color: #2f5fb8; }
ha-card.light .k-hp { color: #b35619; }
ha-card.light .t-white .dot, ha-card.light .tag.t-white { box-shadow: inset 0 0 0 1px #aab3c0; }
ha-card.light .chart rect.sel { fill: rgba(0, 0, 0, .05); }
ha-card.light .tag.t-white { color: #1f2937; }
@media (max-width: 420px) { .hero-v { font-size: 2rem; } .tempo { width: 100%; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>`;

/* ----------------------------------------------------------------- éditeur */

const THEME_SELECT = {
  name: "theme",
  selector: {
    select: {
      mode: "dropdown",
      options: [
        { value: "v2", label: "Style MyElectricalData (bleu nuit)" },
        { value: "auto", label: "Style MyElectricalData, clair ou sombre selon Home Assistant" },
        { value: "ha", label: "Thème Home Assistant (clair ou sombre)" },
      ],
    },
  },
};

/** Éditeur visuel : formulaire Home Assistant construit à partir du schéma. */
function makeEditor(schema, labels, defaults) {
  const hasDays = schema.some((s) => s.name === "days");
  return class extends HTMLElement {
    setConfig(config) {
      this._config = { ...config };
      this._draw();
    }

    set hass(hass) {
      this._hass = hass;
      if (this._form) this._form.hass = hass;
      else this._draw();
    }

    _draw() {
      if (!this._hass || !this._config) return;
      if (!this._form) {
        this._form = document.createElement("ha-form");
        this._form.computeLabel = (s) => labels[s.name] || s.name;
        this._form.addEventListener("value-changed", (ev) => {
          const v = { ...ev.detail.value };
          if (hasDays && v.days !== undefined) v.days = Number(v.days);
          this._config = v;
          this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: v }, bubbles: true, composed: true }));
        });
        this.appendChild(this._form);
      }
      this._form.hass = this._hass;
      this._form.schema = schema;
      this._form.data = hasDays
        ? { ...defaults, ...this._config, days: String(this._config.days || defaults.days) }
        : { ...defaults, ...this._config };
    }
  };
}

const EJP_SCHEMA = [
  { name: "title", selector: { text: {} } },
  {
    name: "source",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "auto", label: "Automatique (capteurs EJP s'ils existent, sinon calendrier EDF)" },
          { value: "edf", label: "Calendrier EDF, lu par la carte" },
          { value: "entities", label: "Mes capteurs EJP" },
        ],
      },
    },
  },
  { name: "today", selector: { entity: {} } },
  { name: "tomorrow", selector: { entity: {} } },
  { name: "remaining", selector: { entity: { domain: "sensor" } } },
  { name: "peak", selector: { entity: { domain: "binary_sensor" } } },
  { name: "price_hn", selector: { number: { min: 0, max: 200, step: 0.01, mode: "box", unit_of_measurement: "c€/kWh" } } },
  { name: "price_pm", selector: { number: { min: 0, max: 200, step: 0.01, mode: "box", unit_of_measurement: "c€/kWh" } } },
  { name: "show_prices", selector: { boolean: {} } },
  { name: "show_calendar", selector: { boolean: {} } },
  THEME_SELECT,
];
const EJP_LABELS = {
  title: "Titre",
  today: "Capteur jour EJP aujourd'hui (EJP / Normal), source « Mes capteurs »",
  tomorrow: "Jour EJP demain (EJP / Normal)",
  remaining: "Jours EJP restants sur la saison",
  peak: "Pointe Mobile en cours (facultatif)",
  source: "Source des jours EJP",
  price_hn: "Prix du kWh, Heures normales, TTC",
  price_pm: "Prix du kWh, Pointe Mobile, TTC",
  show_prices: "Afficher les prix",
  show_calendar: "Afficher le calendrier de la saison",
  theme: "Couleurs de la carte",
};
const OptionEjpCardEditor = makeEditor(EJP_SCHEMA, EJP_LABELS, EJP_DEFAULTS);

/* ---------------------------------------------------------- enregistrement */

if (typeof customElements !== "undefined") {
  const define = (name, cls) => { if (!customElements.get(name)) customElements.define(name, cls); };
  define("option-ejp-card", OptionEjpCard);
  define("option-ejp-card-editor", OptionEjpCardEditor);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === "option-ejp-card")) {
    window.customCards.push({
      type: "option-ejp-card",
      name: "Carte Option EJP",
      description: "Jours EJP d'EDF : aujourd'hui, demain, Pointe Mobile, jours restants et calendrier de la saison.",
      preview: true,
    });
  }
  console.info(`%c OPTION-EJP-CARD %c ${CARD_VERSION} `, "background:#ee4a4a;color:#fff;font-weight:700", "background:#1d93e3;color:#fff");
}
})();
