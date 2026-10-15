// Progressive enhancement only: every page works without this file except search results.
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);

  /* ---------------------------------------------------------- library filters */
  var list = document.getElementById('lib-list');
  if (list) {
    var typeSel = document.getElementById('f-type');
    var topicSel = document.getElementById('f-topic');
    var count = document.getElementById('f-count');
    var empty = document.getElementById('f-empty');
    var items = Array.prototype.slice.call(list.children);

    var apply = function () {
      var t = typeSel.value;
      var p = topicSel.value;
      var shown = 0;
      items.forEach(function (li) {
        var ok = (!t || li.dataset.type === t) && (!p || li.dataset.topic === p);
        li.hidden = !ok;
        if (ok) shown++;
      });
      count.textContent = shown === items.length ? items.length + ' items' : 'Showing ' + shown + ' of ' + items.length + ' items';
      empty.hidden = shown !== 0;
      var q = new URLSearchParams();
      if (t) q.set('type', t);
      if (p) q.set('topic', p);
      history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
    };
    if (params.get('type')) typeSel.value = params.get('type');
    if (params.get('topic')) topicSel.value = params.get('topic');
    typeSel.addEventListener('change', apply);
    topicSel.addEventListener('change', apply);
    document.getElementById('f-clear').addEventListener('click', function () {
      typeSel.value = '';
      topicSel.value = '';
      apply();
    });
    apply();
  }

  /* ------------------------------------------------------------------- search */
  var resultsEl = document.getElementById('search-results');
  if (resultsEl) {
    var statusEl = document.getElementById('search-status');
    var emptyEl = document.getElementById('search-empty');
    var input = document.getElementById('search-q');
    var q = (params.get('q') || '').trim();
    input.value = q;

    var esc = function (s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    };
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var fmt = function (d) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
      return m ? +m[3] + ' ' + months[+m[2] - 1] + ' ' + m[1] : '';
    };
    var words = function (s) {
      return s.toLowerCase().split(/[^a-z0-9؀-ۿ]+/).filter(function (w) { return w.length > 1; });
    };
    var highlight = function (text, toks) {
      var out = esc(text);
      toks.forEach(function (t) {
        out = out.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
      });
      return out;
    };
    var snippet = function (item, toks) {
      var text = item.x || item.s;
      var lower = text.toLowerCase();
      var at = -1;
      for (var i = 0; i < toks.length && at < 0; i++) at = lower.indexOf(toks[i]);
      if (at < 0) return item.s;
      var start = Math.max(0, at - 80);
      return (start > 0 ? '… ' : '') + text.slice(start, start + 220) + ' …';
    };

    if (!q) {
      statusEl.textContent = 'Type a word or phrase above to search titles, summaries and page text.';
      emptyEl.hidden = false;
    } else {
      fetch('/search-index.json')
        .then(function (r) { return r.json(); })
        .then(function (index) {
          var toks = words(q);
          var scored = index
            .map(function (it) {
              var title = it.t.toLowerCase(), sum = it.s.toLowerCase(), body = (it.x || '').toLowerCase();
              var score = 0, matched = 0;
              toks.forEach(function (t) {
                var s = 0;
                if (title.indexOf(t) > -1) s += 6;
                if (sum.indexOf(t) > -1) s += 3;
                if (body.indexOf(t) > -1) s += 1;
                if (s) matched++;
                score += s;
              });
              return { it: it, score: score, all: matched === toks.length };
            })
            .filter(function (r) { return r.score > 0; });
          var strict = scored.filter(function (r) { return r.all; });
          if (strict.length) scored = strict;
          scored.sort(function (a, b) { return b.score - a.score; });

          if (!scored.length) {
            statusEl.textContent = 'No results for “' + q + '”.';
            emptyEl.hidden = false;
            return;
          }
          statusEl.textContent = scored.length + ' result' + (scored.length === 1 ? '' : 's') + ' for “' + q + '”.';
          resultsEl.innerHTML = scored
            .map(function (r) {
              var it = r.it;
              return (
                '<li><p class="card-meta">' + esc(it.ty) + (it.tp ? ' · ' + esc(it.tp) : '') + '</p>' +
                '<h2><a href="' + esc(it.u) + '">' + highlight(it.t, toks) + '</a></h2>' +
                '<p>' + highlight(snippet(it, toks), toks) + '</p>' +
                '<p class="muted small">' + (it.st ? esc(it.st.charAt(0).toUpperCase() + it.st.slice(1)) + ' · ' : '') + 'Updated ' + fmt(it.d) + '</p></li>'
              );
            })
            .join('');
        })
        .catch(function () {
          statusEl.textContent = 'Search could not load. You can still browse the library or explore systems.';
          emptyEl.hidden = false;
        });
    }
  }

  /* ------------------------------------------------------ corrections: page ref */
  var ref = document.getElementById('page-ref');
  var mail = document.getElementById('mailto-link');
  var page = params.get('page');
  if (ref && mail && page && /^\/[\w\-\/#.]*$/.test(page)) {
    var url = location.origin + page;
    ref.textContent = 'Reporting: ' + url;
    mail.href += '&body=' + encodeURIComponent('Page: ' + url + '\n\nWhat is wrong or missing:\n\nSource (if any):\n');
  }
})();
