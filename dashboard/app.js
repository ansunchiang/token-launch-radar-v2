(function launch() {
  'use strict';

  const main = document.querySelector('#main');
  const model = globalThis.LaunchLedger;
  const input = globalThis.RADAR_INPUT;
  if (!model || !input) {
    main.removeAttribute('aria-busy');
    main.textContent = 'Run main.ts and open the dashboard in its output directory.';
    return;
  }

  const { snapshot, board } = input;
  const { accounting, fit, ranked, rows } = model.buildRadar(snapshot);
  const bySlug = new Map(ranked.map((entry) => [entry.p.slug, entry]));
  const freshFilters = () => ({ query: '', category: '', chain: '', tier: '', verdict: '' });
  const state = { filters: freshFilters(), sort: 'rank', direction: 1, settings: { ...model.DEFAULTS }, boardRoute: 'board', scroll: 0 };
  const groups = {
    watchlist: ['Watchlist', 'Ranked · house list'],
    early: ['Early', 'Ranked · below $' + snapshot.floor_usd / 1e6 + 'M'],
    offlist: ['Off-list', 'Ranked · above floor'],
    comp: ['Token trades', 'Independent cap used in fit'],
    unpriced: ['Token recorded', 'No usable independent cap'],
    out: ['Excluded', 'Bridge, derivative, exchange or version'],
  };
  const integer = new Intl.NumberFormat('en-US').format;
  const dollars = (x) => '$' + integer(x);
  const cash = (x) => (x < 0 ? '−' : '') + '$' + Math.abs(x).toFixed(2);
  const signedCash = (x) => (x > 0 ? '+' : '') + cash(x);
  const compact = (x) => {
    if (x >= 1e9) return '$' + Number((x / 1e9).toFixed(2)) + 'B';
    if (x >= 1e6) return '$' + Number((x / 1e6).toFixed(2)) + 'M';
    if (x >= 1e3) return '$' + Number((x / 1e3).toFixed(1)) + 'K';
    return dollars(x);
  };
  const pct = (x, digits = 0) => (100 * x).toFixed(digits) + '%';
  const growthText = (n) => n === null ? 'Unreported' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  const fixed = (x, digits) => x === null ? '—' : x.toFixed(digits);
  const cat = (p) => p.category || 'Unclassified';
  const compareText = (a, b) => a.localeCompare(b, 'en');
  const unique = (xs) => [...new Set(xs)].sort(compareText);
  const escape = (s) => String(s).replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
  ));
  const interval = (range) => range.map(compact).join(' – ');
  const detailURL = (slug) => '#protocol/' + encodeURIComponent(slug);
  const badge = (verdict) => '<span class="verdict ' + verdict.toLowerCase() + '">' + verdict + '</span>';
  const options = (values, selected) => values.map(([value, title = value]) =>
    '<option value="' + escape(value) + '"' + (value === selected ? ' selected' : '') + '>' + escape(title) + '</option>').join('');
  const categories = unique(ranked.map(({ p }) => cat(p)));
  const chains = unique(ranked.flatMap(({ p }) => p.chains));

  function table(headers, body) {
    return '<table><thead><tr>' + headers.map((label) => '<th scope="col">' + label + '</th>').join('')
      + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  const cell = (value, cls = 'num') => (cls ? '<td class="' + cls + '">' : '<td>') + value + '</td>';
  const rowHead = (value, note) => '<th scope="row">' + value + (note ? '<small>' + note + '</small>' : '') + '</th>';

  function integrity(source) {
    const recomputed = new Map(rows.map((r) => [r.slug, r]));
    const matches = source.filter((r, index) => rows[index]?.slug === r.slug
      && JSON.stringify(recomputed.get(r.slug)) === JSON.stringify(r)).length;
    const ranks = source.length > 1 && source.every((r, i) => r.rank === i + 1
      && Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0
      && (!i || r.implied_value_usd <= source[i - 1].implied_value_usd))
      && source[0]?.implied_value_usd !== source.at(-1)?.implied_value_usd;
    const watch = snapshot.watchlist.filter((slug) => {
      const entry = bySlug.get(slug);
      return entry?.group === 'watchlist' && !model.tokenRecorded(entry.p)
        && source.some((r) => r.slug === slug);
    }).length;
    const all = Object.values(accounting.groups).flat();
    const counted = new Set(all.map((p) => p.slug));
    const accounted = snapshot.protocols.filter((p) => counted.has(p.slug)).length;
    return [
      [matches === rows.length && source.length === rows.length, matches + '/' + rows.length + ' recomputed = board.json'],
      [ranks, ranks ? 'Ranks 1–' + source.length + ' · values never rise' : 'Rank or value order failed'],
      [watch === snapshot.watchlist.length, watch + '/' + snapshot.watchlist.length + ' watchlist covered'],
      [accounted === all.length && all.length === counted.size && all.length === snapshot.protocols.length,
        accounted + '/' + snapshot.protocols.length + ' protocols accounted for'],
    ];
  }

  function integrityStrip() {
    return '<section class="integrity" aria-label="Browser integrity checks">' + integrity(board.rows).map(([ok, label]) =>
      '<div class="' + (ok ? 'passed' : 'failed') + '"><span class="check" aria-label="' + (ok ? 'Passed' : 'Failed') + '">'
      + (ok ? '✓' : '!') + '</span><strong>' + escape(label) + '</strong></div>').join('') + '</section>';
  }

  function head(eyebrow, title, sub) {
    return '<div class="section-head"><div><p class="eyebrow">' + eyebrow + '</p><h2>' + title
      + '</h2></div>' + (sub ? '<p class="section-meta">' + sub + '</p>' : '') + '</div>';
  }

  function profile() {
    const count = Math.min(36, ranked.length);
    const ceiling = ranked[0].value.value;
    return '<figure class="profile"><figcaption><span>Ranked value profile</span><span>Top ' + count
      + '</span></figcaption><div class="profile-bars" aria-hidden="true">'
      + ranked.slice(0, count).map(({ value, group }) => '<i class="' + group + '" style="--level:'
        + pct(value.value / ceiling, 2) + '"></i>').join('')
      + '</div></figure>';
  }

  function kpi(label, metric, note) {
    return '<div class="kpi"><span>' + label + '</span><strong>' + metric + '</strong><small>' + note + '</small></div>';
  }

  function evidenceRows(evidence, digits) {
    return evidence.map((item) => '<tr><th scope="row">' + item.label + '</th><td>' + fixed(item.miss, digits)
      + '</td><td>' + fixed(item.forward, digits) + '</td><td><span class="decision ' + item.status.toLowerCase() + '">'
      + item.status + '</span></td></tr>').join('');
  }

  function evidencePanel() {
    const base = fit.evidence[0].miss;
    const improvement = pct((base - fit.priceMiss.miss) / base, 1);
    return '<section class="panel evidence">'
      + head('Model evidence', 'What held up', improvement + ' lower LOO price error')
      + '<table class="evidence-table"><thead><tr><th scope="col">Tested term</th><th scope="col" title="Leave one out">LOO</th>'
      + '<th>Walk-forward</th><th>Decision</th></tr></thead><tbody>'
      + '<tr class="table-kicker"><th colspan="4">CAP FIT · MEAN ABS. LOG ERROR · ' + fit.priced.length + ' LOO / ' + fit.forwardN + ' FORWARD</th></tr>'
      + evidenceRows(fit.evidence, 3) + '<tr class="table-kicker"><th colspan="4">TOKEN RECORD · BRIER · '
      + fit.odds.rows.length + ' LOO / ' + fit.oddsForwardN + ' FORWARD</th></tr>'
      + evidenceRows(fit.oddsEvidence, 4) + '</tbody></table>'
      + '<details class="method"><summary>Validation notes</summary><p>LOO holds out one family or record. Forward uses three expanding listing cohorts from this snapshot. Missing dates enter LOO and final fits. Terms must lower both errors.</p>'
      + '<p>Ridge cap fit screens $100k–$25B and 0.001–500× TVL. One cap per ID or ticker family, largest TVL first. Odds blend 24 weighted peers with prior weight 4.</p></details></section>';
  }

  function accountingPanel() {
    const entries = model.GROUPS.map((key) => [key, accounting.groups[key].length]);
    const total = snapshot.protocols.length;
    return '<section class="panel accounting">'
      + head('Snapshot accounting', 'Where every protocol went', integer(total) + ' records')
      + '<div class="segments" role="img" aria-label="' + entries.map(([k, n]) => n + ' ' + groups[k][0]).join(', ') + '">'
      + entries.map(([key, count]) => '<span class="' + key + '" style="--share:' + pct(count / total, 4) + '"></span>').join('')
      + '</div><ul class="group-list">' + entries.map(([key, count]) => '<li><span class="group-dot ' + key + '"></span>'
        + '<div><strong>' + groups[key][0] + '</strong><small>' + groups[key][1] + '</small></div>'
        + '<b>' + integer(count) + '</b></li>').join('') + '</ul>'
      + '<p class="footnote">Parent IDs are absent. Off-list family status is unverified.</p></section>';
  }

  const columns = [
    ['rank', 'Rank', (e) => e.rank],
    ['name', 'Protocol', (e) => e.p.name],
    ['category', 'Category', (e) => cat(e.p)],
    ['tier', 'Tier', (e) => groups[e.group][0]],
    ['tvl', 'TVL', (e) => e.p.tvl_usd],
    ['growth', '7d TVL', (e) => e.p.change_7d],
    ['age', 'Age', (e) => e.value.r.age],
    ['odds', 'Odds', (e) => e.value.odds.chance],
    ['value', 'Implied', (e) => e.value.value],
    ['band', 'P25–P75', (e) => e.value.interval[0]],
    ['verdict', 'Verdict', (e) => e.base.verdict],
    ['net', 'Net vs bill', (e) => e.base.net],
  ];
  const numberCols = new Set(['rank', 'tvl', 'growth', 'age', 'odds', 'value', 'band', 'net']);

  function searchControls() {
    const { query, category, chain, tier, verdict } = state.filters;
    const select = (name, title, list, value) => '<label>' + title + '<select name="' + name + '">'
      + options([['', 'Any ' + name], ...list], value) + '</select></label>';
    return '<form id="filters" class="filters" role="search" aria-label="Filter protocols">'
      + '<label class="query">Search<input name="query" type="search" placeholder="Protocol or chain" value="' + escape(query) + '"></label>'
      + select('category', 'Category', categories.map((name) => [name]), category)
      + select('chain', 'Chain', chains.map((name) => [name]), chain)
      + select('tier', 'Tier', model.GROUPS.slice(0, 3).map((key) => [key, groups[key][0]]), tier)
      + select('verdict', 'Verdict', [['FARM'], ['MARGINAL'], ['SKIP']], verdict)
      + '<button type="reset" class="button">Reset</button></form>';
  }

  function rankTable() {
    const { filters: f } = state;
    const q = f.query.trim().toLowerCase();
    const found = ranked.filter(({ p, group, base }) =>
      (!q || [p.name, p.slug, cat(p), ...p.chains].some((part) => part.toLowerCase().includes(q)))
      && (!f.category || f.category === cat(p)) && (!f.chain || p.chains.includes(f.chain))
      && (!f.tier || f.tier === group) && (!f.verdict || f.verdict === base.verdict));
    const column = columns.find(([key]) => key === state.sort);
    found.sort((a, b) => {
      const x = column[2](a), y = column[2](b);
      if (x === null || y === null) return Number(x === null) - Number(y === null) || a.rank - b.rank;
      return state.direction * (typeof x === 'number' ? x - y : compareText(x, y)) || a.rank - b.rank;
    });
    document.querySelector('#row-count').textContent = found.length + ' of ' + ranked.length + ' rows';
    document.querySelector('#filter-summary').innerHTML = [
      f.query && 'Search: ' + f.query, f.category, f.chain, f.tier && groups[f.tier][0], f.verdict,
    ].filter(Boolean).map((value) => '<span>' + escape(value) + '</span>').join('');
    for (const th of document.querySelectorAll('th[data-column]')) {
      const active = th.dataset.column === state.sort;
      th.setAttribute('aria-sort', active ? state.direction > 0 ? 'ascending' : 'descending' : 'none');
      th.querySelector('i').textContent = active ? state.direction > 0 ? '↑' : '↓' : '↕';
    }
    document.querySelector('#rank-rows').innerHTML = found.length ? found.map((entry) => {
      const { p, rank, group, value, base } = entry;
      const chain = entry.plan.chain + (p.chains.length > 1 ? ' +' + (p.chains.length - 1) : '');
      const movement = p.change_7d === null ? 'muted' : p.change_7d >= 0 ? 'positive' : 'negative';
      return '<tr>' + cell(String(rank).padStart(2, '0'), 'rank') + '<th scope="row" class="protocol"><a href="'
        + detailURL(p.slug) + '">' + escape(p.name) + '</a><small>' + escape(chain) + '</small></th>'
        + cell(escape(cat(p)), '') + cell('<span class="tier ' + group + '">' + groups[group][0] + '</span>', '')
        + cell(compact(p.tvl_usd)) + cell(p.change_7d === null ? '—' : growthText(p.change_7d), 'num ' + movement)
        + cell(value.r.age === null ? '—' : integer(value.r.age) + 'd') + cell(pct(value.odds.chance))
        + cell(compact(value.value), 'num implied') + cell(interval(value.interval), 'num band') + cell(badge(base.verdict), '')
        + cell(signedCash(base.net), 'num ' + (base.net < 0 ? 'negative' : 'positive')) + '</tr>';
    }).join('') : '<tr><td colspan="' + columns.length + '" class="empty">No protocol matches these filters.</td></tr>';
  }

  function renderBoard(focused) {
    const farms = ranked.filter((e) => e.base.verdict === 'FARM').length;
    const scenario = model.DEFAULTS;
    const overview = '<div class="research">' + evidencePanel() + accountingPanel() + '</div>';
    const hero = '<section class="hero"><div class="hero-copy"><p class="eyebrow">DEFILLAMA SNAPSHOT · ' + escape(snapshot.as_of)
      + '</p><h1>Token launch radar<span>.</span></h1><p>Odds-weighted estimates for protocols that record no token.</p></div>'
      + profile() + '</section>'
      + '<section class="kpis" aria-label="Radar statistics">'
      + kpi('Ranked protocols', ranked.length, 'Watchlist, early and off-list')
      + kpi('Watchlist coverage', accounting.groups.watchlist.length + ' / ' + snapshot.watchlist.length, compact(snapshot.floor_usd) + ' TVL floor')
      + kpi('Priced peers', fit.priced.length, 'One usable cap per token family')
      + kpi('FARM scenarios', farms, 'P25 clears fees and 4% bill') + '</section>';
    const toggle = '<a class="button" href="#' + (focused ? 'board">Overview' : 'focus">Focus results') + '</a>';
    const boardPanel = '<section class="panel board" id="ranked">'
      + head(focused ? 'Filtered board' : 'Ranked board', 'Protocols that record no token', '<span class="scenario-line">' + dollars(scenario.deposit)
        + ' deposit · ' + pct(scenario.share) + ' drop · ' + scenario.days + ' days</span>')
      + searchControls() + '<div class="result-line"><strong id="row-count" role="status"></strong><div id="filter-summary"></div>'
      + toggle + '</div><div class="table-scroll" tabindex="0" aria-label="Ranked protocol table">'
      + '<table class="rank-table"><thead><tr>' + columns.map(([key, title]) =>
        '<th scope="col" data-column="' + key + '" class="' + (numberCols.has(key) ? 'num' : '') + '"><button type="button" data-sort="'
        + key + '">' + title + ' <i aria-hidden="true"></i></button></th>').join('')
      + '</tr></thead><tbody id="rank-rows"></tbody></table></div></section>';
    main.innerHTML = hero + (focused ? integrityStrip() + boardPanel + overview : overview + integrityStrip() + boardPanel);
    const form = document.querySelector('#filters');
    form.addEventListener('submit', (event) => event.preventDefault());
    form.addEventListener('input', (event) => {
      if (!(event.target.name in state.filters)) return;
      state.filters[event.target.name] = event.target.value;
      rankTable();
    });
    form.addEventListener('reset', (event) => {
      event.preventDefault();
      state.filters = freshFilters();
      state.sort = 'rank';
      state.direction = 1;
      for (const control of form.querySelectorAll('[name]')) control.value = '';
      rankTable();
    });
    main.querySelector('.rank-table thead').addEventListener('click', (event) => {
      const key = event.target.closest('[data-sort]')?.dataset.sort;
      if (!key) return;
      state.direction = state.sort === key ? -state.direction : numberCols.has(key) && key !== 'rank' ? -1 : 1;
      state.sort = key;
      rankTable();
    });
    rankTable();
  }

  function waterfall(entry) {
    const { p, value } = entry;
    const r = value.r;
    const terms = fit.price.terms;
    const age = r.age === null ? 'Listing date unreported' : integer(r.age) + ' days since listing';
    const dropped = (key) => terms.includes(key) ? '' : ' · price term dropped';
    const factors = [
      ['Pooled anchor', 'Fitted reference at $50M TVL'],
      ['TVL', compact(p.tvl_usd)],
      ['Category', escape(cat(p)) + dropped('category')],
      ['Seven-day TVL growth', growthText(p.change_7d) + dropped('growth') + (fit.oddsGrowth ? ' · used in peers' : '')],
      ['Time with no token recorded', age + dropped('tenure') + ' · informs odds'],
      ['Chain count', p.chains.length + ' recorded' + dropped('chains')],
    ];
    const odds = value.odds;
    const body = factors.map(([label, description], i) => {
      const item = value.waterfall[i];
      return '<tr>' + rowHead(label, description) + cell(i ? item.factor.toFixed(2) + '×' : '—') + cell(compact(item.value)) + '</tr>';
    }).join('') + '<tr class="subtotal">' + rowHead('If a token launches') + cell('') + cell(compact(value.conditional)) + '</tr>'
      + '<tr class="waterfall-total">' + rowHead('Token odds → implied', odds.seen + '/' + odds.count
        + ' peers record a token · ' + pct(odds.local) + ' weighted before shrinkage')
      + cell(pct(odds.chance, 1)) + cell(compact(value.value)) + '</tr>';
    return '<section class="panel waterfall">' + head('Valuation waterfall', 'How the figure is made', 'Running estimate')
      + table(['Input', 'Factor', 'Value'], body) + '</section>';
  }

  function peerPanel(entry) {
    const peers = model.pricedPeers(entry.p, fit);
    const [lo, hi] = entry.value.interval;
    const center = Math.max(0, Math.min(1, (entry.value.value - lo) / Math.max(1, hi - lo)));
    const body = peers.map(({ peer, observedMultiple, predictedMultiple }) =>
      '<tr>' + rowHead(escape(peer.name), escape(cat(peer)) + ' · ' + compact(peer.tvl_usd) + ' TVL')
      + cell(compact(peer.mcap_usd)) + cell(observedMultiple.toFixed(2) + '×') + cell(predictedMultiple.toFixed(2) + '×')
      + '</tr>').join('');
    return '<section class="panel peers">' + head('Comparable trades', 'Nearest priced peers', 'Cap ÷ TVL')
      + table(['Protocol', 'Market cap', 'Observed', 'Held-out'], body)
      + '<p class="footnote">Matched by category, TVL and age. Fits exclude each peer. Base odds ' + pct(entry.value.odds.prior) + '.</p>'
      + '<div class="range-card"><span>Implied P25–P75</span><b>' + interval(entry.value.interval)
      + '</b><i aria-hidden="true" style="--center:' + pct(center, 2) + '"></i>'
      + '<small>Held-out cap errors at fixed odds. Marker shows implied value.</small></div></section>';
  }

  function scenarioControls() {
    const s = state.settings;
    const fields = [
      ['deposit', 'Deposit ($)', 25, 1e7, 'any', s.deposit],
      ['share', 'Drop share (%)', 0, 100, 'any', Number((s.share * 100).toFixed(8))],
      ['days', 'Horizon (days)', 1, 365, 1, s.days],
    ];
    return '<form id="scenario" class="scenario" aria-label="Farm assumptions">' + fields.map(([key, label, min, max, step, value]) =>
      '<label>' + label + '<input required type="number" name="' + key + '" min="' + min + '" max="' + max + '" step="'
      + step + '" value="' + value + '"></label>').join('') + '<button type="reset" class="button">Reset</button></form>';
  }

  function sensitivity(p, value, settings) {
    const deposits = [0.5, 1, 2].map((factor) => settings.deposit * factor);
    const shares = [0.5, 1, 2].map((factor) => Math.min(1, settings.share * factor));
    const body = deposits.map((deposit, row) => '<tr>' + rowHead(dollars(deposit))
        + shares.map((share, col) => {
          const scenario = { ...settings, deposit, share };
          const net = model.farmVerdict(p, value, model.farmPlan(p, value.r.age, scenario), scenario).net;
          return cell(signedCash(net), 'num ' + (net < 0 ? 'loss' : 'gain') + (row === 1 && col === 1 ? ' current' : ''));
        }).join('') + '</tr>').join('');
    return '<section class="sensitivity"><h3>Net sensitivity</h3><p class="footnote">Deposit × drop share · net vs 4% T-bill</p>'
      + table(['Deposit', ...shares.map((share) => pct(share, 1))], body) + '</section>';
  }

  function scenarioPanel(entry) {
    const { p, value } = entry;
    const settings = state.settings;
    const plan = model.farmPlan(p, value.r.age, settings);
    const verdict = model.farmVerdict(p, value, plan, settings);
    const steps = plan.steps.map(({ label, action, cost, minutes }) =>
      '<tr>' + rowHead(label) + cell(escape(action), 'action') + cell(cash(cost)) + cell(minutes + ' min') + '</tr>').join('');
    const explanation = verdict.verdict === 'SKIP' ? 'Modeled drop falls short of fees plus the bill return.'
      : plan.restricted ? 'Positive point estimate. Check access and redemption.'
        : verdict.verdict === 'MARGINAL' ? 'Positive point estimate. P25 falls short.'
          : 'P25 drop covers modeled fees and the bill return. Verify the route before funding.';
    document.querySelector('#farm-verdict').innerHTML = badge(verdict.verdict) + ' <span>' + explanation + '</span>';
    document.querySelector('#farm-body').innerHTML = '<div class="scenario-metrics">'
      + kpi('Modeled drop', cash(verdict.drop), 'Implied × share × deposit ÷ (TVL + deposit)')
      + kpi('Route fees', cash(plan.cost), integer(plan.minutes) + ' min active time')
      + kpi('4% T-bill', cash(verdict.benchmark), settings.days + ' days · simple interest')
      + kpi('Net vs bill', signedCash(verdict.net), signedCash(verdict.hourly) + ' per active hour')
      + '</div><div class="farm-grid"><div class="plan">'
      + table(['Step', 'Action on ' + escape(plan.chain), 'Cost', 'Time'], steps)
      + '</div><aside class="farm-aside">' + sensitivity(p, value, settings)
      + '<div class="cash-check"><span>Break-even drop share</span><b>' + pct(verdict.breakEven, 1)
      + '</b><small>At current deposit and horizon.</small></div>'
      + '<p class="footnote">Illustrative fees. Eligibility, yield, taxes, principal risk and token liquidity are outside the calculation.</p>'
      + '</aside></div>';
  }

  function renderDetail(entry) {
    const { p, value, group, rank } = entry;
    const source = '<span class="tier ' + group + '">' + groups[group][0] + '</span>';
    main.innerHTML = '<p class="breadcrumbs"><a href="#' + state.boardRoute + '">← Ranked board</a></p>'
      + '<section class="detail-hero"><div><p class="eyebrow">RANK ' + String(rank).padStart(2, '0')
      + ' / ' + ranked.length + ' <span>·</span> RECORDS NO TOKEN</p><h1>' + escape(p.name) + '</h1><p>'
      + escape(cat(p)) + ' <span>·</span> ' + escape(p.chains.join(', ') || 'Chain unreported') + '</p></div>' + source + '</section>'
      + '<section class="kpis detail-kpis" aria-label="Protocol valuation">'
      + kpi('Implied value', compact(value.value), 'Radar estimate on ' + escape(snapshot.as_of))
      + kpi('Conditional cap', compact(value.conditional), 'If a token launches')
      + kpi('Token record odds', pct(value.odds.chance, 1), 'Similar protocols in snapshot')
      + kpi('Total value locked', compact(p.tvl_usd), 'Seven-day TVL ' + growthText(p.change_7d)) + '</section>'
      + '<div class="research detail-research">' + waterfall(entry) + peerPanel(entry) + '</div>'
      + '<section class="panel farm"><div class="farm-head">' + head('Costed farm plan', 'Does it clear the cash hurdle?', '')
      + scenarioControls() + '</div><p id="farm-verdict" aria-live="polite"></p><div id="farm-body"></div></section>';
    const controls = document.querySelector('#scenario');
    controls.addEventListener('submit', (event) => event.preventDefault());
    controls.addEventListener('input', () => {
      if (!controls.checkValidity()) return;
      const values = new FormData(controls);
      state.settings = { deposit: Number(values.get('deposit')), share: Number(values.get('share')) / 100, days: Number(values.get('days')) };
      scenarioPanel(entry);
    });
    controls.addEventListener('reset', (event) => {
      event.preventDefault();
      state.settings = { ...model.DEFAULTS };
      const { deposit, share, days } = state.settings;
      controls.elements.deposit.value = deposit;
      controls.elements.share.value = share * 100;
      controls.elements.days.value = days;
      scenarioPanel(entry);
    });
    scenarioPanel(entry);
  }

  function renderComps() {
    const items = [...accounting.groups.comp].sort((a, b) => b.mcap_usd - a.mcap_usd);
    const body = items.map((p) => '<tr>' + rowHead(escape(p.name)) + cell(escape(cat(p)), '')
      + cell(compact(p.tvl_usd)) + cell(compact(p.mcap_usd)) + cell((p.mcap_usd / p.tvl_usd).toFixed(2) + '×') + '</tr>').join('');
    main.innerHTML = '<section class="panel ledger">' + head('Valuation comparables', 'Token trades', items.length + ' independent caps')
      + '<div class="table-scroll" tabindex="0" aria-label="Priced peers">'
      + table(['Protocol', 'Category', 'TVL', 'Market cap', 'Cap / TVL'], body) + '</div></section>';
  }

  let screen = '';
  function navigate() {
    const hash = location.hash.slice(1);
    if (hash === 'main') return;
    const [route, target] = hash.split('/');
    let slug;
    try { slug = decodeURIComponent(target || ''); } catch { /* invalid route */ }
    if (screen === 'board') state.scroll = scrollY;
    const back = screen === 'protocol' && route === state.boardRoute;
    const entry = route === 'protocol' ? bySlug.get(slug) : null;
    if (entry) {
      renderDetail(entry);
      screen = 'protocol';
    } else if (route === 'comps') {
      renderComps();
      screen = 'comps';
    } else {
      state.boardRoute = route === 'focus' ? 'focus' : 'board';
      renderBoard(route === 'focus');
      screen = 'board';
    }
    document.querySelector('#nav-board').setAttribute('aria-current', screen !== 'comps' ? 'page' : 'false');
    document.querySelector('#nav-comps').setAttribute('aria-current', screen === 'comps' ? 'page' : 'false');
    scrollTo(0, back ? state.scroll : 0);
    main.removeAttribute('aria-busy');
  }

  document.querySelector('#snapshot-stamp').textContent = 'SEALED · ' + snapshot.as_of;
  document.querySelector('#footer').textContent = 'DefiLlama · ' + snapshot.as_of
    + ' UTC. Implied values are snapshot estimates. Odds describe recorded tokens among peers.';
  addEventListener('hashchange', navigate);
  navigate();
})();
