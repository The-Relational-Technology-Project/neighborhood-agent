/** The browser side of the channel. Session state lives here only; nothing is stored server-side. */
export const chatScript = String.raw `
(function(){
  var log = document.getElementById('log');
  var form = document.getElementById('ask');
  var box = document.getElementById('q');
  var send = document.getElementById('send');
  var history = [];
  function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function linkify(text){
    var frag = document.createDocumentFragment();
    var parts = text.split(/(\x60\x60\x60[\s\S]*?\x60\x60\x60)/);
    parts.forEach(function(part){
      if (part.indexOf('\x60\x60\x60') === 0) { var pre = el('pre', null, part.replace(/^\x60\x60\x60[a-z]*\n?/, '').replace(/\x60\x60\x60$/, '')); frag.appendChild(pre); return; }
      var re = /(https?:\/\/[^\s<)\]]+[^\s<)\].,;:!?])/g, last = 0, m;
      while ((m = re.exec(part))) { frag.appendChild(document.createTextNode(part.slice(last, m.index))); var a = el('a', null, m[1]); a.href = m[1]; a.target = '_blank'; a.rel = 'noopener'; frag.appendChild(a); last = m.index + m[1].length; }
      frag.appendChild(document.createTextNode(part.slice(last)));
    });
    return frag;
  }
  function addMsg(role, text){
    var m = el('div', 'msg ' + (role === 'user' ? 'n' : 'a'));
    m.appendChild(el('span', 'who ' + (role === 'user' ? 'n' : 'a'), role === 'user' ? 'You' : 'Agent'));
    var t = el('span', 'txt'); t.appendChild(linkify(text)); m.appendChild(t); log.appendChild(m); log.scrollTop = log.scrollHeight; return t;
  }
  function addDraft(d){
    var box = el('div', 'draft');
    box.appendChild(el('b', 'k', 'Proposed change: ' + d.path));
    var pre = el('pre', null, d.content); box.appendChild(pre);
    var note = el('div', 'standing', 'This opens a public pull request on the neighborhood repo. A steward reviews it before anything changes. Nothing else from this conversation is kept.'); box.appendChild(note);
    var actions = el('div', 'actions');
    var yes = el('button', null, 'Yes, open the PR'); var no = el('button', 'ghost', 'Not yet');
    actions.appendChild(yes); actions.appendChild(no); box.appendChild(actions); log.appendChild(box); log.scrollTop = log.scrollHeight;
    no.onclick = function(){ box.remove(); addMsg('assistant', "Okay, I won't open it. Tell me what to change, or we can leave it."); };
    yes.onclick = function(){
      yes.disabled = true; no.disabled = true; yes.textContent = 'Opening…';
      fetch('/api/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft_id: d.id, token: d.token }) })
        .then(function(r){ return r.json(); })
        .then(function(res){
          actions.remove();
          if (res.url) { var p = el('div', 'standing'); p.appendChild(document.createTextNode('Opened. A steward will review it: ')); var a = el('a', null, res.url); a.href = res.url; a.target = '_blank'; p.appendChild(a); box.appendChild(p); history.push({ role: 'assistant', content: 'The pull request is open at ' + res.url + '. A steward will review it.' }); }
          else { var e = el('div', 'standing err', res.error || 'Could not open the PR.'); box.appendChild(e); if (res.fallback_url) { var a2 = el('a', null, 'Open it by hand on GitHub'); a2.href = res.fallback_url; a2.target = '_blank'; box.appendChild(a2); } }
        })
        .catch(function(){ yes.disabled = false; no.disabled = false; yes.textContent = 'Yes, open the PR'; });
    };
  }
  function setBusy(b){ send.disabled = b; box.disabled = b; }
  form.addEventListener('submit', function(ev){
    ev.preventDefault();
    var q = box.value.trim(); if (!q) return;
    box.value = ''; addMsg('user', q); history.push({ role: 'user', content: q }); setBusy(true);
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
            if (evm[1] === 'text') { text += data; out.textContent = ''; out.appendChild(linkify(text)); log.scrollTop = log.scrollHeight; }
            else if (evm[1] === 'tool') { var t = el('div', 'tool', 'looking: ' + data.replace(/_/g, ' ')); log.insertBefore(t, out.parentNode.nextSibling); }
            else if (evm[1] === 'draft') { addDraft(data); }
            else if (evm[1] === 'error') { out.textContent = data; out.classList.add('err'); }
          });
          return pump();
        }); }
        return pump();
      })
      .then(function(){ if (text) history.push({ role: 'assistant', content: text }); })
      .catch(function(e){ out.textContent = e.message || 'Something went wrong.'; out.classList.add('err'); })
      .then(function(){ setBusy(false); box.focus(); });
  });
  box.addEventListener('keydown', function(e){ if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  window.addEventListener('beforeunload', function(){ history = []; });
})();
`;
//# sourceMappingURL=chat.js.map