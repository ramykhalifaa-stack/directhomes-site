/*
  DirectHomes app preview: business plan alignment (loaded after improvements.js)

  Brings the investor demo in line with the November 2026 business plan:
   1. Deposit choice: after the tenancy is signed, the tenant chooses a Deposit Pass (no cash, a yearly
      fee, an insurer-backed guarantee to the landlord) or a Held Deposit (cash in escrow, no fee).
   2. Deposit Pass confirmation: the fee is not refunded, make-good and damage are still owed, and the
      expected make-good amount is shown before the tenant pays.
   3. Move-in condition record confirmed by both sides.
   4. Move-out settlement with the seven-day promise, shown for the option the tenant chose.
   5. Self-guided viewing wording on the viewing confirmation.
   6. Rent first: the demo opens in Rent and the Buy switch is hidden (CONFIG.rentOnly).

  The deposit rules, all from the plan (Sections 2.1, 6.1, 6.3, 7 and Appendix A):
    Deposit        5% of the annual rent for an unfurnished home, 10% for a furnished one.
    Deposit Pass   18% of that deposit, minimum AED 499, paid once for the year. Not refunded.
                   Each renewal year costs 60% of the first-year fee. The guarantee equals the deposit.
    Held Deposit   The whole deposit, paid once into escrow. No fee, nothing recurring. Returned at
                   move-out less make-good and damage.
    Make-good      Expected at 25% of the deposit (the plan's model input).
  The deposit on the tenancy screen is recalculated with this formula. Nothing here takes a payment or
  contacts a partner; it is a preview.
*/
(function () {
  'use strict';
  if (window.__dhPlanFlow) return;
  window.__dhPlanFlow = true;

  var CONFIG = {
    rentOnly: true,
    depositRate: 0.05,     /* deposit: 5% of annual rent, unfurnished (plan, Section 2.1) */
    depositRateFurnished: 0.10, /* 10% of annual rent, furnished */
    passRate: 0.18,        /* Deposit Pass fee: 18% of the deposit it replaces (plan, Section 7; judgment) */
    passMin: 499,          /* minimum fee, AED */
    renewalRate: 0.6,      /* renewal costs 60% of the first-year fee */
    makeGoodRate: 0.25,    /* expected make-good: 25% of the deposit (plan, Appendix A; judgment) */
    penalty: 200,          /* seven-day promise penalty, AED */
    fallbackRent: 110000
  };

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function safe(fn) { try { return fn(); } catch (e) { if (window.console) console.warn('[dh plan flow]', e); } }
  function squash(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function aed(n) { return 'AED ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function go(id) { if (window.goPage) window.goPage(id); }
  function leafByText(root, txt) {
    return $$('*', root).filter(function (e) { return e.children.length === 0 && squash(e.textContent) === txt; })[0] || null;
  }

  var S = { choice: null, rooms: {}, confirmed: false, listing: null };

  /* ---------- amounts ---------- */
  function num(t) { var n = parseInt(String(t || '').replace(/[^\d]/g, ''), 10); return n > 0 ? n : 0; }
  function listings() { try { return (typeof LISTINGS !== 'undefined' && Array.isArray(LISTINGS)) ? LISTINGS : []; } catch (e) { return []; } }
  /* the home the user last opened: matched by its title on the detail screen */
  function noteListing() {
    var h = $('#detail-body h1');
    var t = h && squash(h.textContent);
    if (!t) return;
    var l = listings().filter(function (x) { return x.title === t && x.mode !== 'buy'; })[0];
    if (l) S.listing = { title: l.title, rent: l.priceN || num(l.price), furnished: (l.badges || []).some(function (b) { return /^furnished$/i.test(squash(b)); }) };
  }
  /* a labelled AED value on the tenancy screen, e.g. the row "Annual rent" */
  function tenancyValue(re) {
    var ten = document.getElementById('page-tenancy');
    if (!ten) return null;
    var lab = $$('*', ten).filter(function (e) { return e.children.length === 0 && re.test(squash(e.textContent)); })[0];
    var row = lab && lab.parentElement && lab.parentElement.parentElement;
    return row ? $$('*', row).filter(function (e) { return e.children.length === 0 && /^AED\s[\d,]+(\s*\/\s*(yr|year))?$/i.test(squash(e.textContent)); })[0] || null : null;
  }
  function terms() {
    /* the rent agreed on the tenancy wins over the asking rent, because an offer may have changed it */
    var agreed = num((tenancyValue(/^(annual|yearly) rent$|^rent$|^rent per year$/i) || {}).textContent);
    var rent = agreed || (S.listing && S.listing.rent) || 0;
    var furnished = !!(S.listing && S.listing.furnished);
    if (!rent) {
      /* last resort: work back from the deposit the screen first showed, read as 5% of the rent */
      var dv = tenancyValue(/^security deposit$/i);
      var shown = dv ? num(dv.dataset.dhpOrig !== undefined ? dv.dataset.dhpOrig : dv.textContent) : 0;
      rent = shown ? Math.round(shown / CONFIG.depositRate) : CONFIG.fallbackRent;
    }
    return { rent: rent, furnished: furnished };
  }
  function calc(rent, furnished) {
    var rate = furnished ? CONFIG.depositRateFurnished : CONFIG.depositRate;
    var d = Math.round(rent * rate);
    var feeExact = Math.max(CONFIG.passMin, d * CONFIG.passRate);
    var mg = Math.round(d * CONFIG.makeGoodRate);
    var fee = Math.round(feeExact), renewal = Math.round(feeExact * CONFIG.renewalRate);
    return { rent: rent, furnished: furnished, rate: rate, dep: d, fee: fee, renewal: renewal, twoYears: fee + renewal,
      minApplied: d * CONFIG.passRate < CONFIG.passMin, mg: mg, back: d - mg };
  }
  function figures() { var t = terms(); return calc(t.rent, t.furnished); }
  function basis(f) { return (f.rate * 100) + '% of the ' + aed(f.rent) + ' annual rent, ' + (f.furnished ? 'furnished' : 'unfurnished') + ' home'; }

  /* the tenancy screen shows the deposit the plan's formula gives, with the formula under it */
  function tenancyDeposit() {
    var v = tenancyValue(/^security deposit$/i);
    if (!v) return;
    if (v.dataset.dhpOrig === undefined) v.dataset.dhpOrig = v.textContent;
    var f = figures();
    if (squash(v.textContent) !== aed(f.dep)) v.textContent = aed(f.dep);
    var row = v.parentElement, host = row && row.parentElement;
    if (!host) return;
    var note = $('.dhp-basis', host);
    if (!note) {
      note = document.createElement('div');
      note.className = 'dhp-basis';
      note.style.cssText = 'font-size:12px;color:var(--muted,#5b6676);margin:2px 0 6px';
      host.insertBefore(note, row.nextSibling);
    }
    if (note) note.textContent = 'Deposit: ' + basis(f) + '.';
  }

  /* ---------- styles ---------- */
  safe(function () {
    var css = [
      '.dhp{padding:16px 16px 28px;color:var(--ink,#1c2533);font-size:14px;line-height:1.5}',
      '.dhp h2{font-family:var(--display,Tinos,"Times New Roman",serif);font-size:21px;line-height:1.2;color:var(--navy,#143969);margin:0 0 6px;font-weight:700}',
      '.dhp p{margin:0 0 12px}',
      '.dhp .dhp-muted{color:var(--muted,#5b6676);font-size:13px}',
      '.dhp-opt{background:var(--card,#fff);border:1.5px solid var(--line,#dfe4ec);border-radius:14px;padding:16px;margin:0 0 14px}',
      '.dhp-opt.dhp-lead{border-color:var(--navy,#143969)}',
      '.dhp-tag{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7A5C1E;background:var(--gold-tint,#F5F0E1);border-radius:999px;padding:3px 10px}',
      '.dhp-name{font-family:var(--display,Tinos,"Times New Roman",serif);font-size:20px;font-weight:700;color:var(--navy,#143969);margin:10px 0 2px}',
      '.dhp-big{font-family:var(--display,Tinos,"Times New Roman",serif);font-size:26px;font-weight:700;color:var(--navy,#143969);font-variant-numeric:tabular-nums}',
      '.dhp-big small{display:block;font-family:Manrope,system-ui,sans-serif;font-size:13px;line-height:1.45;font-weight:400;color:var(--muted,#5b6676);margin-top:2px}',
      '.dhp ul{margin:10px 0 14px;padding:0 0 0 18px}',
      '.dhp li{margin:0 0 6px}',
      '.dhp-btn{display:block;width:100%;box-sizing:border-box;border:0;border-radius:10px;padding:13px 14px;font:inherit;font-weight:700;font-size:15px;cursor:pointer;background:var(--navy,#143969);color:#fff;text-align:center}',
      '.dhp-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.dhp-btn.dhp-ghost{background:transparent;color:var(--navy,#143969);border:1.5px solid var(--navy,#143969)}',
      '.dhp-btn+.dhp-btn{margin-top:10px}',
      '.dhp-btn:focus-visible,.dhp-room button:focus-visible{outline:3px solid #C9A961;outline-offset:2px}',
      '.dhp-note{background:var(--gold-tint,#F5F0E1);border:1px solid var(--gold-soft,#E4D6AE);border-radius:12px;padding:12px 14px;font-size:13px;margin:0 0 14px}',
      '.dhp-note b{color:var(--navy,#143969)}',
      '.dhp-rows{background:var(--card,#fff);border:1px solid var(--line,#dfe4ec);border-radius:14px;padding:4px 14px;margin:0 0 14px}',
      '.dhp-row{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--line,#dfe4ec)}',
      '.dhp-row:last-child{border-bottom:0}',
      '.dhp-row span:first-child{color:var(--muted,#5b6676)}',
      '.dhp-row span:last-child{font-weight:700;color:var(--navy,#143969);text-align:right;font-variant-numeric:tabular-nums}',
      '.dhp-row.dhp-total span{color:var(--navy,#143969);font-weight:700}',
      '.dhp-steps{counter-reset:dhp;list-style:none;padding:0;margin:0 0 14px}',
      '.dhp-steps li{counter-increment:dhp;position:relative;padding:0 0 0 38px;margin:0 0 14px}',
      '.dhp-steps li:before{content:counter(dhp);position:absolute;left:0;top:0;width:26px;height:26px;border-radius:50%;background:var(--navy,#143969);color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center}',
      '.dhp-check{display:flex;gap:10px;align-items:flex-start;margin:0 0 14px;font-weight:600;color:var(--navy,#143969)}',
      '.dhp-check input{width:20px;height:20px;margin:1px 0 0;flex:none;accent-color:#143969}',
      '.dhp-ok{width:56px;height:56px;border-radius:50%;background:#10B981;color:#fff;font-size:28px;display:flex;align-items:center;justify-content:center;margin:6px auto 12px}',
      '.dhp-center{text-align:center}',
      '.dhp-ref{display:inline-block;font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:13px;background:var(--gold-tint,#F5F0E1);border-radius:8px;padding:5px 10px;margin:4px 0 16px;color:var(--navy,#143969)}',
      '.dhp-room{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line,#dfe4ec)}',
      '.dhp-room:last-child{border-bottom:0}',
      '.dhp-room b{color:var(--navy,#143969)}',
      '.dhp-room small{display:block;color:var(--muted,#5b6676);font-size:12px}',
      '.dhp-room button{border:1.5px solid var(--navy,#143969);background:transparent;color:var(--navy,#143969);border-radius:999px;padding:7px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}',
      '.dhp-room .dhp-done{color:#0B7A55;font-weight:700;font-size:13px;white-space:nowrap}',
      '.dhp-tblwrap{overflow-x:auto;margin:0 0 14px}',
      '.dhp-tbl{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums;background:var(--card,#fff);border:1px solid var(--line,#dfe4ec);border-radius:12px}',
      '.dhp-tbl th,.dhp-tbl td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line,#dfe4ec);vertical-align:top}',
      '.dhp-tbl tr:last-child td{border-bottom:0}',
      '.dhp-tbl th{font-size:12px;color:var(--muted,#5b6676);font-weight:700}',
      '.dhp-tbl td:first-child{color:var(--muted,#5b6676)}',
      '.dhp-tbl td+td{font-weight:700;color:var(--navy,#143969)}',
      '.dhp-h{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line,#dfe4ec);background:var(--card,#fff)}',
      '.dhp-h h1{font-family:var(--display,Tinos,"Times New Roman",serif);font-size:18px;margin:0;color:var(--navy,#143969)}',
      '.dhp-scroll{overflow-y:auto;flex:1}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'dh-plan-flow-style';
    st.textContent = css;
    document.head.appendChild(st);
  });

  /* ---------- page shell ---------- */
  function ensurePage(id, title) {
    var pg = document.getElementById(id);
    if (pg) return $('.dhp', pg);
    var anchor = document.getElementById('page-tenancy') || $('.page');
    if (!anchor) return null;
    var tpl = document.getElementById('page-ejari-success');
    var body;
    pg = document.createElement('div');
    pg.className = 'page';
    pg.id = id;
    if (tpl && tpl.children.length >= 2 && $('h1', tpl.children[0])) {
      var hd = tpl.children[0].cloneNode(true);
      $$('[id]', hd).forEach(function (n) { n.removeAttribute('id'); });
      $('h1', hd).textContent = title;
      body = tpl.children[1].cloneNode(false);
      body.removeAttribute('id');
      pg.appendChild(hd);
      pg.appendChild(body);
    } else {
      var h = document.createElement('div');
      h.className = 'dhp-h';
      h.innerHTML = '<h1></h1>';
      h.firstChild.textContent = title;
      body = document.createElement('div');
      body.className = 'dhp-scroll';
      pg.appendChild(h);
      pg.appendChild(body);
    }
    var inner = document.createElement('div');
    inner.className = 'dhp';
    body.appendChild(inner);
    anchor.parentNode.insertBefore(pg, anchor.nextSibling);
    return inner;
  }
  function btn(label, fn, ghost) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'dhp-btn' + (ghost ? ' dhp-ghost' : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }
  function rows(list) {
    return '<div class="dhp-rows">' + list.map(function (r) {
      return '<div class="dhp-row' + (r[2] ? ' dhp-total' : '') + '"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    }).join('') + '</div>';
  }
  var PREVIEW = '<p class="dhp-muted">Preview. The insurer and the escrow partner are not yet appointed, and no payment is taken. Amounts are illustrations based on this home\'s deposit.</p>';
  var MAKEGOOD = 'Make-good is the repainting and minor repairs needed to let the home again.';

  /* ---------- 1. the deposit choice ---------- */
  function renderChoice() {
    var el = ensurePage('page-dhp-choice', 'Your deposit');
    if (!el) return;
    var f = figures();
    el.innerHTML =
      '<h2>The landlord never holds your deposit</h2>' +
      '<p>The deposit on this home is ' + aed(f.dep) + ': ' + basis(f) + '. Today that is a cheque to the landlord, with no rules on when it comes back. Here you choose one of two ways, and both follow written rules.</p>' +
      '<div class="dhp-opt dhp-lead"><span class="dhp-tag">No cash deposit</span>' +
        '<div class="dhp-name">Deposit Pass</div>' +
        '<div class="dhp-big">' + aed(f.fee) + ' <small>for the year, instead of ' + aed(f.dep) + ' in cash</small></div>' +
        '<ul><li>You keep ' + aed(f.dep) + ' in your account on moving day.</li>' +
        '<li>The landlord receives a guarantee for ' + aed(f.dep) + ', backed by a licensed insurer.</li>' +
        '<li>The fee is 18% of the deposit' + (f.minApplied ? ', with a minimum of ' + aed(CONFIG.passMin) : '') + '. It is paid once for the year and is not refunded.</li>' +
        '<li>Each renewal year costs ' + aed(f.renewal) + ', which is 60% of the first-year fee.</li>' +
        '<li>Make-good and any damage are still owed when you move out.</li></ul>' +
        '<div data-slot="pass"></div></div>' +
      '<div class="dhp-opt"><span class="dhp-tag">No fee</span>' +
        '<div class="dhp-name">Held Deposit</div>' +
        '<div class="dhp-big">' + aed(f.dep) + ' <small>into escrow, returned when you move out</small></div>' +
        '<ul><li>Paid once. There is no fee and nothing to pay at renewal.</li>' +
        '<li>A bank or licensed trustee holds it. Neither you nor the landlord can move it.</li>' +
        '<li>It is released by the move-in record and the make-good schedule.</li>' +
        '<li>The landlord\'s share is paid within 7 days. Your balance returns the same day.</li></ul>' +
        '<div data-slot="held"></div></div>' +
      '<h2 style="font-size:18px;margin-top:4px">What you pay, and when</h2>' +
      '<div class="dhp-tblwrap"><table class="dhp-tbl"><tr><th></th><th>Deposit Pass</th><th>Held Deposit</th></tr>' +
        '<tr><td>Today</td><td>' + aed(f.fee) + '</td><td>' + aed(f.dep) + '</td></tr>' +
        '<tr><td>Each renewal year</td><td>' + aed(f.renewal) + '</td><td>AED 0</td></tr>' +
        '<tr><td>Fees over two years</td><td>' + aed(f.twoYears) + '</td><td>AED 0</td></tr>' +
        '<tr><td>At move-out</td><td>You pay make-good, about ' + aed(f.mg) + '</td><td>You get back about ' + aed(f.back) + '</td></tr>' +
      '</table></div>' +
      '<div class="dhp-note"><b>Make-good.</b> ' + MAKEGOOD + ' The amount is agreed at signing, so it is known at the start under both options. The figure here is 25% of the deposit, and any damage is charged on top.</div>' +
      PREVIEW;
    $('[data-slot="pass"]', el).appendChild(btn('Choose Deposit Pass', function () { S.choice = 'pass'; renderConfirm(); go('page-dhp-confirm'); }));
    $('[data-slot="held"]', el).appendChild(btn('Choose Held Deposit', function () {
      S.choice = 'held';
      if (window.dhFundRent) window.dhFundRent(); else go('page-fund-deposit');
    }, true));
  }

  /* ---------- 2. Deposit Pass: what the tenant confirms before paying ---------- */
  function renderConfirm() {
    var el = ensurePage('page-dhp-confirm', 'Before you pay');
    if (!el) return;
    var f = figures();
    el.innerHTML =
      '<h2>Three things to confirm</h2>' +
      '<ol class="dhp-steps">' +
        '<li><b>The ' + aed(f.fee) + ' fee is not refunded.</b> It is the price of keeping ' + aed(f.dep) + ' in your account.</li>' +
        '<li><b>Make-good and any damage are still owed when you move out.</b> ' + MAKEGOOD + '</li>' +
        '<li><b>Expected make-good for this home after 12 months: about ' + aed(f.mg) + '.</b> It follows a published schedule and falls the longer you stay.</li>' +
      '</ol>' +
      rows([['Pay today, for year 1', aed(f.fee)], ['Each renewal year', aed(f.renewal)], ['Cash deposit', 'AED 0'], ['Guarantee to the landlord', aed(f.dep)], ['Expected at move-out', 'about ' + aed(f.mg)]]) +
      '<p class="dhp-muted">The fee is 18% of the ' + aed(f.dep) + ' deposit' + (f.minApplied ? ', raised to the ' + aed(CONFIG.passMin) + ' minimum' : '') + '. The deposit is ' + basis(f) + '.</p>' +
      '<label class="dhp-check"><input type="checkbox" id="dhp-agree"><span>I have read and understood these three points.</span></label>' +
      '<div data-slot="pay"></div>' + PREVIEW;
    var pay = btn('Confirm and pay ' + aed(f.fee), function () {
      if (window.showToast) window.showToast('Deposit Pass active', 'Guarantee issued to the landlord', '✓');
      renderActive();
      go('page-dhp-active');
    });
    pay.disabled = true;
    $('#dhp-agree', el).addEventListener('change', function (ev) { pay.disabled = !ev.target.checked; });
    var slot = $('[data-slot="pay"]', el);
    slot.appendChild(pay);
    slot.appendChild(btn('Back to the two options', function () { go('page-dhp-choice'); }, true));
  }

  /* ---------- 2b. Deposit Pass active ---------- */
  function renderActive() {
    var el = ensurePage('page-dhp-active', 'Deposit Pass');
    if (!el) return;
    var f = figures();
    el.innerHTML =
      '<div class="dhp-center"><div class="dhp-ok" aria-hidden="true">✓</div>' +
      '<h2>Deposit Pass active</h2>' +
      '<p>No cash deposit paid. The landlord is guaranteed for ' + aed(f.dep) + '.</p>' +
      '<div class="dhp-ref">DH-PASS-2026-1402</div></div>' +
      rows([['Guarantee amount', aed(f.dep)], ['Fee paid for year 1', aed(f.fee)], ['Renewal, each further year', aed(f.renewal)], ['Term', '12 months, fixed for the full term'],
        ['Linked to', 'Ejari number, added at registration'], ['Valid claims', 'Paid within 7 days']]) +
      '<div class="dhp-note"><b>Seven-day promise.</b> A valid claim is paid to the landlord within 7 days, or the landlord receives ' + aed(CONFIG.penalty) + '.</div>' +
      '<div data-slot="next"></div>';
    var slot = $('[data-slot="next"]', el);
    slot.appendChild(btn('Record move-in condition', function () { renderRecord(); go('page-dhp-record'); }));
    slot.appendChild(btn('Continue to Ejari booking', function () { go('page-ejari-booking'); }, true));
  }

  /* ---------- 3. move-in condition record ---------- */
  var ROOMS = ['Living room', 'Kitchen', 'Bedroom', 'Bathroom', 'Balcony'];
  function stamp() {
    var d = new Date(), M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getDate() + ' ' + M[d.getMonth()] + ' ' + d.getFullYear() + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function renderRecord() {
    var el = ensurePage('page-dhp-record', 'Move-in record');
    if (!el) return;
    var done = ROOMS.filter(function (r) { return S.rooms[r]; }).length;
    el.innerHTML =
      '<h2>Record the home before you move in</h2>' +
      '<p>Photograph each room. You and the landlord confirm the same record, and it is the evidence for any claim when you move out.</p>' +
      '<div class="dhp-rows" data-slot="rooms"></div>' +
      '<p class="dhp-muted" aria-live="polite">' + done + ' of ' + ROOMS.length + ' rooms recorded.</p>' +
      '<div data-slot="confirm"></div>';
    var list = $('[data-slot="rooms"]', el);
    ROOMS.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'dhp-room';
      var left = document.createElement('div');
      left.innerHTML = '<b></b><small></small>';
      left.children[0].textContent = r;
      left.children[1].textContent = S.rooms[r] ? '6 photos, ' + S.rooms[r] : 'No photos yet';
      row.appendChild(left);
      if (S.rooms[r]) {
        var ok = document.createElement('span');
        ok.className = 'dhp-done';
        ok.textContent = 'Recorded';
        row.appendChild(ok);
      } else {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Add photos';
        b.setAttribute('aria-label', 'Add photos of the ' + r.toLowerCase());
        b.addEventListener('click', function () { S.rooms[r] = stamp(); renderRecord(); });
        row.appendChild(b);
      }
      list.appendChild(row);
    });
    var slot = $('[data-slot="confirm"]', el);
    if (S.confirmed) {
      slot.innerHTML = '<div class="dhp-note"><b>Record confirmed by both sides.</b> You confirmed it, and the landlord confirmed it. In this preview the landlord\'s confirmation is simulated.</div>';
      slot.appendChild(btn('See how move-out is settled', function () { renderMoveOut(); go('page-dhp-moveout'); }));
    } else {
      var c = btn('Confirm the record', function () { S.confirmed = true; renderRecord(); });
      c.disabled = done < ROOMS.length;
      slot.appendChild(c);
      if (done < ROOMS.length) {
        slot.appendChild(btn('Record all rooms (preview shortcut)', function () {
          ROOMS.forEach(function (r) { if (!S.rooms[r]) S.rooms[r] = stamp(); });
          renderRecord();
        }, true));
      }
    }
  }

  /* ---------- 4. move-out settlement ---------- */
  function renderMoveOut() {
    var el = ensurePage('page-dhp-moveout', 'Move-out settlement');
    if (!el) return;
    var f = figures();
    var pass = '<div class="dhp-opt"><span class="dhp-tag">Deposit Pass</span><ul>' +
      '<li>The insurer pays the landlord ' + aed(f.mg) + ' within 7 days.</li>' +
      '<li>You settle ' + aed(f.mg) + ' with DirectHomes, in one payment or in instalments.</li>' +
      '<li>There is no deposit to chase, because you never paid one.</li></ul></div>';
    var held = '<div class="dhp-opt"><span class="dhp-tag">Held Deposit</span><ul>' +
      '<li>' + aed(f.mg) + ' is released from escrow to the landlord within 7 days.</li>' +
      '<li>' + aed(f.back) + ' returns to your account the same day.</li></ul></div>';
    el.innerHTML =
      '<h2>Settled on the record, not by argument</h2>' +
      '<p>Example: the end of a 12-month tenancy. Both sides see the same photos, the same schedule and the same arithmetic.</p>' +
      rows([['Fair wear and tear', 'Not charged'], ['Make-good, per the schedule', aed(f.mg)], ['Damage against the move-in record', 'AED 0'], ['Owed to the landlord', aed(f.mg), true]]) +
      (S.choice === 'pass' ? pass : S.choice === 'held' ? held : pass + held) +
      '<div class="dhp-note"><b>Seven-day promise.</b> A valid claim is paid, or a deposit released, within 7 days of sign-off, or ' + aed(CONFIG.penalty) + ' is paid. A tenant who disputes a charge gets a free review, decided within 10 days.</div>' +
      '<p class="dhp-muted">Fair wear and tear, such as scuffs and faded paint after normal use, stays with the landlord, as the law already provides. ' + MAKEGOOD + '</p>' +
      '<div data-slot="end"></div>' + PREVIEW;
    $('[data-slot="end"]', el).appendChild(btn('Back to browse', function () { go('page-home'); }));
  }

  /* ---------- entry: the card on the signed tenancy ---------- */
  function entryCard() {
    var sec = document.getElementById('ten-ejari-section');
    if (!sec) return;
    var c = $('.dh-rentdep', sec);
    if (!c) {
      c = document.createElement('div');
      c.className = 'info-card dh-rentdep';
      c.style.margin = '0 0 14px';
      sec.insertBefore(c, sec.firstChild);
      sec.dataset.dhRent = '1';
    }
    c.dataset.dhp = '1';
    var f = figures();
    c.innerHTML = '<div class="lbl-tiny">NEXT STEP BEFORE EJARI</div>' +
      '<div style="font-weight:700;color:var(--navy,#143969);font-size:15px;margin-top:6px">Choose how your deposit is handled</div>' +
      '<div style="color:var(--muted,#5b6676);font-size:13px;line-height:1.5;margin:4px 0 12px">Replace the ' + aed(f.dep) + ' deposit with a Deposit Pass for ' + aed(f.fee) + ' in the first year and ' + aed(f.renewal) + ' each year after, or place it in escrow once at no charge. The landlord never holds it.</div>';
    c.appendChild(btn('See the two options', function () { renderChoice(); go('page-dhp-choice'); }));
  }

  /* ---------- Held Deposit: wording on the existing funding screens ---------- */
  function heldWording(id) {
    if (S.choice !== 'held') return;
    var pg = document.getElementById(id);
    if (!pg || pg.dataset.dhpHeld) return;
    pg.dataset.dhpHeld = '1';
    var host = $('.calm-actions', pg) || $('.btn-primary', pg);
    if (id === 'page-aman-confirmed' && host && host.parentNode) {
      var b = btn('Record move-in condition', function () { renderRecord(); go('page-dhp-record'); }, true);
      b.style.marginTop = '10px';
      host.parentNode.insertBefore(b, host.nextSibling);
    }
  }

  /* ---------- deal flow: tenancy record card ---------- */
  function trackerCard() {
    var pg = document.getElementById('page-tracker');
    var tl = pg && $('.timeline', pg);
    if (!tl || !S.choice) return;
    var card = $('.dhp-track', pg);
    if (!card) {
      card = document.createElement('div');
      card.className = 'info-card dhp-track';
      card.style.margin = '14px 16px 0';
      tl.parentNode.insertBefore(card, tl);
    }
    card.innerHTML = '<div class="lbl-tiny">YOUR DEPOSIT</div>' +
      '<div style="font-weight:700;color:var(--navy,#143969);font-size:14px;margin:6px 0 10px"></div>';
    card.children[1].textContent = S.choice === 'pass' ? 'Deposit Pass active. No cash deposit paid.' : 'Held Deposit in escrow, released by the record.';
    card.appendChild(btn(S.confirmed ? 'View the move-in record' : 'Record move-in condition', function () { renderRecord(); go('page-dhp-record'); }, true));
    card.appendChild(btn('See how move-out is settled', function () { renderMoveOut(); go('page-dhp-moveout'); }, true));
  }

  /* ---------- 5. self-guided viewing ---------- */
  function selfGuided() {
    var pg = document.getElementById('page-viewing-confirmed');
    if (!pg || (window.STATE && STATE.mode && STATE.mode !== 'rent')) return;
    var st = $$('strong', pg).filter(function (s) { return /What happens next/.test(s.textContent); })[0];
    if (st && st.parentElement && !st.parentElement.dataset.dhp) {
      st.parentElement.dataset.dhp = '1';
      st.parentElement.innerHTML = '<strong>Self-guided viewing:</strong> for a vacant home you receive a one-time access code shortly before your slot and check in with a selfie against your Emirates ID. The code works once. The landlord gets the record of your visit and sees only your name and verification status.';
    }
  }

  /* ---------- 6. rent first ---------- */
  function rentFirst() {
    if (!CONFIG.rentOnly) return;
    if (window.STATE && STATE.mode && STATE.mode !== 'rent') {
      STATE.mode = 'rent';
      if (typeof window.renderHomeList === 'function') window.renderHomeList();
    }
    ['page-home', 'page-onboard'].forEach(function (id) {
      var pg = document.getElementById(id);
      if (!pg) return;
      $$('[onclick]', pg).forEach(function (e) {
        if (e.dataset.dhpHide) return;
        var t = squash(e.textContent);
        if (/^(Buy|For sale|Sell)$/i.test(t) && /buy|sale|sell/i.test(e.getAttribute('onclick') || '')) {
          e.dataset.dhpHide = '1';
          e.style.display = 'none';
        }
      });
    });
  }

  /* ---------- wiring ---------- */
  function onPage(id) {
    safe(noteListing);
    safe(tenancyDeposit);
    safe(entryCard);
    safe(rentFirst);
    if (id === 'page-viewing-confirmed') safe(selfGuided);
    if (id === 'page-tracker') safe(trackerCard);
    if (id === 'page-fund-deposit' || id === 'page-aman-confirmed') safe(function () { heldWording(id); });
  }
  safe(function () {
    var og = window.goPage;
    if (typeof og !== 'function') return;
    window.goPage = function (id) {
      var r = og.apply(this, arguments);
      onPage(id);
      return r;
    };
  });
  window.dhPlanFlow = {
    open: function (id) { renderChoice(); renderConfirm(); renderActive(); renderRecord(); renderMoveOut(); go(id || 'page-dhp-choice'); },
    state: S, config: CONFIG, figures: figures, calc: calc
  };
  safe(function () { onPage(($('.page.active') || {}).id); });
})();
