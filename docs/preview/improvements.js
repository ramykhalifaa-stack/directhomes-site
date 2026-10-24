/*
  DirectHomes app preview: proposed improvements (for review, not deployed)

  How to use: paste into the browser console on the preview page, or add at the end of the
  preview's main script. Reloading the page removes it, so the original is always one refresh away.

  What it does
   1. Picker fix: date and time cards highlight when tapped (frozen picker).
   2. Viewing: real upcoming dates, quick time chips, correct selection carried to confirmation.
   3. New "Viewing confirmed" page, built from the existing Ejari confirmation components,
      with Add to calendar and an Upcoming viewing card on the deal flow.
   4. Claims: the escrow bank is shown as Emirates NBD everywhere (CONFIG.bankName),
      two unsourced statistics removed, home trust checklist reduced to one line marked as a preview.
   5. Repetition: home cards keep one badge and one savings line, the lower duplicate deposit box on
      property detail is hidden, the offer confirmation escrow tile is collapsed behind a link.
   6. Home order: listings sit directly under the trust line; the insurance banner moves below the list.
   7. Moments: a short celebration on Viewing confirmed and Offer sent (respects reduced motion).
   8. Back button: a back arrow at the top left of every page that does not already have one.
   9. Type system: sizes snapped to one scale (Manrope 12/13/14/16/18, Fraunces 13/15/17/20/22/24/26),
      extra-heavy weights evened out, stray serif text fixed; the font families themselves are unchanged.
  10. Headline: set in Tinos Bold (a Times New Roman lookalike), one weight on all three lines, clean "f".
  11. Category chips: All, Apartment, Villa, Townhouse, Studio and Penthouse filter the home list; demo
      listings added so each type has at least two in Buy and in Rent.
  12. Legibility: text under 12px raised to 12px, gold and light grey text darkened to meet 4.5:1,
      "In short" cards on the MOU, tenancy and insurance screens.

  Not included (needs data, decisions or the website's source): live social proof, saved search alerts,
  analytics and the "how sure do you feel" question, the claims audit sign-off, all website changes.
*/
(function () {
  'use strict';
  if (window.__dhPreviewImprovements) return;
  window.__dhPreviewImprovements = true;

  var CONFIG = { bankName: 'Emirates NBD' };

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function safe(fn) { try { fn(); } catch (e) { if (window.console) console.warn('[dh preview]', e); } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function squash(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }

  /* ---------- styles ---------- */
  safe(function () {
    var css = [
      '#home-list .card-pill-aman{display:none!important}',
      '#home-list .prop-savings .ps-sub{display:none!important}',
      '#home-list .prop-card:not(:first-child) .prop-savings{display:none!important}',
      '.dh-one-line .ts-claim:not(:first-child){display:none}',
      '#page-offer-success .no-cheque-tile{cursor:pointer}',
      '#page-offer-success .no-cheque-tile .nct-sub{display:none}',
      '#page-offer-success .no-cheque-tile.dh-open .nct-sub{display:block}',
      '.dh-hint{display:block;margin-top:4px;font-size:12px;font-weight:600;color:var(--navy)}',
      '#page-offer-success .no-cheque-tile.dh-open .dh-hint{display:none}',
      '@keyframes dhPop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.12);opacity:1}100%{transform:scale(1);opacity:1}}',
      '@keyframes dhRing{0%{box-shadow:0 0 0 0 rgba(16,185,129,.45)}100%{box-shadow:0 0 0 22px rgba(16,185,129,0)}}',
      '.page.active .calm-check,.page.active .success-icon{animation:dhPop .5s cubic-bezier(.2,.9,.3,1.2) both,dhRing .9s .25s ease-out 1 both}',
      '@media (prefers-reduced-motion:reduce){.page.active .calm-check,.page.active .success-icon{animation:none}}',
      ':root{--muted-2:#667182}',
      '.dh-short{margin:14px 16px 0;padding:12px 14px;background:var(--gold-tint);border:1px solid var(--gold-soft);border-radius:12px;font-size:13px;line-height:1.55;color:var(--ink)}',
      '.dh-short b{color:var(--navy)}',
      '.mou-page > .dh-short{margin:0 0 14px}',
      '.dh-quick{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}',
      '.dh-quick .dh-chip{padding:8px 12px;border-radius:999px;border:1.5px solid var(--line);background:var(--card);color:var(--navy);font-size:12.5px;font-weight:600;cursor:pointer}',
      '.dh-quick .dh-chip:active{transform:scale(.96)}',
      '.dh-extra{margin-top:10px}',
      '.dh-upcoming{margin:14px 16px 0}',
      '.dh-back-wrap{position:relative;height:0;z-index:60;overflow:visible}',
      '.dh-back-wrap .dh-back{position:absolute;top:12px;left:14px;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;padding:0;border:0;background:#fff;box-shadow:0 2px 10px rgba(0,15,45,.22);color:var(--navy)}',
      '.mct-v{white-space:nowrap}',
      '#page-home .hero-line-1,#page-home .hero-line-2,#page-home .hero-line-3{font-family:Tinos,"Times New Roman",Times,serif;font-weight:700;font-size:29px;letter-spacing:0;line-height:1.14;font-synthesis:none;font-variant-ligatures:none}',
      '#page-home .hero-line-2 .gold{font-style:normal}',
      '#page-home .dh-hero-shift{padding-left:46px!important}'
    ].join('\n');
    /* Tinos is a Times New Roman lookalike, so the headline looks the same on every device */
    var fl = document.createElement('link');
    fl.rel = 'stylesheet';
    fl.href = 'https://fonts.googleapis.com/css2?family=Tinos:wght@700&display=swap';
    document.head.appendChild(fl);
    var st = document.createElement('style');
    st.id = 'dh-preview-style';
    st.textContent = css;
    document.head.appendChild(st);
  });

  /* ---------- 4. claims: wording ---------- */
  function fixText(t) {
    var o = t;
    /* the escrow partner is shown as Emirates NBD; a list of accepted banks keeps its own names */
    if (CONFIG.bankName && !/\b(?:ADCB|ADIB|RAKBANK)\b/.test(t)) {
      t = t.replace(/\bMashreq(?: Bank)?(?= Escrow\b)/g, CONFIG.bankName)
           .replace(/\bMashreq(?: Bank)?/g, CONFIG.bankName);
    }
    t = t.replace(/\s*Most accepted offers come in between 90% and 100%(?: of asking)?\./g, '')
         .replace(/\s*We can help you compare offers from 6 UAE banks\./g, '');
    return t === o ? o : t;
  }
  function sanitizeText(n) {
    var v = n.nodeValue;
    if (!v || !/Mashreq|Most accepted offers|6 UAE banks/.test(v)) return;
    /* the mortgage comparison already lists Emirates NBD, so its second bank is shown as CBD Bank */
    var pe = n.parentElement;
    if (pe && pe.classList && pe.classList.contains('mc-bank-name') && /Mashreq/.test(v)) { n.nodeValue = 'CBD Bank'; return; }
    var nv = fixText(v);
    if (nv !== v) n.nodeValue = nv;
  }
  function sanitize(root) {
    if (root.nodeType === 3) { sanitizeText(root); return; }
    if (root.nodeType !== 1) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n, list = [];
    while ((n = w.nextNode())) { if (/Mashreq|Most accepted offers|6 UAE banks/.test(n.nodeValue)) list.push(n); }
    list.forEach(sanitizeText);
  }

  /* ---------- 6 and 4. home ---------- */
  function homeLayout() {
    var strips = $$('#page-home .trust-strip-stack');
    var s = strips[0];
    if (s && !s.dataset.dh) {
      s.dataset.dh = '1';
      s.classList.add('dh-one-line');
      var t = $('.ts-claim-text', s);
      if (t) t.textContent = 'Verified owners, government record checks and bank-held deposits';
      var foot = $('.ts-claim-foot', s);
      if (foot) foot.textContent = 'Preview: integrations are planned. Learn more ›';
    }
    var list = $('#home-list');
    var ins = strips[1];
    if (list && ins && !ins.dataset.dhMoved) {
      ins.dataset.dhMoved = '1';
      list.parentNode.insertBefore(ins, list.nextSibling);
    }
  }

  /* ---------- 5. detail: lower duplicate deposit box ---------- */
  function hideDupAman() {
    var body = $('#detail-body');
    if (!body) return;
    $$('div', body).forEach(function (d) {
      if (d.dataset.dhDup) return;
      var t = squash(d.textContent);
      if (/^(\S{0,3}\s*)?Aman Deposit protected\./.test(t) && t.length < 240) {
        var el = d;
        while (el.parentElement && el.parentElement !== body && squash(el.parentElement.textContent) === t) el = el.parentElement;
        el.style.display = 'none';
        el.dataset.dhDup = '1';
        d.dataset.dhDup = '1';
      }
    });
  }

  /* ---------- 5. offer confirmation tile ---------- */
  function offerTile() {
    var t = $('#page-offer-success .no-cheque-tile');
    if (!t || t.dataset.dh) return;
    t.dataset.dh = '1';
    var body = $('.nct-body', t) || t;
    var hint = document.createElement('span');
    hint.className = 'dh-hint';
    hint.textContent = 'How your deposit is protected ›';
    body.appendChild(hint);
    t.addEventListener('click', function () { t.classList.toggle('dh-open'); });
  }

  /* ---------- 8. summary cards ---------- */
  function shortCards() {
    var defs = [
      /* MOU and tenancy already open with a "What is this?" box, so no summary card is added there */
      ['page-insurance', '.ins-why', 'before',
        '<b>In short:</b> this cover is optional. You can add it in a couple of taps, only if you want it, and DirectHomes does not charge you extra for it.']
    ];
    defs.forEach(function (d) {
      var pg = document.getElementById(d[0]);
      if (!pg || pg.dataset.dhShort) return;
      var anchor = $(d[1], pg);
      if (!anchor) return;
      var card = document.createElement('div');
      card.className = 'dh-short';
      card.innerHTML = d[3];
      if (d[2] === 'prepend') anchor.insertBefore(card, anchor.firstChild);
      else anchor.parentNode.insertBefore(card, anchor);
      pg.dataset.dhShort = '1';
    });
  }

  /* ---------- 8. legibility ---------- */
  function darkBg(e) {
    while (e && e !== document.body) {
      var cs0 = getComputedStyle(e);
      var c = cs0.backgroundColor;
      /* hero areas paint their navy with a gradient image, so read the first colour stop */
      var bi = cs0.backgroundImage;
      if (bi && bi.indexOf('gradient') > -1) {
        var gm = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bi);
        if (gm) return ((0.2126 * +gm[1] + 0.7152 * +gm[2] + 0.0722 * +gm[3]) / 255) < 0.45;
      }
      var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
      if (m && (m[4] === undefined || parseFloat(m[4]) > 0.5)) {
        var l = (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
        return l < 0.45;
      }
      e = e.parentElement;
    }
    return false;
  }
  function legibility(root) {
    if (!root) return;
    $$('*', root).forEach(function (e) {
      if (e.children.length || !squash(e.textContent) || e.closest('svg')) return;
      var cs = getComputedStyle(e);
      var fs = parseFloat(cs.fontSize);
      if (fs < 12 && !e.dataset.dhFs) { e.style.fontSize = '12px'; e.dataset.dhFs = '1'; }
      if ((cs.color === 'rgb(184, 148, 90)' || cs.color === 'rgb(212, 180, 131)') && !e.dataset.dhGold && !darkBg(e)) {
        e.style.color = '#7A5C1E';
        e.dataset.dhGold = '1';
      }
    });
  }

  /* ---------- 1 and 2. pickers ---------- */
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function mark(el) {
    Array.prototype.forEach.call(el.parentElement.children, function (c) { c.classList.remove('sel', 'selected'); });
    el.classList.add(el.classList.contains('date-pill') ? 'selected' : 'sel');
  }
  safe(function () {
    var od = window.selDate, ot = window.selTime;
    window.selDate = function (el) { try { od && od.call(this, el); } catch (e) {} mark(el); };
    window.selTime = function (el) { try { ot && ot.call(this, el); } catch (e) {} mark(el); };
  });

  function refreshViewing() {
    var box = $('#date-options');
    var host = document.getElementById('page-viewing');
    if (!box || !host) return;
    /* keep the property shown here in step with the property the user just opened */
    var dh1 = $('#detail-body h1');
    if (dh1 && dh1.textContent.trim()) {
      var pn = document.getElementById('viewing-prop-name');
      var pp = document.getElementById('viewing-prop-price');
      if (pn) pn.textContent = dh1.textContent.trim();
      var priceEl = $$('#detail-body div').filter(function (e) {
        return e.children.length === 0 && /^AED\s[\d,]+/.test(e.textContent.trim());
      })[0];
      if (pp && priceEl) pp.textContent = priceEl.textContent.trim();
    }
    var cards = $$('.option-card', box);
    var times = $$('.option-card[onclick*="selTime"]', host);
    var now = new Date();
    var days = cards.map(function (c, i) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1 + i);
      if (c.children.length >= 3) {
        c.children[0].textContent = DOW[d.getDay()].toUpperCase();
        c.children[1].textContent = String(d.getDate());
        c.children[2].textContent = MON[d.getMonth()];
      }
      c.dataset.iso = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      c.classList.remove('sel', 'selected');
      return d;
    });
    if (cards[0]) cards[0].classList.add('sel');

    var old = $('.dh-quick', host);
    if (old) old.parentNode.removeChild(old);
    if (cards.length < 2 || times.length < 3) return;
    var quick = document.createElement('div');
    quick.className = 'dh-quick';
    [[0, 0], [0, 2], [1, 1]].forEach(function (p) {
      var d = days[p[0]], tEl = times[p[1]];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dh-chip';
      b.textContent = (p[0] === 0 ? 'Tomorrow' : DOW[d.getDay()] + ' ' + d.getDate()) + ', ' + squash(tEl.textContent);
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        window.selDate(cards[p[0]]);
        window.selTime(tEl);
      });
      quick.appendChild(b);
    });
    box.parentNode.insertBefore(quick, box);
  }

  /* ---------- 3. confirmation page ---------- */
  var viewing = null;
  function buildConfirmation() {
    var tpl = document.getElementById('page-ejari-success');
    var host = document.getElementById('page-viewing');
    if (!tpl || !host || document.getElementById('page-viewing-confirmed')) return;
    var pg = tpl.cloneNode(true);
    pg.id = 'page-viewing-confirmed';
    pg.classList.remove('active');
    pg.querySelectorAll('[id]').forEach(function (n) { n.removeAttribute('id'); });
    pg.children[0].querySelector('h1').textContent = 'Viewing confirmed';

    var body = pg.children[1];
    var calm = $('.calm-success', body);
    $('.calm-status', calm).id = 'vc-status';
    $('.calm-ref span', calm).id = 'vc-ref';
    $('.calm-ref', calm).id = 'vc-ref-pill';

    var btns = $$('.calm-actions button', calm);
    btns[0].textContent = 'View deal flow';
    btns[0].setAttribute('onclick', "goPage('page-tracker')");
    btns[1].textContent = 'Back to browse';
    btns[1].setAttribute('onclick', "goPage('page-home')");

    var cal = document.createElement('button');
    cal.type = 'button';
    cal.id = 'vc-cal';
    cal.className = 'btn btn-ghost btn-block dh-extra';
    cal.textContent = 'Add to calendar';
    cal.addEventListener('click', downloadIcs);
    $('.calm-actions', calm).insertAdjacentElement('afterend', cal);

    $('.calm-foot', calm).textContent = 'You will get a reminder before your viewing. Your contact details stay private.';

    var card = body.children[1];
    $('.lbl-tiny', card).textContent = 'VIEWING DETAILS';
    var rows = Array.prototype.slice.call(card.children, 1);
    var rowTpl = rows[0].cloneNode(true);
    rows.forEach(function (r) { card.removeChild(r); });
    [['Property', 'vc-prop'], ['Asking price', 'vc-price'], ['Date', 'vc-date'], ['Time', 'vc-time'], ['Privacy', 'vc-privacy']]
      .forEach(function (def, i, all) {
        var r = rowTpl.cloneNode(true);
        r.children[0].textContent = def[0];
        r.children[1].id = def[1];
        if (i === all.length - 1) r.style.borderBottom = 'none';
        card.appendChild(r);
      });

    body.children[2].innerHTML = '<strong>What happens next:</strong> the seller is told which slot you picked. They only see your name and verification status until you choose to share more.';
    host.parentNode.insertBefore(pg, host.nextSibling);
  }

  function set(id, text) { var n = document.getElementById(id); if (n) n.textContent = text; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; }

  function utcStamp() {
    var d = new Date();
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }
  function ics(v) {
    var m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(v.time);
    if (!m) return null;
    var h = (+m[1] % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
    var ymd = v.iso.replace(/-/g, '');
    var esc = function (s) { return String(s).replace(/[\\,;]/g, '\\$&').replace(/\n/g, '\\n'); };
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DirectHomes//Viewing//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:' + v.ref + '@directhomes.ae',
      'DTSTAMP:' + utcStamp(),
      'DTSTART;TZID=Asia/Dubai:' + ymd + 'T' + pad(h) + m[2] + '00',
      'DTEND;TZID=Asia/Dubai:' + ymd + 'T' + pad(Math.min(h + 1, 23)) + m[2] + '00',
      'SUMMARY:' + esc('Viewing: ' + v.name),
      'DESCRIPTION:' + esc('Booked through DirectHomes. Reference ' + v.ref + '.'),
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
  }
  function downloadIcs() {
    if (!viewing) return;
    var text = ics(viewing);
    if (!text) return;
    var blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'DirectHomes viewing.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 500);
  }

  window.bookViewing = function () {
    var host = document.getElementById('page-viewing');
    var dateEl = $('#date-options .option-card.sel', host);
    var timeEl = $('.option-card.sel[onclick*="selTime"]', host);
    var parts = dateEl ? Array.prototype.map.call(dateEl.children, function (c) { return c.textContent.trim(); }) : [];
    var dateLabel = parts.length === 3 ? cap(parts[0]) + ' ' + parts[1] + ' ' + parts[2] : 'Date to be confirmed';
    var timeLabel = timeEl ? squash(timeEl.textContent) : 'Time to be confirmed';
    var name = squash((document.getElementById('viewing-prop-name') || {}).textContent) || 'Property';
    var price = squash((document.getElementById('viewing-prop-price') || {}).textContent);
    var ref = 'VIEW-' + String(Math.floor(100000 + Math.random() * 900000));

    viewing = { iso: dateEl ? dateEl.dataset.iso : '', time: timeLabel, label: dateLabel, name: name, ref: ref };

    set('vc-status', 'Viewing booked for ' + (dateLabel + ' at ' + timeLabel).replace(/ /g, ' '));
    set('vc-ref', ref);
    var pill = document.getElementById('vc-ref-pill');
    if (pill) pill.setAttribute('onclick', "copyRef('" + ref + "', this)");
    set('vc-prop', name);
    set('vc-price', price);
    set('vc-date', dateLabel);
    set('vc-time', timeLabel);
    set('vc-privacy', 'Contact details hidden');
    var cal = document.getElementById('vc-cal');
    if (cal) cal.style.display = viewing.iso ? '' : 'none';
    window.goPage('page-viewing-confirmed');
  };

  /* ---------- 3. deal flow: upcoming viewing card ---------- */
  function trackerCard() {
    var pg = document.getElementById('page-tracker');
    if (!pg || !viewing) return;
    var tl = $('.timeline', pg);
    if (!tl) return;
    var card = $('.dh-upcoming', pg);
    if (!card) {
      card = document.createElement('div');
      card.className = 'info-card dh-upcoming';
      tl.parentNode.insertBefore(card, tl);
    }
    card.innerHTML = '<div class="lbl-tiny">UPCOMING VIEWING</div>' +
      '<div style="font-weight:700;color:var(--navy);font-size:14px;margin-top:6px"></div>' +
      '<div style="color:var(--muted);font-size:13px;margin-top:2px"></div>';
    card.children[1].textContent = viewing.name;
    card.children[2].textContent = viewing.label + ' at ' + viewing.time + ' · Ref ' + viewing.ref;
  }

  /* ---------- 9. back button on every page ---------- */
  var backTpl = null;
  function dhGoBack() {
    var cur = $('.page.active');
    var before = cur && cur.id;
    try { if (window.goBack) window.goBack(); } catch (e) {}
    setTimeout(function () {
      var now = $('.page.active');
      if (now && now.id === before) {
        if (before === 'page-home' || before === 'page-onboard') { if (window.showToast) window.showToast('You are at the start'); }
        else if (window.goPage) window.goPage('page-home');
      }
    }, 150);
  }
  window.dhGoBack = dhGoBack;
  function makeBackBtn() {
    if (!backTpl) {
      var src = $('#page-aman-explainer .app-header .icon-btn');
      backTpl = src ? src.cloneNode(true) : null;
    }
    var b;
    if (backTpl) { b = backTpl.cloneNode(true); b.removeAttribute('id'); }
    else { b = document.createElement('button'); b.className = 'icon-btn'; b.textContent = '‹'; }
    b.classList.add('dh-back');
    b.setAttribute('onclick', 'dhGoBack()');
    b.setAttribute('aria-label', 'Go back');
    b.setAttribute('type', 'button');
    return b;
  }
  function backBtn() {
    var pg = $('.page.active');
    if (!pg || pg.id === 'page-onboard' || pg.dataset.dhBack) return;
    pg.dataset.dhBack = '1';
    var r = pg.getBoundingClientRect();
    var own = $$('button,a,[onclick]', pg).some(function (b) {
      if (b.classList.contains('logo') || b.classList.contains('dh-back')) return false;
      var q = b.getBoundingClientRect();
      return q.width > 0 && q.width <= 64 && q.height <= 64 &&
        q.left - r.left < 72 && q.top - r.top < 120;
    });
    if (own) return;
    var btn = makeBackBtn();
    var hdr = $('.app-header', pg);
    if (hdr) { hdr.insertBefore(btn, hdr.firstChild); return; }
    var wrap = document.createElement('div');
    wrap.className = 'dh-back-wrap';
    wrap.appendChild(btn);
    pg.insertBefore(wrap, pg.firstChild);
    var hb = $('.hero-brand', pg);
    if (pg.id === 'page-home' && hb) hb.classList.add('dh-hero-shift');
  }
  function scheduleBack() { setTimeout(function () { safe(backBtn); }, 400); }

  /* ---------- 10. type system ----------
     The app already pairs Fraunces (headings and amounts), Manrope (interface text) and JetBrains Mono
     (references), with Tajawal for Arabic. Those stay. This pass removes the drift around them:
     half-pixel and odd sizes, sub-12px text, extra-heavy weights, and one stray system serif. */
  function snapSans(px) { return px <= 12.4 ? 12 : px <= 13.4 ? 13 : px <= 14.9 ? 14 : px <= 16.9 ? 16 : px <= 19 ? 18 : px; }
  function snapSerif(px) {
    return px <= 13.5 ? 13 : px <= 16 ? 15 : px <= 18.5 ? 17 : px <= 21 ? 20 : px <= 23 ? 22 : px <= 25 ? 24 : px <= 30 ? 26 : px;
  }
  var KEEP_HEAVY = /avatar|logo|emblem|tick|check|dot|icon|badge-new|mc-bank|stamp/i;
  function typography(root) {
    root = root || document.body;
    var els = $$('*', root);
    if (root.nodeType === 1) els.unshift(root);
    els.forEach(function (e) {
      if (e.dataset && e.dataset.dhType) return;
      if (/^(SCRIPT|STYLE|SVG|PATH|G|DEFS|SYMBOL)$/i.test(e.tagName)) return;
      var own = false, k;
      for (k = e.firstChild; k; k = k.nextSibling) { if (k.nodeType === 3 && k.nodeValue.trim()) { own = true; break; } }
      if (!own) return;
      e.dataset.dhType = '1';
      var cs = getComputedStyle(e);
      var fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      var px = parseFloat(cs.fontSize), wt = +cs.fontWeight;
      if (fam === 'Manrope') {
        var s = snapSans(px);
        if (s !== px) e.style.fontSize = s + 'px';
        if (wt >= 800 && !KEEP_HEAVY.test(e.className + '')) e.style.fontWeight = '700';
      } else if (fam === 'Fraunces') {
        var s2 = snapSerif(px);
        if (s2 !== px) e.style.fontSize = s2 + 'px';
        if (wt === 700 && !KEEP_HEAVY.test(e.className + '') && !/pill|dot/.test(e.className + '')) e.style.fontWeight = '600';
      }
    });
    $$('svg text', root).forEach(function (t) {
      if (/serif/i.test(getComputedStyle(t).fontFamily.split(',')[0]) || getComputedStyle(t).fontFamily.indexOf('Manrope') < 0 && getComputedStyle(t).fontFamily.indexOf('Fraunces') < 0) {
        t.style.fontFamily = 'Manrope, sans-serif';
      }
    });
  }

  /* ---------- 11. home category chips ---------- */
  var TYPE = {
    b1: 'villa', b2: 'apartment', b3: 'villa', b4: 'penthouse', b5: 'apartment', b6: 'townhouse', b7: 'studio', b8: 'apartment',
    r1: 'apartment', r2: 'apartment', r3: 'studio', r4: 'villa', r5: 'apartment', r6: 'apartment',
    b9: 'townhouse', b10: 'studio', b11: 'penthouse', r7: 'villa', r8: 'studio', r9: 'townhouse', r10: 'townhouse', r11: 'penthouse', r12: 'penthouse'
  };
  /* extra demo listings so every category has at least two in both Buy and Rent; photos reuse a similar existing listing */
  var EXTRA = [
    { id: 'b9', like: 'b6', mode: 'buy', scene: 'B', title: 'Dubai Hills Townhouse 3BR', area: 'Dubai Hills Estate', price: 'AED 3,650,000', priceN: 3650000, beds: 3, baths: 4, sqft: '2,450', badges: ['DLD verified', 'UAE Pass ✓'] },
    { id: 'b10', like: 'b7', mode: 'buy', scene: 'F', title: 'Dubai Marina Studio', area: 'Dubai Marina', price: 'AED 640,000', priceN: 640000, beds: 0, baths: 1, sqft: '450', badges: ['DLD verified'] },
    { id: 'b11', like: 'b4', mode: 'buy', scene: 'A', title: 'Business Bay Penthouse 3BR', area: 'Business Bay', price: 'AED 5,200,000', priceN: 5200000, beds: 3, baths: 4, sqft: '2,900', badges: ['DLD verified', 'Premium'] },
    { id: 'r11', like: 'b4', mode: 'rent', scene: 'A', title: 'Marina Penthouse 3BR', area: 'Dubai Marina', price: 'AED 380,000/yr', priceN: 380000, beds: 3, baths: 4, sqft: '2,700', badges: ['DLD verified', 'Furnished'] },
    { id: 'r12', like: 'b4', mode: 'rent', scene: 'A', title: 'Downtown Penthouse 4BR', area: 'Downtown Dubai', price: 'AED 520,000/yr', priceN: 520000, beds: 4, baths: 5, sqft: '3,400', badges: ['DLD verified', 'Furnished'] },
    { id: 'r7', like: 'r4', mode: 'rent', scene: 'B', title: 'Damac Hills Villa 4BR', area: 'Damac Hills', price: 'AED 240,000/yr', priceN: 240000, beds: 4, baths: 5, sqft: '3,600', badges: ['DLD verified', 'Furnished'] },
    { id: 'r8', like: 'r3', mode: 'rent', scene: 'F', title: 'Dubai Marina Studio', area: 'Dubai Marina', price: 'AED 58,000/yr', priceN: 58000, beds: 0, baths: 1, sqft: '410', badges: ['DLD verified'] },
    { id: 'r9', like: 'b6', mode: 'rent', scene: 'B', title: 'Arabian Ranches Townhouse 3BR', area: 'Arabian Ranches', price: 'AED 195,000/yr', priceN: 195000, beds: 3, baths: 4, sqft: '2,300', badges: ['DLD verified'] },
    { id: 'r10', like: 'b6', mode: 'rent', scene: 'B', title: 'Town Square Townhouse 3BR', area: 'Town Square', price: 'AED 125,000/yr', priceN: 125000, beds: 3, baths: 3, sqft: '1,900', badges: ['DLD verified', 'Furnished'] }
  ];
  var TYPE_LABEL = { apartment: 'apartments', villa: 'villas', townhouse: 'townhouses', studio: 'studios', penthouse: 'penthouses' };
  var homeType = 'all', homeSub = null;

  function addExtraListings() {
    if (typeof LISTINGS === 'undefined' || !Array.isArray(LISTINGS)) return;
    EXTRA.forEach(function (x) {
      if (LISTINGS.some(function (l) { return l.id === x.id; })) return;
      var item = {};
      Object.keys(x).forEach(function (k) { if (k !== 'like') item[k] = x[k]; });
      LISTINGS.push(item);
      var maps = [];
      try { if (typeof PROPERTY_PHOTOS !== 'undefined') maps.push(PROPERTY_PHOTOS); } catch (e) {}
      try { if (typeof PROPERTY_PHOTOS_NETWORK !== 'undefined') maps.push(PROPERTY_PHOTOS_NETWORK); } catch (e) {}
      try { if (typeof PROPERTY_GALLERY !== 'undefined') maps.push(PROPERTY_GALLERY); } catch (e) {}
      maps.forEach(function (obj) { if (obj && obj[x.like] && !obj[x.id]) obj[x.id] = obj[x.like]; });
    });
  }

  function paintChips() {
    $$('#page-home .chips-row .chip').forEach(function (c) {
      var t = squash(c.textContent).toLowerCase();
      var key = t === 'all' ? 'all' : t;
      c.classList.toggle('active', key === homeType);
    });
  }

  function paintSubtitle(n) {
    if (!homeSub) {
      homeSub = $$('#page-home *').filter(function (e) { return e.children.length === 0 && squash(e.textContent) === 'Popular this week'; })[0] || null;
      if (homeSub) homeSub.dataset.dhOrig = homeSub.textContent;
    }
    if (!homeSub) return;
    var mode = (window.STATE && STATE.mode === 'rent') ? 'for rent' : 'for sale';
    homeSub.textContent = homeType === 'all' ? homeSub.dataset.dhOrig : n + ' ' + (n === 1 ? TYPE_LABEL[homeType].slice(0, -1) : TYPE_LABEL[homeType]) + ' ' + mode;
  }

  function applyTypeFilter() {
    var host = document.getElementById('home-list');
    if (!host || typeof LISTINGS === 'undefined' || typeof listingCardHTML !== 'function' || !window.STATE) return;
    if (homeType !== 'all') {
      var items = LISTINGS.filter(function (l) { return l.mode === STATE.mode && TYPE[l.id] === homeType; });
      host.innerHTML = items.map(listingCardHTML).join('');
      paintSubtitle(items.length);
    } else paintSubtitle(0);
    paintChips();
  }

  safe(function () {
    addExtraListings();
    var orig = window.renderHomeList;
    if (typeof orig === 'function') {
      window.renderHomeList = function () {
        var r = orig.apply(this, arguments);
        try { applyTypeFilter(); } catch (e) {}
        return r;
      };
    }
    document.addEventListener('click', function (ev) {
      var c = ev.target.closest && ev.target.closest('#page-home .chips-row .chip');
      if (!c) return;
      var t = squash(c.textContent).toLowerCase();
      homeType = (t === 'all' || !TYPE_LABEL[t]) ? 'all' : t;
      if (window.renderHomeList) window.renderHomeList();
      var list = document.getElementById('home-list');
      if (list && list.scrollIntoView && homeType !== 'all') { /* keep the chips in view; no jump */ }
    });
  });

  /* ---------- wiring ---------- */
  function afterRender() {
    homeLayout();
    hideDupAman();
    offerTile();
    shortCards();
    legibility($('.page.active') || document.body);
    safe(function () { typography($('.page.active')); });
    scheduleBack();
  }

  safe(function () {
    var og = window.goPage;
    window.goPage = function (id) {
      var r = og.apply(this, arguments);
      try {
        if (id === 'page-viewing') refreshViewing();
        if (id === 'page-tracker') trackerCard();
        afterRender();
      } catch (e) {}
      return r;
    };
  });

  var queue = [], scheduled = false;
  function flush() {
    scheduled = false;
    var rs = queue; queue = [];
    rs.forEach(function (r) { safe(function () { sanitize(r); }); });
    safe(afterRender);
  }
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      if (m.type === 'childList') Array.prototype.forEach.call(m.addedNodes, function (n) { queue.push(n); });
      else if (m.type === 'characterData') queue.push(m.target);
    });
    if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  safe(function () { sanitize(document.body); });
  safe(buildConfirmation);
  safe(refreshViewing);
  safe(function () { typography(document.body); });
  safe(afterRender);
})();
