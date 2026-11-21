// Token Radar's dashboard, radar-2. Reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail drawer with the model's own inputs and the protocol's
// farm plan, a model sandbox that re-ranks live, and the methodology. No
// network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var M = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null,
    sb: { base: M.base_multiple, growthW: M.growth_weight, agePeak: M.age_peak_days, catScale: 1 }, sbOn: false };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The category key the model's multiple table uses (same rule as main.ts).
  function catKey(c) {
    c = (c || '').toLowerCase();
    if (c.indexOf('perpetual') >= 0) return 'perpetuals';
    if (c.indexOf('derivative') >= 0) return 'derivatives';
    if (c === 'dexs' || c.indexOf('dex') === 0) return 'dexs';
    if (c.indexOf('lend') >= 0) return 'lending';
    if (c === 'cdp' || c.indexOf('collateral') >= 0) return 'cdp';
    if (c.indexOf('yield') >= 0) return 'yield';
    if (c.indexOf('leveraged farm') >= 0) return 'leveraged_farming';
    if (c.indexOf('liquid staking') >= 0) return 'liquid_staking';
    if (c.indexOf('restak') >= 0) return 'restaking';
    if (c.indexOf('rwa') >= 0 || c.indexOf('real world') >= 0) return 'rwa';
    if (c.indexOf('prediction') >= 0) return 'prediction_market';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('cross chain') >= 0) return 'cross_chain';
    if (c.indexOf('stable') >= 0) return 'stablecoins';
    return 'other';
  }
  // The model in one function: the page recomputes a row from the snapshot
  // figures, so the page's code and the board's data are visibly the same
  // arithmetic, and the sandbox re-ranks by changing its constants.
  function impliedOf(row, o) {
    o = o || { base: M.base_multiple, growthW: M.growth_weight, agePeak: M.age_peak_days, catScale: 1 };
    var g = Math.min(M.growth_cap, Math.max(M.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (g / 100) * o.growthW;
    var age = row.age_days === null || row.age_days === undefined ? M.unknown_age_days : row.age_days;
    var ageMult = age <= o.agePeak ? M.age_floor + (1 - M.age_floor) * (Math.max(age, 0) / o.agePeak)
      : Math.max(M.age_tail_floor, 1 - (1 - M.age_tail_floor) * (Math.min(age - o.agePeak, M.age_tail_days) / M.age_tail_days));
    var catMult = (M.category_multiples[catKey(row.category)] || 1);
    if (o.catScale !== 1) catMult = 1 + (catMult - 1) * o.catScale;
    var chainMult = 1 + Math.min(Math.max((row.chains || []).length - 1, 0) * M.chain_step, M.chain_max_bonus);
    return { implied: Math.max(1, Math.round(row.tvl_usd * o.base * catMult * growthMult * ageMult * chainMult)),
      catMult: catMult, growthMult: growthMult, ageMult: ageMult, chainMult: chainMult };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL, age and seven-day change decide the action, the
  // capital, the hold and the risk. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase(), name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, half) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $' + half + ' of USDC against the supply and repay it the same week, so the position shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $' + half + ' through the pool once, so the position shows trading as well as liquidity.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller amount back the other way so the position shows two-way use.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake the receipt once so the position shows compounding, not a single deposit.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the hedge and reopen it once at a smaller size so the position shows repeat use.';
    if (c.indexOf('prediction') >= 0) return 'Settle the first market position and place a second one so the position shows repeat use.';
    if (c.indexOf('stable') >= 0 || c.indexOf('rwa') >= 0) return 'Mint a second, smaller amount and hold it beside the first position.';
    return 'Make a second deposit of $' + half + ' a week later so the position shows repeat use.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p), capital = capitalFor(p), half = Math.max(10, Math.round(capital / 2)), hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, half), cost: 'about $' + (half >= 50 ? 4 : 2) + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: p.risk, cost: 'nothing to check', time: '5 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Rows with the sandbox applied: the submitted board's order is the
  // default; moving a slider re-ranks in the page only.
  function viewRows() {
    var list = DATA.rows.map(function (r) {
      if (!state.sbOn) return r;
      var v = impliedOf(r, state.sb);
      var copy = Object.assign({}, r, { implied_value_usd: v.implied });
      return copy;
    });
    if (state.sbOn) list.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); });
    return list;
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return viewRows().filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill', html: 'Snapshot <b>' + DATA.as_of + '</b>' }),
        el('span', { class: 'pill', html: 'DefiLlama protocol index' }),
        el('span', { class: 'pill', html: '<b>' + DATA.model_version + '</b> model' })
      )
    );
  }

  function lede() {
    var total = DATA.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor, not the ceiling: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record, plus every rankable pre-token protocol below that floor — bridges, staked and wrapped products and exchanges left out by the watchlist\u2019s own rules. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every slug, no gaps' })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' below the floor' })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(total) }), el('small', { text: 'sum of the board' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }), el('small', { text: 'shown with market caps' }))
      )
    );
  }

  function spotlight() {
    var top = DATA.rows.slice(0, 5);
    var max = top[0] ? top[0].implied_value_usd : 1;
    return el('section', { class: 'spot' },
      el('h2', { text: 'Top 5 by implied value' }),
      el('p', { class: 'sub', text: 'The strongest farms on the board right now. Select one for its model and farm plan.' }),
      el('div', { class: 'spot-list' }, top.map(function (r) {
        return el('button', { class: 'spot-item', type: 'button', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rank', text: '#' + r.rank }),
          el('b', { text: r.name }),
          el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'sub', text: fmtUsd(r.tvl_usd) + ' TVL · ' + fmtPct(r.change_7d) }),
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.round((r.implied_value_usd / max) * 100)) + '%' }))
        );
      }))
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var tvl = el('select', { id: 'mintvl', 'aria-label': 'Minimum TVL' },
      [['0', 'Any TVL'], ['50000000', 'TVL $50M+'], ['100000000', 'TVL $100M+'], ['1000000000', 'TVL $1B+']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: String(state.minTvl) === o[0] ? 'selected' : null });
      })
    );
    tvl.addEventListener('change', function () { state.minTvl = Number(tvl.value); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      el('div', { class: 'field' }, el('label', { for: 'mintvl', text: 'Minimum TVL' }), tvl),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(state.sbOn ? (list.indexOf(r) + 1) : r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + ' · ' + r.drivers.join(' · ') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' + (state.sbOn ? ' Sandbox is on: this order is the sandbox ranking, not the submitted board.' : '') }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl_ratio === null ? 'n/a' : r.mcap_tvl_ratio.toFixed(2) + 'x' }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. MCap/TVL shows how the market values each dollar of TVL. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'MCap/TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function breakdown() {
    function agg(keyFn, valFn) {
      var m = {};
      DATA.rows.forEach(function (r) {
        var k = keyFn(r);
        if (!k) return;
        m[k] = m[k] || { n: 0, v: 0 };
        m[k].n += 1; m[k].v += valFn(r);
      });
      return Object.keys(m).map(function (k) { return { k: k, n: m[k].n, v: m[k].v }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 8);
    }
    var byCat = agg(function (r) { return r.category || 'Other'; }, function (r) { return r.implied_value_usd; });
    var byChain = agg(function (r) { return (r.chains || [])[0] || 'Other'; }, function (r) { return r.implied_value_usd; });
    function bars(list, fmt) {
      var max = list[0] ? list[0].v : 1;
      return list.map(function (x) {
        return el('div', { class: 'bar-row' },
          el('span', { class: 'lbl', text: x.k }),
          el('div', { class: 'track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((x.v / max) * 100)) + '%' })),
          el('span', { class: 'v', text: fmt(x) })
        );
      });
    }
    return el('section', { class: 'panel' },
      el('h2', { text: 'Where the implied value sits' }),
      el('p', { class: 'sub', text: 'Total implied value by category and by first chain, top 8 each. The board is not one category or one chain.' }),
      el('div', { class: 'bars' },
        el('div', null, el('h3', { text: 'By category' }), bars(byCat, function (x) { return fmtUsd(x.v); })),
        el('div', null, el('h3', { text: 'By chain' }), bars(byChain, function (x) { return fmtUsd(x.v); }))
      )
    );
  }

  function sandbox() {
    function slider(id, label, min, max, step, get, set, fmt) {
      var out = el('output', { text: fmt(get()) });
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(get()), 'aria-label': label });
      input.addEventListener('input', function () { set(Number(input.value)); out.textContent = fmt(get()); state.sbOn = true; render(); });
      return el('div', null, el('label', { for: id, text: label + ': ' }, out), input);
    }
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the submitted model', onclick: function () {
      state.sb = { base: M.base_multiple, growthW: M.growth_weight, agePeak: M.age_peak_days, catScale: 1 };
      state.sbOn = false; render();
    } });
    return el('section', { class: 'panel' },
      el('h2', { text: 'Model sandbox' }),
      el('p', { class: 'sub', text: 'Change the model and the board re-ranks in the page, from the same snapshot figures. The submitted board.json keeps the model as stated; the sandbox is for checking how much the ranking depends on each choice.' }),
      el('div', { class: 'sandbox-grid' },
        slider('sb-base', 'Base multiple', 0.1, 0.5, 0.01, function () { return state.sb.base; }, function (v) { state.sb.base = v; }, function (v) { return 'x' + v.toFixed(2); }),
        slider('sb-growth', 'Growth weight', 0, 1, 0.05, function () { return state.sb.growthW; }, function (v) { state.sb.growthW = v; }, function (v) { return v.toFixed(2); }),
        slider('sb-age', 'Age peak (days)', 180, 1095, 15, function () { return state.sb.agePeak; }, function (v) { state.sb.agePeak = v; }, function (v) { return String(v) + 'd'; }),
        slider('sb-cat', 'Category scale', 0.5, 1.5, 0.05, function () { return state.sb.catScale; }, function (v) { state.sb.catScale = v; }, function (v) { return 'x' + v.toFixed(2); })
      ),
      reset,
      state.sbOn ? el('p', { class: 'note', html: '<b>Sandbox on.</b> This order is a what-if, not the submitted board. Reset to see the board as submitted.' }) : null
    );
  }

  function methodology() {
    var m = M;
    var cats = Object.keys(m.category_multiples).filter(function (k) { return k !== 'other'; }).map(function (k) {
      return el('tr', null, el('td', { text: k }), el('td', { class: 'num', text: 'x' + m.category_multiples[k].toFixed(2) }));
    });
    return el('section', { class: 'panel method' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl x ' + m.base_multiple + ' x cat x (1 + clamp(7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x age x (1 + 0.03 x min(chains - 1, 5)) )'
      ),
      el('p', { html: '<b>Age curve.</b> The multiplier rises from ' + m.age_floor + ' at listing to 1.00 at ' + m.age_peak_days + ' days, then fades toward ' + m.age_tail_floor + ' over ' + m.age_tail_days + ' more days: a protocol too young is unproven, in its second year it is established and still pre-token, and past three years with no token it has probably decided never to launch. An unlisted age uses ' + m.unknown_age_days + ' days.' }),
      el('p', { html: '<b>Category multiple.</b> A stated assumption, not a fact from the snapshot: tokens in some categories have historically launched at a higher value per dollar of TVL. The multiples are deliberately modest so TVL still decides most of the ranking.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'plain' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Multiple' }))),
          el('tbody', null, cats)
        )
      ),
      el('p', { html: '<b>Coverage.</b> The board ranks ' + DATA.board_size + ' pre-token protocols: the ' + DATA.watchlist_size + ' on the watchlist and ' + DATA.early_size + ' more below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor — every protocol below the floor that passes the watchlist\u2019s own pre-token rules. ' + DATA.excluded_pre_token + ' pre-token protocols are excluded by those rules: exchanges, bridges, staking and restaking products, versioned pools, and wrapped or staked products of another protocol, which are not independent launches. ' + DATA.above_floor_left_out + ' more pass the snapshot-visible rules above the floor but are not on the watchlist, so they are not ranked: the snapshot carries no parent-protocol field, and the watchlist is the only record of that filter.' }),
      el('p', { html: '<b>What the snapshot does not say.</b> It records no token, no price and no airdrop: "no token recorded" means DefiLlama records none, never that a protocol has none. Implied value is a model built from TVL, growth, age, category and chain breadth — an estimate for ranking farms, not a price and not a promise that any token launches.' }),
      el('p', { html: '<b>Source.</b> ' + DATA.source + '. Snapshot date ' + DATA.as_of + '. Model ' + DATA.model_version + '.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var v = state.sbOn ? impliedOf(row, state.sb) : null;
    var catMult = v ? v.catMult : row.category_multiplier;
    var growthMult = v ? v.growthMult : row.growth_multiplier;
    var ageMult = v ? v.ageMult : row.age_multiplier;
    var chainMult = v ? v.chainMult : row.chain_multiplier;
    var implied = v ? v.implied : row.implied_value_usd;
    var base = row.tvl_usd * (state.sbOn ? state.sb.base : M.base_multiple);
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Base (TVL x ' + (state.sbOn ? state.sb.base : M.base_multiple) + ')' }), el('b', { class: 'num', text: fmtUsd(base) })),
        el('div', null, el('span', { text: 'Category (' + catKey(row.category) + ')' }), el('b', { class: 'num', text: 'x' + catMult.toFixed(2) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + '  x' + growthMult.toFixed(2) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + '  x' + ageMult.toFixed(2) })),
        el('div', null, el('span', { text: 'Chain breadth (' + (row.chains || []).length + ')' }), el('b', { class: 'num', text: 'x' + chainMult.toFixed(2) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(implied) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row).implied) + (impliedOf(row).implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' + (state.sbOn ? ' Sandbox values are shown: reset the sandbox for the submitted numbers.' : '') })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'risk', html: '<b>Risk:</b> ' + row.risk }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(spotlight());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(breakdown());
      shell.appendChild(sandbox());
      shell.appendChild(methodology());
    }
    shell.appendChild(el('p', { class: 'foot', text: 'Token Radar ' + DATA.model_version + ' · snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · implied value is a model, not a price.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
