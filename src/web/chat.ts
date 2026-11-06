/** The browser side of the channel. Session state lives here only; nothing is stored server-side. */
export const chatScript = String.raw`
(function(){
  var log = document.getElementById('log');
  var form = document.getElementById('ask');
  var box = document.getElementById('q');
  var send = document.getElementById('send');
  var history = [];
  var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  function nearBottom(){ return log.scrollHeight - log.scrollTop - log.clientHeight < 120; }
  function toBottom(force){ if (force || nearBottom()) log.scrollTop = log.scrollHeight; }
  var anchor = null, userScrolled = false;
  log.addEventListener('touchmove', function(){ userScrolled = true; }, { passive: true });
  log.addEventListener('wheel', function(){ userScrolled = true; }, { passive: true });
  function follow(){ if (userScrolled || !anchor) return; var target = anchor.offsetTop - 8; log.scrollTop = Math.min(target, log.scrollHeight - log.clientHeight); }
  function grow(){ box.style.height = 'auto'; box.style.height = Math.min(box.scrollHeight, 132) + 'px'; }
  box.addEventListener('input', grow);
  box.addEventListener('focus', function(){ setTimeout(function(){ toBottom(true); }, 250); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', function(){ if (document.activeElement === box) toBottom(true); });
  function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function inline(part, frag){
    var re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|(https?:\/\/[^\s<)\]]+[^\s<)\].,;:!?])/g, last = 0, m;
    while ((m = re.exec(part))) {
      frag.appendChild(document.createTextNode(part.slice(last, m.index)));
      if (m[1]) { var a = el('a', null, m[1]); a.href = m[2]; a.target = '_blank'; a.rel = 'noopener'; frag.appendChild(a); }
      else if (m[3]) { frag.appendChild(el('b', null, m[3])); }
      else { var u = el('a', null, m[4].replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')); u.href = m[4]; u.target = '_blank'; u.rel = 'noopener'; frag.appendChild(u); }
      last = m.index + m[0].length;
    }
    frag.appendChild(document.createTextNode(part.slice(last)));
  }
  function linkify(text){
    var frag = document.createDocumentFragment();
    var parts = text.split(/(\x60\x60\x60[\s\S]*?\x60\x60\x60)/);
    parts.forEach(function(part){
      if (part.indexOf('\x60\x60\x60') === 0) { frag.appendChild(el('pre', null, part.replace(/^\x60\x60\x60[a-z]*\n?/, '').replace(/\x60\x60\x60$/, ''))); return; }
      inline(part.replace(/^#{1,4}\s+/gm, '').replace(/^\s*[-*]\s+/gm, '• '), frag);
    });
    return frag;
  }
  function addMsg(role, text){
    var m = el('div', 'msg ' + (role === 'user' ? 'n' : 'a'));
    m.appendChild(el('span', 'who ' + (role === 'user' ? 'n' : 'a'), role === 'user' ? 'You' : 'Agent'));
    var t = el('span', 'txt'); t.appendChild(linkify(text)); m.appendChild(t); log.appendChild(m); toBottom(true); return t;
  }
  function addDraft(d){
    var box = el('div', 'draft');
    box.appendChild(el('b', 'k', 'Here’s what I’ll send to the stewards'));
    var dl = el('dl', 'summary');
    (d.summary || []).forEach(function(pair){ dl.appendChild(el('dt', null, pair[0])); dl.appendChild(el('dd', null, pair[1])); });
    box.appendChild(dl);
    box.appendChild(el('div', 'standing', 'A neighborhood steward looks it over before it’s added. Once added, it’s public. Nothing else from this chat is kept.'));
    var actions = el('div', 'actions');
    var yes = el('button', null, 'Yes, send it'); var no = el('button', 'ghost', 'Not yet');
    actions.appendChild(yes); actions.appendChild(no); box.appendChild(actions); log.appendChild(box); toBottom(true);
    no.onclick = function(){ box.remove(); addMsg('assistant', "Okay, I won't send it. Tell me what to change, or we can leave it."); };
    yes.onclick = function(){
      yes.disabled = true; no.disabled = true; yes.textContent = 'Sending…';
      fetch('/api/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft_id: d.id, token: d.token }) })
        .then(function(r){ return r.json(); })
        .then(function(res){
          actions.remove();
          if (res.ok) { box.appendChild(el('div', 'standing ok', 'Sent. A steward will look it over. Thank you.')); history.push({ role: 'assistant', content: 'Sent to the stewards.' }); }
          else { box.appendChild(el('div', 'standing err', res.error || 'I couldn’t send that just now.')); }
        })
        .catch(function(){ yes.disabled = false; no.disabled = false; yes.textContent = 'Yes, send it'; });
    };
  }
  function setBusy(b){ send.disabled = b; box.disabled = b; }
  var suggest = document.getElementById('suggest');
  if (suggest) suggest.addEventListener('click', function(ev){
    var b = ev.target.closest('button'); if (!b) return;
    box.value = b.textContent; form.requestSubmit();
  });
  form.addEventListener('submit', function(ev){
    ev.preventDefault();
    var q = box.value.trim(); if (!q) return;
    box.value = ''; grow(); if (touch) box.blur(); if (suggest) { suggest.remove(); suggest = null; } addMsg('user', q); anchor = log.lastChild; userScrolled = false; history.push({ role: 'user', content: q }); setBusy(true);
    var out = addMsg('assistant', ''); var text = '';
    fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: history }) })
      .then(function(r){
        if (!r.ok) { return r.json().then(function(j){ throw new Error(j.error || ('error ' + r.status)); }); }
        var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
        function pump(){ return reader.read().then(function(step){
          if (step.done) return;
          buf += dec.decode(step.value, { stream: true });
          var lines = buf.split('\n\n'); buf = lines.pop();
          lines.forEach(function(chunk){
            var evm = chunk.match(/^event: (\w+)\ndata: (.*)$/s); if (!evm) return;
            var data = JSON.parse(evm[2]);
            if (evm[1] === 'text') { text += data; out.textContent = ''; out.appendChild(linkify(text)); follow(); }
            else if (evm[1] === 'tool') { var t = el('div', 'tool', ({ search_data: 'checking the neighborhood notes…', get_vital_signs: 'checking the tide and the plovers…', lookup_person_or_place: 'looking that up…', draft_pr: 'drafting that…' })[data] || 'looking…'); log.insertBefore(t, out.parentNode.nextSibling); }
            else if (evm[1] === 'draft') { addDraft(data); }
            else if (evm[1] === 'error') { out.textContent = data; out.classList.add('err'); }
          });
          return pump();
        }); }
        return pump();
      })
      .then(function(){ if (text) history.push({ role: 'assistant', content: text }); })
      .catch(function(e){ out.textContent = e.message || 'Something went wrong.'; out.classList.add('err'); })
      .then(function(){ setBusy(false); if (!touch) box.focus(); });
  });
  box.addEventListener('keydown', function(e){ if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  window.addEventListener('beforeunload', function(){ history = []; });
})();
`;
