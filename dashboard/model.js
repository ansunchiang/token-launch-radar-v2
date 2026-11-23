(function expose(factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else globalThis.LaunchLedger = model;
})(function createModel() {
  'use strict';

  // Shared build: fitModel tests both models, impliedValue walks the cap, farmPlan and farmVerdict price the route.
  const DAY = 86400000;
  const TVL_ANCHOR = 50000000;
  const CAP_LOW = 100000;
  const CAP_HIGH = 25000000000;
  const DEFAULTS = Object.freeze({ deposit: 2500, share: 0.08, days: 60 });
  const GROUPS = ['watchlist', 'early', 'offlist', 'comp', 'unpriced', 'out'];
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const mean = (xs) => xs.length ? sum(xs) / xs.length : null;
  const ordered = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const bySize = (a, b) => b.tvl_usd - a.tvl_usd || ordered(a.slug, b.slug);
  const cents = (x) => Math.round(x * 100) / 100;
  const usd = (n) => Math.max(1, Math.min(1e14, Math.round(n)));
  const category = (p) => p.category || 'Unclassified';
  const date = (s) => typeof s === 'string' ? Date.parse(s + 'T00:00:00Z') : NaN;
  const tokenRecorded = (p) => Boolean(p.gecko_id || p.symbol || p.mcap_usd > 0);
  const versioned = /(?:\s|-)(?:v\d+(?:\.\d+)?|\d+\.\d+)$/i;
  const excludedCategory = /^(?:.*\bbridge|liquid staking|liquid restaking|restaked btc|cex)$/i;
  const wrappedName = /\b(?:wrapped|staked|staking)\b/i;
  const exchangeName = /^(?:binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

  function usableCap(p) {
    const multiple = p.mcap_usd / p.tvl_usd;
    return p.mcap_usd >= CAP_LOW && p.mcap_usd <= CAP_HIGH && multiple >= 0.001 && multiple <= 500;
  }

  function tokenFamilies(protocols) {
    const aliases = new Map();
    const roots = new Map(protocols.map((p) => [p.slug, p.slug]));
    function root(slug) {
      while (roots.get(slug) !== slug) slug = roots.get(slug);
      return slug;
    }
    for (const p of protocols) {
      const keys = [p.gecko_id && 'id:' + p.gecko_id.toLowerCase(), p.symbol && 'symbol:' + p.symbol.toUpperCase()];
      for (const key of keys.filter(Boolean)) {
        if (aliases.has(key)) roots.set(root(p.slug), root(aliases.get(key)));
        else aliases.set(key, p.slug);
      }
    }
    const families = new Map();
    for (const p of protocols) {
      const key = root(p.slug);
      if (!families.has(key)) families.set(key, []);
      families.get(key).push(p);
    }
    return [...families.values()];
  }

  function account(snapshot) {
    const watch = new Set(snapshot.watchlist);
    const groups = Object.fromEntries(GROUPS.map((group) => [group, []]));
    const recorded = [];
    for (const p of snapshot.protocols) {
      if (watch.has(p.slug)) groups.watchlist.push(p);
      else if (excludedCategory.test(category(p)) || versioned.test(p.name) || wrappedName.test(p.name) || exchangeName.test(p.name)) groups.out.push(p);
      else if (tokenRecorded(p)) recorded.push(p);
      else groups[p.tvl_usd < snapshot.floor_usd ? 'early' : 'offlist'].push(p);
    }
    const oddsTokens = [];
    for (const family of tokenFamilies(recorded)) {
      family.sort((a, b) => Number(usableCap(b)) - Number(usableCap(a)) || bySize(a, b));
      const lead = family[0];
      oddsTokens.push(lead);
      for (const p of family) {
        groups[p === lead && usableCap(p) ? 'comp' : 'unpriced'].push(p);
      }
    }
    return { groups, oddsTokens };
  }

  function describe(p, asOf) {
    const listed = date(p.listed_at);
    const days = Math.floor((date(asOf) - listed) / DAY);
    const age = Number.isFinite(days) ? Math.max(0, days) : null;
    const size = Math.log(p.tvl_usd / TVL_ANCHOR);
    const ageLog = age === null ? null : Math.log1p(age / 365);
    return {
      p, listed, category: category(p), size, age, ageLog,
      growth: Number.isFinite(p.change_7d) ? Math.asinh(clamp(p.change_7d, -90, 150) / 20) : 0,
      tenure: (ageLog ?? Math.log(2)) - Math.log(2),
      chains: Math.log(Math.max(1, p.chains.length)),
      y: p.mcap_usd > 0 ? Math.log(p.mcap_usd) : null,
      token: Number(tokenRecorded(p)),
    };
  }

  function walkForward(rows) {
    const dated = rows.filter((r) => Number.isFinite(r.listed)).sort((a, b) => a.listed - b.listed);
    const dates = [...new Set(dated.map((r) => r.listed))];
    if (dates.length < 8) return [];
    const pivots = [0.5, 2 / 3, 5 / 6, 1].map((part) => dates[Math.floor(dates.length * part)] ?? Infinity);
    return pivots.slice(0, -1).map((start, i) => ({
      train: dated.filter((r) => r.listed < start),
      test: dated.filter((r) => r.listed >= start && r.listed < pivots[i + 1]),
    })).filter(({ train, test }) => train.length && test.length);
  }

  function solveSystem(matrix, rhs) {
    for (let col = 0; col < rhs.length; col++) {
      const pivot = matrix[col][col];
      for (let row = col + 1; row < rhs.length; row++) {
        const ratio = matrix[row][col] / pivot;
        for (let j = col + 1; j < rhs.length; j++) matrix[row][j] -= ratio * matrix[col][j];
        rhs[row] -= ratio * rhs[col];
      }
    }
    for (let row = rhs.length - 1; row >= 0; row--) {
      for (let j = row + 1; j < rhs.length; j++) rhs[row] -= matrix[row][j] * rhs[j];
      rhs[row] /= matrix[row][row];
    }
    return rhs;
  }

  function priceFit(rows, terms) {
    if (!terms.length) {
      const multiple = mean(rows.map((r) => r.y - Math.log(r.p.tvl_usd))) ?? 0;
      return { terms, bias: Math.log(TVL_ANCHOR) + multiple, coefficients: { size: 1 }, categories: new Map() };
    }
    const numeric = terms.filter((term) => term !== 'category');
    const cats = terms.includes('category') ? [...new Set(rows.map((r) => r.category))].sort() : [];
    const matrix = Array.from({ length: 1 + numeric.length }, () => Array(1 + numeric.length).fill(0));
    const rhs = Array(matrix.length).fill(0);
    const byCategory = new Map(cats.map((key) => [key, { count: 0, sums: Array(matrix.length).fill(0), y: 0 }]));
    for (const r of rows) {
      const vector = [1, ...numeric.map((t) => r[t])];
      const stats = byCategory.get(r.category);
      for (let i = 0; i < vector.length; i++) {
        rhs[i] += vector[i] * r.y;
        if (stats) stats.sums[i] += vector[i];
        for (let j = 0; j < vector.length; j++) matrix[i][j] += vector[i] * vector[j];
      }
      if (stats) {
        stats.count++;
        stats.y += r.y;
      }
    }
    const shrink = 8;
    for (const stats of byCategory.values()) {
      const denominator = stats.count + shrink;
      for (let i = 0; i < rhs.length; i++) {
        rhs[i] -= stats.sums[i] * stats.y / denominator;
        for (let j = 0; j < rhs.length; j++) matrix[i][j] -= stats.sums[i] * stats.sums[j] / denominator;
      }
    }
    for (let i = 1; i < rhs.length; i++) matrix[i][i] += 2;
    const beta = solveSystem(matrix, rhs);
    const categories = new Map([...byCategory].map(([key, stats]) => [
      key, (stats.y - sum(stats.sums.map((x, i) => x * beta[i]))) / (stats.count + shrink),
    ]));
    return {
      terms, bias: beta[0], categories,
      coefficients: Object.fromEntries(numeric.map((t, i) => [t, beta[i + 1]])),
    };
  }

  function priceParts(r, fit) {
    const term = (key) => (fit.coefficients[key] ?? 0) * r[key];
    return [fit.bias, term('size'), fit.categories.get(r.category) ?? 0, term('growth'), term('tenure'), term('chains')];
  }

  function priceScores(rows, folds, terms) {
    const residual = (r, fit) => r.y - sum(priceParts(r, fit));
    const loo = new Map(rows.map((r) => [r.p.slug, residual(r, priceFit(rows.filter((x) => x !== r), terms))]));
    const forward = folds.flatMap(({ train, test }) => {
      const fit = priceFit(train, terms);
      return test.map((r) => residual(r, fit));
    });
    return { loo, miss: mean([...loo.values()].map(Math.abs)), forward: mean(forward.map(Math.abs)) };
  }

  function quantile(sorted, p) {
    const i = (sorted.length - 1) * p;
    return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i % 1);
  }

  function peerDistance(a, b, growth) {
    const age = a.ageLog === null || b.ageLog === null
      ? Number(a.ageLog !== b.ageLog) * 0.45 : 0.85 * Math.abs(a.ageLog - b.ageLog);
    return (a.category === b.category ? 0 : 1.6) + 0.65 * Math.abs(a.size - b.size) + age
      + (growth ? 0.4 * Math.abs(a.growth - b.growth) : 0);
  }

  function closest(r, rows, limit, growth = false) {
    return rows.map((other) => ({ other, distance: peerDistance(r, other, growth) }))
      .sort((a, b) => a.distance - b.distance || ordered(a.other.p.slug, b.other.p.slug)).slice(0, limit);
  }

  const oddsFit = (rows) => ({ rows, prior: (1 + sum(rows.map((r) => r.token))) / (rows.length + 2) });

  function tokenOdds(r, fit, growth = false) {
    const neighbors = closest(r, fit.rows, 24, growth);
    const weights = neighbors.map(({ distance }) => Math.exp(-distance));
    const weight = sum(weights);
    const tokenWeight = sum(neighbors.map(({ other }, i) => other.token * weights[i]));
    return {
      chance: (tokenWeight + 4 * fit.prior) / (weight + 4),
      local: weight ? tokenWeight / weight : fit.prior, prior: fit.prior,
      seen: neighbors.filter(({ other }) => other.token).length, count: neighbors.length,
    };
  }

  function oddsScores(rows, folds, score) {
    const loo = rows.map((r) => [r.token, score(r, oddsFit(rows.filter((x) => x !== r)))]);
    const forward = folds.flatMap(({ train, test }) => {
      const fit = oddsFit(train);
      return test.map((r) => [r.token, score(r, fit)]);
    });
    const brier = (records) => mean(records.map(([actual, prediction]) => (actual - prediction) ** 2));
    return { miss: brier(loo), forward: brier(forward) };
  }

  function improves(candidate, current) {
    return candidate.forward !== null && current.forward !== null
      && candidate.miss < current.miss - 1e-8 && candidate.forward < current.forward - 1e-8;
  }

  function fitModel(snapshot, accounting = account(snapshot)) {
    const { groups, oddsTokens } = accounting;
    const ranked = [...groups.watchlist, ...groups.early, ...groups.offlist];
    const priced = groups.comp.map((p) => describe(p, snapshot.as_of));
    if (priced.length < 3) throw new Error('At least three independent priced protocols are required.');
    const folds = walkForward(priced);
    let terms = [];
    let scores = priceScores(priced, folds, terms);
    const evidence = [{ label: 'Flat mcap / TVL', ...scores, status: 'Baseline' }];
    for (const [key, label] of [
      ['size', 'Fitted log TVL slope'], ['category', 'Shrunk category effect'],
      ['growth', 'Seven-day TVL growth'], ['tenure', 'Listing age'], ['chains', 'Chain count'],
    ]) {
      const next = [...new Set([...terms, 'size', key])];
      const trial = priceScores(priced, folds, next);
      const keep = improves(trial, scores);
      evidence.push({ label, ...trial, status: keep ? 'Kept' : 'Dropped' });
      if (keep) {
        terms = next;
        scores = trial;
      }
    }
    const oddsRows = [...ranked, ...oddsTokens].map((p) => describe(p, snapshot.as_of));
    const oddsFolds = walkForward(oddsRows);
    const prior = oddsScores(oddsRows, oddsFolds, (r, fit) => fit.prior);
    const peers = oddsScores(oddsRows, oddsFolds, (r, fit) => tokenOdds(r, fit).chance);
    const growth = oddsScores(oddsRows, oddsFolds, (r, fit) => tokenOdds(r, fit, true).chance);
    const oddsGrowth = improves(growth, peers);
    const oddsEvidence = [
      { label: 'Token-record base rate', ...prior, status: 'Baseline' },
      { label: 'Category · TVL · age peers', ...peers, status: oddsGrowth ? 'Reference' : 'Kept' },
      { label: 'Peers + seven-day growth', ...growth, status: oddsGrowth ? 'Kept' : 'Dropped' },
    ];
    const residuals = [...scores.loo.values()].sort((a, b) => a - b);
    return {
      asOf: snapshot.as_of, priced, loo: scores.loo, price: priceFit(priced, terms),
      priceMiss: scores, evidence, odds: oddsFit(oddsRows), oddsGrowth, oddsEvidence,
      range: [quantile(residuals, 0.25), quantile(residuals, 0.75)],
      forwardN: sum(folds.map((f) => f.test.length)), oddsForwardN: sum(oddsFolds.map((f) => f.test.length)),
    };
  }

  function impliedValue(p, fit) {
    const r = describe(p, fit.asOf);
    const parts = priceParts(r, fit.price);
    let running = 0;
    const waterfall = parts.map((part) => {
      running += part;
      return { factor: Math.exp(part), value: Math.exp(running) };
    });
    const conditional = Math.exp(running);
    const neighbors = oddsFit(fit.odds.rows.filter((peer) => peer.p.slug !== p.slug));
    const odds = tokenOdds(r, neighbors, fit.oddsGrowth);
    const value = conditional * odds.chance;
    const interval = fit.range.map((residual) => usd(value * Math.exp(residual)));
    return { r, waterfall, conditional, odds, value: usd(value), interval };
  }

  function pricedPeers(p, fit) {
    return closest(describe(p, fit.asOf), fit.priced, 4).map(({ other }) => {
      const peer = other.p;
      const predicted = Math.exp(other.y - fit.loo.get(peer.slug));
      return { peer, observedMultiple: peer.mcap_usd / peer.tvl_usd, predictedMultiple: predicted / peer.tvl_usd };
    });
  }

  const LOW_FEE = /^(?:arbitrum|base|optimism|solana|sui|aptos|polygon|gnosis|stellar|avalanche|unichain|bsc|binance|near|scroll|linea|starknet|celo|mantle|hyperliquid l1)$/i;
  const MAINNET_FEE = /^(?:ethereum|bitcoin)$/i;
  const capital = /risk curator|allocator|vault|yield|basis trading|cedefi|farm|liquidity manager/i;
  const borrowing = /lending|collateral market|cdp/i;
  function route(p) {
    const c = category(p);
    if (borrowing.test(c)) return [
      'Preview a reversible stable-asset supply in an isolated market. Keep borrowing disabled.',
      'Check exit liquidity and log the supply receipt and market ID.',
      'Withdraw and confirm the receipt balance clears.', false,
    ];
    if (/dexs|dex aggregator/i.test(c)) return [
      'Preview a balanced LP mint in a verified stable pair. Check round-trip slippage.',
      'Log the pool and position IDs. Check both assets remain near par.',
      'Burn the LP position and reconcile both assets.', false,
    ];
    if (/rwa/i.test(c)) return [
      'Check jurisdiction, subscription minimum and transfer rules. Verify the redemption terms.',
      'Log the subscription ID, NAV and earliest redemption date.',
      'Request redemption and reconcile settlement.', true,
    ];
    if (capital.test(c)) return [
      'Preview a test deposit in an unlevered vault with visible assets, share price and exit queue.',
      'Save the share receipt and check a test exit against its quote.',
      'Redeem shares and confirm settlement.', /cedefi/i.test(c),
    ];
    if (/derivatives|prediction|options/i.test(c)) return [
      'Verify a withdrawable collateral route and preview a test with zero open exposure.',
      'Check if collateral qualifies. Skip any route that requires a trade.',
      'Withdraw collateral and record the receipt.', true,
    ];
    if (/chain|payments/i.test(c)) return [
      'Preview a small self-transfer with a verified return path.',
      'Confirm finality in the official explorer and log the transaction ID.',
      'Return the test balance on the verified route.', true,
    ];
    return [
      'Find a documented, reversible action and preview both entry and exit.',
      'Confirm a receipt and published eligibility. Stop if either is unavailable.',
      'Withdraw through the documented route and verify the balance.', true,
    ];
  }

  function farmPlan(p, age, settings = DEFAULTS) {
    const chains = [...p.chains].sort((a, b) => ordered(a, b));
    const chain = chains.find((c) => LOW_FEE.test(c)) ?? chains[0] ?? 'unreported chain';
    const fee = LOW_FEE.test(chain) ? 0.25 : MAINNET_FEE.test(chain) ? 4.5 : 1.5;
    const young = age === null || age < 180;
    const liquidity = p.tvl_usd < TVL_ANCHOR;
    const stop = p.change_7d < -10 ? 12 : young || liquidity ? 18 : 25;
    const period = young || liquidity ? 7 : 14;
    const reviews = Math.ceil(settings.days / period);
    const [enter, qualify, exit, restricted] = route(p);
    const subject = p.name + ' on ' + chain;
    const swapFriction = /dexs/i.test(category(p)) ? settings.deposit * 0.0005 : 0;
    const steps = [
      ['SETUP', 'Create a fresh wallet and isolate it from main funds.', 0, 5],
      ['VERIFY', 'Check defillama.com/protocol/' + p.slug + ' and match contracts to official docs. Skip if no route. Never sign approvals from DMs.', 0, restricted ? 9 : 6],
      ['FUND', 'Fund the test wallet. Reserve gas separately from ' + money(settings.deposit) + ' of capital.', fee, 5],
      ['ENTER', enter, 2 * fee + swapFriction, restricted ? 9 : 6],
      ['QUALIFY', qualify + ' Log published criteria.', 0, 5],
      ['UPKEEP', 'Review TVL, liquidity and eligibility every ' + period + ' days (' + reviews + ' checks).', 0, reviews * 2],
      ['STOP-RULE', 'Exit if TVL falls ' + stop + '% from entry or a token is announced. Log entry TVL before funding.', 0, 2],
      ['CLAIM', 'If a claim opens, verify eligibility, contract and fees in official docs.', fee, 4],
      ['EXIT', exit + ' Revoke excess approvals and log fees.', 2 * fee, 6],
    ].map(([label, text, cost, minutes]) => ({ label, action: subject + ' · ' + text, cost: cents(cost), minutes }));
    return { chain, restricted, steps, cost: cents(sum(steps.map((s) => s.cost))), minutes: sum(steps.map((s) => s.minutes)) };
  }

  const money = (n) => '$' + n.toLocaleString('en-US');

  function stepText(step) {
    return step.label + ' · ' + step.action + ' Cost $' + step.cost.toFixed(2) + ' · Time ' + step.minutes + ' min.';
  }

  function farmVerdict(p, value, plan, settings = DEFAULTS) {
    const share = settings.share * settings.deposit / (p.tvl_usd + settings.deposit);
    const drop = value.value * share;
    const benchmark = settings.deposit * 0.04 * settings.days / 365;
    const hurdle = plan.cost + benchmark;
    const net = drop - hurdle;
    const downside = value.interval[0] * share - hurdle;
    const breakEven = hurdle * (p.tvl_usd + settings.deposit) / (value.value * settings.deposit);
    const verdict = net < 0 ? 'SKIP' : plan.restricted || downside < 0 ? 'MARGINAL' : 'FARM';
    return { verdict, drop, benchmark, net, breakEven, hourly: net * 60 / plan.minutes };
  }

  function buildRadar(snapshot) {
    const accounting = account(snapshot);
    const fit = fitModel(snapshot, accounting);
    const ranked = GROUPS.slice(0, 3).flatMap((group) => accounting.groups[group].map((p) => {
      const value = impliedValue(p, fit);
      const plan = farmPlan(p, value.r.age);
      return { p, group, value, plan, base: farmVerdict(p, value, plan) };
    })).sort((a, b) => b.value.value - a.value.value || ordered(a.p.slug, b.p.slug));
    const rows = ranked.map((entry, i) => {
      const { p, group, value, plan, base } = entry;
      entry.rank = i + 1;
      return {
        rank: entry.rank, slug: p.slug, name: p.name, implied_value_usd: value.value,
        band_usd: value.interval, token_odds_bps: Math.round(value.odds.chance * 10000),
        tier: group, default_verdict: base.verdict, farm_steps: plan.steps.map(stepText),
      };
    });
    return { accounting, fit, ranked, rows };
  }

  return { DEFAULTS, GROUPS, buildRadar, fitModel, tokenOdds, impliedValue, pricedPeers, farmPlan, farmVerdict, tokenRecorded };
});
