'use strict';
/* ===== 가계부 웹앱 — 로그인 / 입력 / 내역 / 분석 / 설정 ===== */
const CFG = window.APP_CONFIG || {};
const DEMO = !CFG.supabaseUrl || !CFG.supabaseKey;

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const won = n => (n == null || isNaN(n)) ? '-' : Math.round(n).toLocaleString('ko-KR') + '원';
const pct = (v, d = 0) => (v * 100).toFixed(d) + '%';
const p2 = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const dnum = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const isoOf = dn => new Date(dn * 86400000).toISOString().slice(0, 10);
const mmdd = iso => `${iso.slice(5, 7)}.${iso.slice(8, 10)}`;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const wdOf = iso => WD[new Date(dnum(iso) * 86400000).getUTCDay()];
const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200); };
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('스크립트를 불러오지 못했습니다: ' + src)); document.head.appendChild(s); });
const statusCls = t => /⚠|초과|부족|위험/.test(t || '') ? 'warn' : /정상|양호/.test(t || '') ? 'ok' : 'na';
const tag = (t, c) => t ? `<span class="tag ${c || statusCls(t)}">${esc(t)}</span>` : '';

const DEFAULT_SETTINGS = { monthLimit: 2350000, cardLimit: 1910000, deliveryLimit: 5, boozeYear: 2400000, cycleStart: 9, payDay: 21 };
const DEFAULT_RULES = { '식비': '변동', '교통/차량': '변동', '주거/통신': '고정', '생활용품': '변동', '건강/문화': '변동', '의류/미용': '변동', '술/유흥': '변동',
  '경조사': '비정기', '여행/숙박': '비정기', '교육': '변동', '자녀': '변동', '반려동물': '변동', '세금/이자': '비정기', '카드대금': '제외', '저축/보험': '제외',
  '미분류': '변동', '기타': '변동', '용돈/기타': '변동', '경조사/회비': '비정기', '의복/미용': '변동' };
const INCOME_CATS = ['급여', '상여', '부수입', '이자/배당', '환급', '기타수입'];
const NATURES = ['고정', '변동', '비정기', '제외'];

const state = { user: null, tx: [], rules: { ...DEFAULT_RULES }, settings: { ...DEFAULT_SETTINGS }, tab: 'input', hMonth: null, hQuery: '', aMonth: null, form: null, asset: null, assetErr: '' };

// ---------- backend ----------
function makeMock() {
  const mem = { tx: [], rules: [], settings: null, asset: null };
  return {
    async getSession() { return { user: { id: 'demo', email: '미리보기' } }; },
    onAuth() {}, async signIn() {}, async signOut() {},
    async loadAll() { return { tx: mem.tx.map(t => ({ ...t })), rules: mem.rules.map(r => ({ ...r })), settings: mem.settings, asset: mem.asset, assetErr: '' }; },
    async saveAsset({ file_name, sheets }) { mem.asset = { file_name, sheets, uploaded_at: new Date().toISOString() }; return mem.asset; },
    async addTx(r) { const t = { ...r, id: crypto.randomUUID(), created_at: new Date().toISOString() }; mem.tx.push(t); return { ...t }; },
    async updateTx(id, r) { const i = mem.tx.findIndex(t => t.id === id); mem.tx[i] = { ...mem.tx[i], ...r }; return { ...mem.tx[i] }; },
    async deleteTx(id) { mem.tx = mem.tx.filter(t => t.id !== id); },
    async importTx(rows) { let n = 0; const keys = new Set(mem.tx.map(t => t.import_key).filter(Boolean)); for (const r of rows) { if (r.import_key && keys.has(r.import_key)) continue; keys.add(r.import_key); mem.tx.push({ ...r, id: crypto.randomUUID(), created_at: new Date().toISOString() }); n++; } return n; },
    async setRules(list) { list.forEach(r => { const i = mem.rules.findIndex(x => x.key === r.key); if (i >= 0) mem.rules[i] = { key: r.key, nature: r.nature }; else mem.rules.push({ key: r.key, nature: r.nature }); }); },
    async delRule(key) { mem.rules = mem.rules.filter(r => r.key !== key); },
    async saveSettings(data) { mem.settings = { ...data }; }
  };
}

function makeSupabase() {
  // 로그인 상태는 이 기기의 브라우저에 저장되고 자동으로 갱신된다 (로그아웃하거나 브라우저 데이터를 지우기 전까지 유지)
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage } });
  const uid = () => state.user.id;
  const ck = ({ error, data }) => { if (error) throw new Error(error.message); return data; };
  return {
    async getSession() { const { data } = await sb.auth.getSession(); return data.session; },
    onAuth(cb) { sb.auth.onAuthStateChange((_e, s) => cb(s)); },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw new Error(error.message); },
    async signOut() { await sb.auth.signOut(); },
    async loadAll() {
      let tx = [], from = 0;
      for (;;) {
        const rows = ck(await sb.from('transactions').select('*').order('tx_date', { ascending: false }).range(from, from + 999));
        tx = tx.concat(rows); if (rows.length < 1000) break; from += 1000;
      }
      const rules = ck(await sb.from('rules').select('key,nature'));
      const s = ck(await sb.from('settings').select('data').maybeSingle());
      let asset = null, assetErr = '';
      try {
        const a = await sb.from('asset_snapshots').select('file_name,uploaded_at,sheets').order('uploaded_at', { ascending: false }).limit(1).maybeSingle();
        if (a.error) assetErr = a.error.message; else asset = a.data || null;
      } catch (e) { assetErr = String((e && e.message) || e); }
      return { tx, rules, settings: s ? s.data : null, asset, assetErr };
    },
    async saveAsset({ file_name, sheets }) { return ck(await sb.from('asset_snapshots').insert({ user_id: uid(), file_name, sheets }).select('file_name,uploaded_at,sheets').single()); },
    async addTx(r) { return ck(await sb.from('transactions').insert({ ...r, user_id: uid() }).select().single()); },
    async updateTx(id, r) { return ck(await sb.from('transactions').update(r).eq('id', id).select().single()); },
    async deleteTx(id) { ck(await sb.from('transactions').delete().eq('id', id)); },
    async importTx(rows) {
      let n = 0;
      for (let i = 0; i < rows.length; i += 400) {
        const chunk = rows.slice(i, i + 400).map(r => ({ ...r, user_id: uid() }));
        const got = ck(await sb.from('transactions').upsert(chunk, { onConflict: 'user_id,import_key', ignoreDuplicates: true }).select('id'));
        n += got.length;
      }
      return n;
    },
    async setRules(list) { ck(await sb.from('rules').upsert(list.map(r => ({ user_id: uid(), key: r.key, nature: r.nature })), { onConflict: 'user_id,key' })); },
    async delRule(key) { ck(await sb.from('rules').delete().eq('key', key)); },
    async saveSettings(data) { ck(await sb.from('settings').upsert({ user_id: uid(), data }, { onConflict: 'user_id' })); }
  };
}
let backend;

// ---------- classification ----------
const catOf = t => { const c = t.cls || ''; return c.includes('>') ? c.split('>')[0] : (c || '미분류'); };
const subOf = t => { const c = t.cls || ''; return c.includes('>') ? c.split('>')[1] : ''; };
function natureOf(t) {
  if (t.kind === 'income') return '수입';
  const cls = t.cls || '', cat = catOf(t);
  if (cls.includes('>') && state.rules[cls]) return state.rules[cls];
  if (cat === '카드대금' || cat === '저축/보험') return '제외';
  const tags = (t.tag || '').split(',').map(s => s.trim());   // 예: '비정기,할부'
  if (tags.includes('비정기')) return '비정기';
  if (tags.includes('고정')) return '고정';
  return state.rules[cat] || '변동';
}
function prep() { state.tx.forEach(t => { t._n = natureOf(t); t._m = t.tx_date.slice(0, 7); t.amount = Number(t.amount); }); state.tx.sort((a, b) => a.tx_date < b.tx_date ? 1 : a.tx_date > b.tx_date ? -1 : (a.created_at < b.created_at ? 1 : -1)); }
const isSpend = t => t.kind === 'expense' && t._n !== '제외';
const monthsOf = () => [...new Set(state.tx.map(t => t._m))].sort().reverse();

function allCats() { return [...new Set([...Object.keys(state.rules).filter(k => !k.includes('>')), ...state.tx.filter(t => t.kind === 'expense').map(catOf)])].filter(c => c !== '카드대금').sort((a, b) => a.localeCompare(b, 'ko')); }
function subsOf(cat) { return [...new Set(state.tx.filter(t => t.kind === 'expense' && catOf(t) === cat && subOf(t)).map(subOf))].sort((a, b) => a.localeCompare(b, 'ko')); }

// ---------- card billing cycle ----------
function cycleKey(iso) { const [y, m, d] = iso.split('-').map(Number); let py = y, pm = m + (d >= state.settings.cycleStart ? 1 : 0); if (pm > 12) { pm = 1; py++; } return `${py}-${p2(pm)}`; }
function cycleRange(key) {
  const [py, pm] = key.split('-').map(Number), S = state.settings; let sy = py, sm = pm - 1; if (sm < 1) { sm = 12; sy--; }
  return { start: `${sy}-${p2(sm)}-${p2(S.cycleStart)}`, end: isoOf(Date.UTC(py, pm - 1, S.cycleStart - 1) / 86400000), pay: `${key}-${p2(S.payDay)}` };
}

// ---------- forms ----------
function formHtml(p, t) {
  t = t || { kind: 'expense', tx_date: todayISO(), amount: '', pay: 'card', place: '', memo: '', cls: '', tag: '' };
  const inc = t.kind === 'income', cat = inc || !t.cls ? '' : catOf(t), sub = inc ? '' : subOf(t);
  const cats = allCats(); if (cat && !cats.includes(cat)) cats.unshift(cat);
  const incCat = inc ? (subOf(t) || INCOME_CATS[0]) : INCOME_CATS[0];
  return `<div data-form="${p}">
    <div class="seg" data-grp="kind"><button type="button" data-val="expense" class="${inc ? '' : 'on'}">지출</button><button type="button" data-val="income" class="${inc ? 'on' : ''}">수입</button></div>
    <label class="f">금액</label><input class="amt" id="${p}amount" inputmode="numeric" placeholder="0" value="${t.amount ? Number(t.amount).toLocaleString('ko-KR') : ''}" autocomplete="off">
    <div class="row2"><div><label class="f">날짜</label><input id="${p}date" type="date" value="${esc(t.tx_date)}"></div>
      <div id="${p}payWrap" ${inc ? 'hidden' : ''}><label class="f">결제수단</label><div class="seg" data-grp="pay"><button type="button" data-val="card" class="${t.pay === 'card' ? 'on' : ''}">카드</button><button type="button" data-val="cash" class="${t.pay === 'cash' ? 'on' : ''}">현금·계좌</button></div></div></div>
    <div id="${p}expWrap" ${inc ? 'hidden' : ''}>
      <label class="f">사용처</label><input id="${p}place" list="${p}places" value="${esc(t.place)}" autocomplete="off" placeholder="예: 스타벅스">
      <datalist id="${p}places">${[...new Set(state.tx.map(x => x.place).filter(Boolean))].slice(0, 300).map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <div class="row2"><div><label class="f">대분류</label><select id="${p}cat"><option value="" ${cat ? '' : 'selected'}>선택</option>${cats.map(c => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div><label class="f">소분류</label><input id="${p}sub" list="${p}subs" value="${esc(sub)}" autocomplete="off" placeholder="선택/직접"><datalist id="${p}subs">${subsOf(cat).map(s => `<option value="${esc(s)}">`).join('')}</datalist></div></div>
      <label class="f">구분</label><select id="${p}tag"><option value="" ${!t.tag ? 'selected' : ''}>기본 (분류 규칙대로)</option><option ${t.tag === '고정' ? 'selected' : ''}>고정</option><option ${t.tag === '비정기' ? 'selected' : ''}>비정기</option>${t.tag && !['고정', '비정기'].includes(t.tag) ? `<option selected>${esc(t.tag)}</option>` : ''}</select>
    </div>
    <div id="${p}incWrap" ${inc ? '' : 'hidden'}><label class="f">수입 종류</label><select id="${p}incCat">${INCOME_CATS.map(c => `<option ${c === incCat ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <label class="f">출처</label><input id="${p}incPlace" value="${inc ? esc(t.place) : ''}" placeholder="예: 회사"></div>
    <label class="f">메모</label><input id="${p}memo" value="${esc(t.memo)}" placeholder="선택">
  </div>`;
}
const segVal = (root, grp) => root.querySelector(`[data-grp="${grp}"] .on`).dataset.val;
function readForm(p) {
  const root = document.querySelector(`[data-form="${p}"]`), g = id => root.querySelector('#' + p + id).value.trim();
  const kind = segVal(root, 'kind'), amount = parseInt(g('amount').replace(/\D/g, ''), 10) || 0, date = g('date');
  if (!amount) throw new Error('금액을 입력하세요');
  if (!date) throw new Error('날짜를 입력하세요');
  if (kind === 'income') return { tx_date: date, kind, amount, pay: 'cash', place: g('incPlace'), memo: g('memo'), cls: '수입>' + g('incCat'), tag: '' };
  const cat = g('cat'), sub = g('sub');
  return { tx_date: date, kind, amount, pay: segVal(root, 'pay'), place: g('place'), memo: g('memo'), cls: cat ? cat + (sub ? '>' + sub : '') : '', tag: g('tag') };
}
function wireForm(p) {
  const root = document.querySelector(`[data-form="${p}"]`), q = id => root.querySelector('#' + p + id);
  root.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if (seg.dataset.grp === 'kind') { const inc = b.dataset.val === 'income'; q('payWrap').hidden = inc; q('expWrap').hidden = inc; q('incWrap').hidden = !inc; }
  }));
  q('amount').addEventListener('input', e => { const d = e.target.value.replace(/\D/g, ''); e.target.value = d ? Number(d).toLocaleString('ko-KR') : ''; });
  q('cat').addEventListener('change', () => { q('subs').innerHTML = subsOf(q('cat').value).map(s => `<option value="${esc(s)}">`).join(''); q('sub').value = ''; });
  q('place').addEventListener('change', () => { // 같은 사용처를 전에 입력했다면 분류·결제수단 자동 채움
    const v = q('place').value.trim(); if (!v) return;
    const prev = state.tx.find(t => t.kind === 'expense' && t.place === v); if (!prev) return;
    const cat = catOf(prev); if ([...q('cat').options].some(o => o.value === cat)) q('cat').value = cat;
    q('subs').innerHTML = subsOf(q('cat').value).map(s => `<option value="${esc(s)}">`).join(''); q('sub').value = subOf(prev); q('tag').value = ['고정', '비정기'].includes(prev.tag) ? prev.tag : '';
    const pb = [...root.querySelectorAll('[data-grp="pay"] button')]; pb.forEach(b => b.classList.toggle('on', b.dataset.val === prev.pay));
  });
}

// ---------- views ----------
const view = () => $('#view');
function rowHtml(t) {
  const inc = t.kind === 'income', ex = t._n === '제외';
  return `<div class="item ${ex ? 'ex' : ''}" data-act="edit" data-id="${t.id}"><div class="l"><div class="t">${esc(t.place || t.memo || (inc ? '수입' : '(사용처 없음)'))}</div>
    <div class="s">${esc(t.cls.replace('>', ' › ') || '미분류')} · ${t.pay === 'card' && !inc ? '카드' : inc ? '' : '현금·계좌'}${t.tag ? ' · ' + esc(t.tag) : ''}${ex ? ' · 제외' : ''}</div></div>
    <div class="a ${inc ? 'pos' : ''}">${inc ? '+' : '−'}${Math.round(t.amount).toLocaleString('ko-KR')}</div></div>`;
}

function viewInput() {
  const recent = [...state.tx].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 8);
  const m = todayISO().slice(0, 7), mt = state.tx.filter(t => t._m === m);
  const exp = mt.filter(isSpend).reduce((s, t) => s + t.amount, 0), inc = mt.filter(t => t.kind === 'income').reduce((s, t) => s + t.amount, 0);
  view().innerHTML = `<div class="card"><h2>이번 달 <small>${m.replace('-', '.')} (제외 항목 뺀 지출)</small></h2>
    <div class="sum"><div>지출<b>${won(exp)}</b></div><div>수입<b class="pos">${won(inc)}</b></div><div>한도 대비<b>${pct(exp / state.settings.monthLimit)}</b></div></div></div>
    <div class="card"><h2>새 내역</h2>${formHtml('f_')}<button class="btn" data-act="save">저장</button></div>
    <div class="card"><h2>엑셀 올리기</h2><div class="note" style="margin:0 0 10px">카드 이용내역, 은행 거래내역, 지출점검시트(원본데이터)를 올리면 자동으로 입력됩니다.</div><button class="btn sec" data-act="openImport" style="margin:0">엑셀 파일 선택</button></div>
    <div class="card"><h2>최근 입력 <small>눌러서 수정</small></h2>${recent.length ? recent.map(rowHtml).join('') : '<div class="note">아직 입력한 내역이 없습니다.</div>'}</div>`;
  wireForm('f_');
}

function viewHistory() {
  const months = monthsOf(), cur = todayISO().slice(0, 7);
  if (!months.includes(cur)) months.unshift(cur);
  if (!state.hMonth) state.hMonth = cur;
  view().innerHTML = `<div class="card"><div class="row2"><select id="hMonth">${months.map(m => `<option value="${m}" ${m === state.hMonth ? 'selected' : ''}>${m}</option>`).join('')}</select>
    <input id="hQuery" type="search" placeholder="검색 (미분류 = 분류 안 된 내역)" value="${esc(state.hQuery)}"></div></div>
    <div id="hBody"></div>`;
  $('#hMonth').onchange = e => { state.hMonth = e.target.value; renderHistoryBody(); };
  $('#hQuery').addEventListener('input', e => { state.hQuery = e.target.value; renderHistoryBody(); });
  renderHistoryBody();
}
function renderHistoryBody() {
  const q = state.hQuery.trim().toLowerCase();
  const list = state.tx.filter(t => t._m === state.hMonth && (!q || (q === '미분류' ? t.kind === 'expense' && catOf(t) === '미분류' : (t.place + ' ' + t.memo + ' ' + t.cls).toLowerCase().includes(q))));
  const exp = list.filter(isSpend).reduce((s, t) => s + t.amount, 0), inc = list.filter(t => t.kind === 'income').reduce((s, t) => s + t.amount, 0);
  let body = '', last = '';
  list.forEach(t => { if (t.tx_date !== last) { last = t.tx_date; const day = list.filter(x => x.tx_date === last && isSpend(x)).reduce((s, x) => s + x.amount, 0); body += `<div class="dayh"><span>${mmdd(last)} (${wdOf(last)})</span><span>${day ? won(day) : ''}</span></div>`; } body += rowHtml(t); });
  $('#hBody').innerHTML = `<div class="card"><div class="sum"><div>지출<b>${won(exp)}</b></div><div>수입<b class="pos">${won(inc)}</b></div><div>건수<b>${list.length}건</b></div></div></div>
    <div class="card">${body || '<div class="note">내역이 없습니다.</div>'}</div>`;
}

function meter(label, value, limit, right) {
  const r = limit ? value / limit : 0, c = r > 1 ? 'over' : r > 0.8 ? 'mid' : '';
  return `<div class="meter"><div class="top"><span>${label}</span><span>${right}</span></div><div class="prog"><span class="${c}" style="width:${Math.min(100, r * 100).toFixed(1)}%"></span></div></div>`;
}
function barChart(items, limit) {
  const W = 520, H = 200, pl = 8, pr = 8, pt = 24, pb = 26;
  const maxV = Math.max(limit * 1.15, ...items.map(i => i.total), 1), y = v => pt + (H - pt - pb) * (1 - v / maxV);
  const step = (W - pl - pr) / items.length, bw = Math.min(56, step * 0.6), cols = [['고정', 'var(--c1)'], ['변동', 'var(--c2)'], ['비정기', 'var(--c4)']];
  let g = '';
  items.forEach((it, i) => {
    const x = pl + step * i + (step - bw) / 2; let acc = 0;
    cols.forEach(([k, c]) => { const v = it[k] || 0; if (v > 0) g += `<rect x="${x}" y="${y(acc + v)}" width="${bw}" height="${y(acc) - y(acc + v)}" fill="${c}"/>`; acc += v; });
    g += `<text x="${x + bw / 2}" y="${y(it.total) - 6}" text-anchor="middle" style="fill:var(--text)">${(it.total / 10000).toFixed(0)}만</text><text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  const ly = y(limit);
  g += `<line x1="${pl}" x2="${W - pr}" y1="${ly}" y2="${ly}" stroke="var(--bad)" stroke-dasharray="4 3"/><text x="${W - pr}" y="${ly - 4}" text-anchor="end" style="fill:var(--bad)">한도 ${(limit / 10000).toFixed(0)}만</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${g}</svg><div class="lg"><span><i style="background:var(--c1)"></i>고정비</span><span><i style="background:var(--c2)"></i>변동비</span><span><i style="background:var(--c4)"></i>비정기</span></div>`;
}

function viewAnalysis() {
  const S = state.settings, today = todayISO(), spend = state.tx.filter(isSpend);
  if (!spend.length) { view().innerHTML = '<div class="card"><div class="note">분석할 지출 내역이 아직 없습니다. 입력하거나 설정에서 기존 내역을 가져오세요.</div></div>'; return; }
  const B = {};
  spend.forEach(t => {
    const m = B[t._m] ??= { 고정: 0, 변동: 0, 비정기: 0, total: 0, n: 0, cats: {}, items: [], first: t.tx_date, last: t.tx_date, deliv: 0, delivAmt: 0, booze: 0 };
    m[t._n] += t.amount; m.total += t.amount; m.n++; m.first = t.tx_date < m.first ? t.tx_date : m.first; m.last = t.tx_date > m.last ? t.tx_date : m.last;
    const c = catOf(t); m.cats[c] = (m.cats[c] || 0) + t.amount; m.items.push(t);
    if (/배달/.test(t.cls)) { m.deliv++; m.delivAmt += t.amount; } if (/술\/유흥/.test(t.cls)) m.booze += t.amount;
  });
  const incBy = {}; state.tx.filter(t => t.kind === 'income').forEach(t => incBy[t._m] = (incBy[t._m] || 0) + t.amount);
  const keys = Object.keys(B).sort(), curKey = today.slice(0, 7);
  const note = k => k === curKey ? ' (진행 중)' : (k === keys[0] && +B[k].first.slice(8) > 9 ? ' (일부 기간)' : '');
  if (!state.aMonth || !B[state.aMonth]) state.aMonth = [...keys].reverse().find(k => B[k].n >= 5) || keys[keys.length - 1];
  let h = '';

  // --- next card payment ---
  const cyc = {};
  spend.filter(t => t.pay === 'card').forEach(t => {
    const k = cycleKey(t.tx_date), c = cyc[k] ??= { use: 0, n: 0, 고정: 0, 변동: 0, 비정기: 0, deliv: 0, delivAmt: 0, booze: 0 };
    c.use += t.amount; c.n++; c[t._n] += t.amount; if (/배달/.test(t.cls)) { c.deliv++; c.delivAmt += t.amount; } if (/술\/유흥/.test(t.cls)) c.booze += t.amount;
  });
  const ckeys = Object.keys(cyc).sort(), nextKey = cycleKey(today), nc = cyc[nextKey] || { use: 0, n: 0, 고정: 0, 변동: 0, 비정기: 0, deliv: 0, delivAmt: 0, booze: 0 };
  const r = cycleRange(nextKey), total = dnum(r.end) - dnum(r.start) + 1, el = Math.min(Math.max(dnum(today), dnum(r.start)), dnum(r.end)) - dnum(r.start) + 1;
  const est = el >= 5 && today < r.end ? nc.use / el * total : null;
  const dday = Math.ceil(dnum(r.pay) - dnum(today));
  h += `<div class="card"><h2>다음 카드 결제 <small>${r.pay.replace(/-/g, '.')} · D-${Math.max(0, dday)} · 사용분 ${r.start.replace(/-/g, '.')} ~ ${r.end.replace(/-/g, '.')}</small></h2>
    ${meter('청구 예정액 / 카드 한도', nc.use, S.cardLimit, `<b>${won(nc.use)}</b> / ${won(S.cardLimit)} ${tag(nc.use > S.cardLimit ? '⚠ 한도 초과' : '정상')}`)}
    <table><tr><th>건수</th><th>고정</th><th>변동</th><th>비정기</th><th>배달</th><th>술·유흥</th></tr><tr><td>${nc.n}건</td><td>${won(nc['고정'])}</td><td>${won(nc['변동'])}</td><td>${won(nc['비정기'])}</td><td>${nc.deliv}건 ${won(nc.delivAmt)}</td><td>${won(nc.booze)}</td></tr></table>
    ${est != null ? `<div class="note">${el}/${total}일 경과 · 이 속도면 청구액 약 <b>${won(est)}</b> (한도의 ${pct(est / S.cardLimit)})</div>` : ''}</div>`;

  // --- monthly ---
  const mrows = keys.slice(-12).map(k => ({ k, ...B[k], label: k.slice(2) }));
  h += `<div class="card"><h2>월별 지출 <small>카드대금·저축 제외</small></h2>${barChart(mrows, S.monthLimit)}
    <div style="height:10px"></div><table><tr><th>월</th><th>지출 계</th><th>수입</th><th>판정</th><th>배달</th><th>술·유흥</th></tr>
    ${[...mrows].reverse().map(m => `<tr><td>${m.k}<span class="note">${note(m.k)}</span></td><td><b>${won(m.total)}</b></td><td>${won(incBy[m.k] || 0)}</td><td>${tag(m.total > S.monthLimit ? '⚠ 초과' : '정상')}</td><td>${m.deliv}건</td><td>${won(m.booze)}</td></tr>`).join('')}</table>
    <div class="note">진행 중이거나 일부 기간만 있는 달은 한도 판정이 의미 없습니다.</div></div>`;

  // --- month detail ---
  const cur = B[state.aMonth], cats = Object.entries(cur.cats).sort((a, b) => b[1] - a[1]);
  const irreg = cur.items.filter(t => t._n === '비정기').sort((a, b) => a.tx_date < b.tx_date ? 1 : -1), top = [...cur.items].sort((a, b) => b.amount - a.amount).slice(0, 8);
  h += `<div class="card"><h2>월 상세 <small><select id="aMonth" style="width:auto;font-size:13px;padding:4px 8px">${[...keys].reverse().map(k => `<option value="${k}" ${k === state.aMonth ? 'selected' : ''}>${k}${note(k)}</option>`).join('')}</select></small></h2>
    ${meter('월 생활비 한도', cur.total, S.monthLimit, `<b>${won(cur.total)}</b> / ${won(S.monthLimit)}${cur.total > S.monthLimit ? ' · ' + won(cur.total - S.monthLimit) + ' 초과' : ''}`)}
    ${meter('배달 (월 한도 횟수)', cur.deliv, S.deliveryLimit, `<b>${cur.deliv}건</b> · ${won(cur.delivAmt)}`)}
    <div class="two"><div><div class="note" style="margin:0 0 6px">대분류별</div>${cats.map(([c, v]) => `<div class="hbar"><span class="lbl">${esc(c)}</span><span class="track"><span style="width:${(v / cats[0][1] * 100).toFixed(1)}%"></span></span><span class="val">${won(v)} · ${pct(v / cur.total)}</span></div>`).join('')}</div>
      <div><div class="note" style="margin:0 0 6px">큰 지출 TOP 8</div><table>${top.map(t => `<tr><td>${mmdd(t.tx_date)} ${esc(t.place || t.memo)}</td><td>${won(t.amount)}</td></tr>`).join('')}</table></div></div>
    <div class="note" style="margin:14px 0 6px">비정기 ${irreg.length}건 · ${won(cur['비정기'])}</div>
    ${irreg.length ? `<table>${irreg.map(t => `<tr><td>${mmdd(t.tx_date)} ${esc(t.place || t.memo)}</td><td>${esc(t.cls)}</td><td>${won(t.amount)}</td></tr>`).join('')}</table>` : '<div class="note">없음</div>'}
    ${cur.cats['미분류'] ? `<div class="banner warn" style="margin-top:12px">분류가 비어 있는 지출 ${won(cur.cats['미분류'])}이 있습니다.</div>` : ''}</div>`;

  // --- year limits ---
  const yr = today.slice(0, 4), boozeYtd = spend.filter(t => t._m.startsWith(yr) && /술\/유흥/.test(t.cls)).reduce((s, t) => s + t.amount, 0);
  h += `<div class="card"><h2>연간 한도 <small>${yr}년 누적</small></h2>${meter('술·유흥', boozeYtd, S.boozeYear, `<b>${won(boozeYtd)}</b> / ${won(S.boozeYear)} (${pct(boozeYtd / S.boozeYear)})`)}</div>`;

  // --- cycles ---
  h += `<div class="card"><h2>카드 청구주기별 <small>${S.cycleStart}일 ~ 익월 ${S.cycleStart - 1}일 사용분이 ${S.payDay}일에 결제</small></h2><table><tr><th>결제일</th><th>사용액</th><th>건수</th><th>변동</th><th>비정기</th><th>판정</th></tr>
    ${[...ckeys].reverse().slice(0, 12).map(k => { const c = cyc[k]; return `<tr><td>${cycleRange(k).pay.replace(/-/g, '.')}</td><td><b>${won(c.use)}</b></td><td>${c.n}</td><td>${won(c['변동'])}</td><td>${won(c['비정기'])}</td><td>${tag(c.use > S.cardLimit ? '⚠ 한도 초과' : '정상')}</td></tr>`; }).join('')}</table>
    <div class="note">카드 한도 ${won(S.cardLimit)} (설정에서 변경)</div></div>`;
  view().innerHTML = h;
  $('#aMonth').onchange = e => { state.aMonth = e.target.value; viewAnalysis(); };
}

function viewSettings() {
  const S = state.settings, rules = Object.entries(state.rules).sort((a, b) => a[0].localeCompare(b[0], 'ko'));
  view().innerHTML = `<div class="card"><h2>한도·카드 설정</h2><div class="row2">
      <div><label class="f">월 생활비 한도(원)</label><input id="sMonth" inputmode="numeric" value="${S.monthLimit}"></div><div><label class="f">카드 사용 한도(원)</label><input id="sCard" inputmode="numeric" value="${S.cardLimit}"></div>
      <div><label class="f">배달 월 한도(회)</label><input id="sDel" inputmode="numeric" value="${S.deliveryLimit}"></div><div><label class="f">술·유흥 연 한도(원)</label><input id="sBooze" inputmode="numeric" value="${S.boozeYear}"></div>
      <div><label class="f">카드 청구 시작일(일)</label><input id="sCs" inputmode="numeric" value="${S.cycleStart}"></div><div><label class="f">카드 결제일(일)</label><input id="sPd" inputmode="numeric" value="${S.payDay}"></div></div>
    <button class="btn" data-act="saveSettings">설정 저장</button></div>

    <div class="card"><h2>분류 규칙 <small>대분류(또는 '대분류>소분류') → 성격</small></h2>
      <table>${rules.map(([k, n]) => `<tr><td>${esc(k)}</td><td><select data-rule="${esc(k)}" style="width:auto;padding:4px 8px;font-size:14px">${NATURES.map(x => `<option ${x === n ? 'selected' : ''}>${x}</option>`).join('')}</select></td><td>${state.rules[k] !== DEFAULT_RULES[k] || !(k in DEFAULT_RULES) ? `<button class="btn sec sm" data-act="delRule" data-key="${esc(k)}">삭제</button>` : ''}</td></tr>`).join('')}</table>
      <div class="row2" style="margin-top:12px"><input id="rKey" placeholder="예: 건강/문화>PT"><select id="rNat">${NATURES.map(x => `<option>${x}</option>`).join('')}</select></div>
      <button class="btn sec" data-act="addRule">규칙 추가</button>
      <div class="note">우선순위: 세부 예외 → 카드대금·저축/보험은 제외 → 내역의 '고정/비정기' 표시 → 대분류 기본값</div></div>

    <div class="card"><h2>데이터 가져오기·내보내기</h2>
      <label class="f">기존 내역 가져오기 (import.json)</label><input id="fImport" type="file" accept=".json,application/json">
      <div class="note">카드·은행·지출점검시트 엑셀은 입력 탭의 '엑셀 올리기'에서 올리세요.</div>
      <div class="row2" style="margin-top:14px"><button class="btn sec" data-act="exportJson" style="margin:0">백업(JSON)</button><button class="btn sec" data-act="exportCsv" style="margin:0">엑셀용(CSV)</button></div>
      <div class="note">전체 ${state.tx.length}건 저장됨. 백업 파일에는 개인 내역이 들어 있으니 인터넷에 올리지 마세요.</div></div>

    <div class="card"><h2>계정</h2><div class="note" style="margin:0 0 10px">${DEMO ? '미리보기 모드 — 이 화면의 데이터는 새로고침하면 사라집니다.' : '로그인: ' + esc(state.user?.email || '')}</div>
      ${DEMO ? '' : '<button class="btn sec" data-act="logout">로그아웃</button>'}</div>`;
  $('#fImport').onchange = e => e.target.files[0] && doImport(e.target.files[0]);
  view().querySelectorAll('[data-rule]').forEach(s => s.onchange = async () => { await run(async () => { await backend.setRules([{ key: s.dataset.rule, nature: s.value }]); state.rules[s.dataset.rule] = s.value; prep(); toast('규칙 변경됨'); }); });
}

// ---------- 자산 탭 (자산관리시트 스냅샷) ----------
const aS = (sheet, addr) => (state.asset && state.asset.sheets && state.asset.sheets[sheet]) ? state.asset.sheets[sheet][addr] : undefined;
const aNum = v => typeof v === 'number' ? v : null;
const aPct = (v, d = 1) => v == null ? '-' : (v * 100).toFixed(d) + '%';
const aSgn = v => v > 0 ? '+' : '';
const aToDate = n => new Date(Date.UTC(1899, 11, 30) + n * 86400000);
const aYmd = n => { const d = aToDate(n); return `${d.getUTCFullYear()}.${p2(d.getUTCMonth() + 1)}.${p2(d.getUTCDate())}`; };
const aStatusCls = t => { t = String(t || ''); if (/⚠|미달|이탈|초과|부족|우선/.test(t)) return 'warn'; if (/정상|충족|양호/.test(t)) return 'ok'; return 'na'; };
const aTag = t => t ? `<span class="tag ${aStatusCls(t)}">${esc(t)}</span>` : '';
function assetLatestLabel(asset) {
  const sh = asset && asset.sheets && asset.sheets['월별기록']; let mx = null;
  if (sh) for (let r = 5; r <= 80; r++) { const v = sh['A' + r]; if (typeof v === 'number' && (mx == null || v > mx)) mx = v; }
  return mx == null ? '-' : aYmd(mx);
}
function aMonths() {
  const rows = [];
  for (let r = 5; r <= 80; r++) {
    const a = aNum(aS('월별기록', 'A' + r));
    if (a == null) break;
    const g = c => aNum(aS('월별기록', c + r));
    rows.push({ r, date: a, doyak: g('B'), cheongyak: g('C'), pension: g('D'), cash: g('E'), deposit: g('F'), debt: g('G'),
      core: g('H'), lead: g('I'), indiv: g('J'), bond: g('K'), infl: g('L'), bucket: g('M'), total: g('N'),
      inflow: g('S'), gain: g('T'), pnl: g('U'), cumIn: g('V'), cumPnl: g('W'), cumRet: g('X'), risk: g('AA') });
  }
  return rows;
}
function aLineChart(pts, fmt) {
  const W = 420, H = 150, pl = 8, pr = 8, pt = 22, pb = 24;
  if (!pts.length) return '';
  const ys = pts.map(p => p.y), min = Math.min(...ys), max = Math.max(...ys);
  const span = (max - min) || Math.abs(max) * 0.1 || 1;
  const lo = min - span * 0.25, hi = max + span * 0.25;
  const x = i => pts.length === 1 ? W / 2 : pl + (W - pl - pr) * i / (pts.length - 1);
  const y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const dots = pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="3.5" fill="var(--accent)"/>
    <text x="${x(i)}" y="${y(p.y) - 8}" text-anchor="middle" style="fill:var(--text)">${fmt(p.y)}</text>
    <text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.x)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/>${dots}</svg>`;
}
function aNext21() {
  const now = new Date(); let d = new Date(now.getFullYear(), now.getMonth(), 21);
  if (now.getDate() > 21) d = new Date(now.getFullYear(), now.getMonth() + 1, 21);
  return { date: d, days: Math.ceil((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000) };
}
function aMonthStats() {
  const B = {};
  state.tx.filter(isSpend).forEach(t => { const m = B[t._m] ??= { total: 0, n: 0, first: t.tx_date }; m.total += t.amount; m.n++; if (t.tx_date < m.first) m.first = t.tx_date; });
  return B;
}
// 이번 달 지출 카드 (가계부 기록 기준)
function assetSpendCard() {
  const cur = todayISO().slice(0, 7), B = aMonthStats(), c = B[cur] || { total: 0, n: 0 }, S = state.settings, today = todayISO();
  const last = state.tx.filter(t => t.tx_date <= today).reduce((m, t) => t.tx_date > m ? t.tx_date : m, '0000-00-00');
  return `<div class="card"><h2>이번 달 지출 <small>가계부 · 마지막 기록 ${last === '0000-00-00' ? '없음' : last.replace(/-/g, '.')}</small></h2>
    ${meter(`${cur.replace('-', '.')} 지출 (카드대금·저축 제외)`, c.total, S.monthLimit, `<b>${won(c.total)}</b> / ${won(S.monthLimit)} · ${c.n}건`)}</div>`;
}
// 사다리 3단계 조건 중 '지출 6개월 실측 목표 이내'를 가계부 기록으로 계산
function assetLadderCond() {
  const B = aMonthStats(), S = state.settings, keys = Object.keys(B).sort(), cur = todayISO().slice(0, 7);
  const complete = keys.filter(k => k < cur && !(k === keys[0] && +B[k].first.slice(8) > 9));
  const last6 = complete.slice(-6), ok = last6.filter(k => B[k].total <= S.monthLimit).length;
  const avg = last6.length ? last6.reduce((s, k) => s + B[k].total, 0) / last6.length : 0;
  return `<div class="cond"><b>3단계 조건(지출 6개월 실측)</b> — 한도 ${won(S.monthLimit)} 이내 ${ok}/6개월${last6.length ? ` · 최근 ${last6.length}개월 평균 ${won(avg)}` : ' · 아직 완성된 달이 없음'}
    <div class="prog"><span style="width:${(ok / 6 * 100).toFixed(0)}%"></span></div>
    <div class="note" style="margin:4px 0 0">${last6.map(k => `${k.slice(2)} ${(B[k].total / 10000).toFixed(0)}만 ${B[k].total <= S.monthLimit ? '○' : '✕'}`).join(' · ')}</div></div>`;
}

function viewAsset() {
  if (!state.asset) {
    view().innerHTML = `<div class="card"><h2>자산</h2><div class="note" style="margin:0">아직 자산관리시트를 올리지 않았습니다. 입력 탭 → '엑셀 올리기'에서 자산관리시트_YYMMDD.xlsx를 올리세요.</div></div>
      ${state.assetErr ? `<div class="banner warn">자산 데이터를 불러오지 못했습니다: ${esc(state.assetErr)} (Supabase에 asset_snapshots 표가 있는지 확인하세요)</div>` : ''}`;
    return;
  }
  const M = aMonths();
  if (!M.length) { view().innerHTML = '<div class="card neg">월별기록에서 데이터를 찾지 못했습니다.</div>'; return; }
  const L = M[M.length - 1], P = M.length > 1 ? M[M.length - 2] : null;
  const n21 = aNext21();
  const up = state.asset.uploaded_at ? new Date(state.asset.uploaded_at) : null;
  const upTxt = up && !isNaN(up) ? `${up.getFullYear()}.${p2(up.getMonth() + 1)}.${p2(up.getDate())} ${p2(up.getHours())}:${p2(up.getMinutes())}` : '-';
  let h = `<div class="note" style="margin:0 0 10px">기준: ${aYmd(L.date)} 월별기록 · 파일 ${esc(state.asset.file_name || '-')} · 업로드 ${upTxt}</div>`;

  // ---- banner: 21일 리마인더 / 기록 지연 ----
  const daysSince = Math.floor((Date.now() - aToDate(L.date).getTime()) / 86400000);
  h += daysSince > 35
    ? `<div class="banner warn">마지막 기록이 ${daysSince}일 전입니다. 매월 21일 루틴(시트 갱신)을 확인하세요. 다음 21일: ${n21.date.getMonth() + 1}월 21일 (D-${n21.days})</div>`
    : `<div class="banner ok">기록은 최신입니다. 다음 21일 루틴: ${n21.date.getMonth() + 1}월 21일 (D-${n21.days})</div>`;

  // ---- hero ----
  h += `<div class="card hero"><div style="color:var(--sub);font-size:13px">순자산 (${aYmd(L.date)})</div>
    <div class="big">${won(L.total)}</div>
    <div class="row">
      ${P ? `<div>전월 대비 자산 증가<b class="${L.gain >= 0 ? 'pos' : 'neg'}">${aSgn(L.gain)}${won(L.gain)}</b></div>
      <div>├ 저축 유입 (내가 넣은 돈)<b>${won(L.inflow)}</b></div>
      <div>└ 운용손익 (시장이 준 돈)<b class="${L.pnl >= 0 ? 'pos' : 'neg'}">${aSgn(L.pnl)}${won(L.pnl)}</b></div>` : ''}
      <div>투자 버킷 누적 수익률<b class="${(L.cumRet || 0) >= 0 ? 'pos' : 'neg'}">${aSgn(L.cumRet)}${aPct(L.cumRet)}</b></div>
      <div>누적 손익<b class="${(L.cumPnl || 0) >= 0 ? 'pos' : 'neg'}">${aSgn(L.cumPnl)}${won(L.cumPnl)}</b></div>
    </div></div>`;

  h += assetSpendCard();

  // ---- alerts ----
  const alertRows = [
    [60, '마이너스통장 잔액 (최우선)', 'won'], [61, '즉시 가용 현금', 'won'], [62, '현금 완충 (경성 제약)', 'won'],
    [63, '액티브 비중', 'pct'], [64, '코어 비중 (액티브 이상이어야 함)', 'pct'], [65, '위험자산 비중 (규칙 1 ⑥·⑦)', 'pct']
  ];
  const ar = alertRows.map(([r, label, kind]) => {
    const cur = aNum(aS('대시보드', 'C' + r)), st = aS('대시보드', 'D' + r);
    return `<tr><td>${label}</td><td>${esc(aS('대시보드', 'B' + r))}</td><td><b>${kind === 'won' ? won(cur) : aPct(cur)}</b></td><td>${aTag(st)}</td></tr>`;
  }).join('');
  const warns = alertRows.filter(([r]) => aStatusCls(aS('대시보드', 'D' + r)) === 'warn').length;
  h += `<div class="card"><h2>경보 점검 <small>${warns ? warns + '건 확인 필요' : '모두 정상'}</small></h2>
    <table><tr><th>항목</th><th>기준</th><th>현재</th><th>상태</th></tr>${ar}</table>
    ${P && L.risk != null && P.risk != null ? `<div class="note" style="margin-top:10px">위험자산 비중 추이: ${aPct(P.risk)} → ${aPct(L.risk)} ${L.risk < P.risk ? '(개선 중 — 매도 없이 유입으로 조정)' : L.risk > P.risk ? '(악화)' : '(변화 없음)'}</div>` : ''}</div>`;

  // ---- asset composition ----
  const comp = [
    ['청년도약계좌', L.doyak, 'var(--c1)'], ['주택청약저축', L.cheongyak, 'var(--c2)'], ['연금저축', L.pension, 'var(--c3)'],
    ['현금성(생활)', L.cash, 'var(--c4)'], ['증권 예수금', L.deposit, 'var(--c5)'], ['투자 버킷', L.bucket, 'var(--c6)']
  ];
  const gross = comp.reduce((s, c) => s + (c[1] || 0), 0);
  h += `<div class="card"><h2>자산 구성 <small>총자산 ${won(gross)} − 부채 ${won(Math.abs(L.debt || 0))}</small></h2>
    <div class="stack">${comp.map(c => `<span style="width:${((c[1] || 0) / gross * 100).toFixed(2)}%;background:${c[2]}"></span>`).join('')}</div>
    <table>${comp.map(c => `<tr><td><span class="legend"><span><i style="background:${c[2]}"></i></span></span>${c[0]}</td><td>${won(c[1])}</td><td>${aPct((c[1] || 0) / gross)}</td></tr>`).join('')}
    <tr><td><span class="legend"><span><i style="background:var(--debt)"></i></span></span>부채 (마이너스통장)</td><td class="neg">${won(L.debt)}</td><td></td></tr></table>
    <div class="note" style="margin-top:10px">투자자산(시장 노출) ${won(aNum(aS('대시보드', 'B17')))} (${aPct(aNum(aS('대시보드', 'C17')))}) · 비투자자산 ${won(aNum(aS('대시보드', 'B18')))} (${aPct(aNum(aS('대시보드', 'C18')))})</div></div>`;

  // ---- trend ----
  h += `<div class="two"><div class="card"><h2>순자산 추이</h2>${aLineChart(M.map(m => ({ x: aYmd(m.date).slice(2, 7), y: m.total })), v => (v / 10000).toFixed(0) + '만')}</div>
    <div class="card"><h2>투자 버킷 누적 수익률</h2>${aLineChart(M.filter(m => m.cumRet != null).map(m => ({ x: aYmd(m.date).slice(2, 7), y: m.cumRet })), v => (v * 100).toFixed(1) + '%')}</div></div>`;

  // ---- bucket tiers ----
  const tierRow = r => {
    const name = aS('대시보드', 'A' + r);
    const cells = ['B', 'C', 'D', 'E', 'F', 'G'].map(c => aS('대시보드', c + r));
    return `<tr><td>${esc(name)}</td><td>${typeof cells[0] === 'number' ? aPct(cells[0], 0) : esc(cells[0])}</td><td>${won(aNum(cells[1]))}</td><td><b>${aPct(aNum(cells[2]))}</b></td>
      <td>${typeof cells[4] === 'number' ? aPct(cells[4], 0) : '-'} ~ ${typeof cells[5] === 'number' ? aPct(cells[5], 0) : '-'}</td><td>${aTag(aS('대시보드', 'H' + r))}</td></tr>`;
  };
  h += `<div class="card"><h2>투자 버킷 비중 <small>${esc(aS('대시보드', 'D4') || '')}</small></h2>
    <table><tr><th>1층 — 위험/안전</th><th>목표</th><th>금액</th><th>현재</th><th>허용 범위</th><th>판정</th></tr>${tierRow(36)}${tierRow(37)}</table>
    <div style="height:14px"></div>
    <table><tr><th>2층 — 슬리브</th><th>목표</th><th>금액</th><th>현재</th><th>허용 범위</th><th>판정</th></tr>${[41, 42, 43, 44, 45].map(tierRow).join('')}</table></div>`;

  // ---- ladder ----
  const curStep = aNum(aS('대시보드', 'E2')) ?? 0, reach = aNum(aS('사다리', 'B12'));
  let streak = 0; for (let i = M.length - 1; i >= 0; i--) { if ((M[i].debt ?? -1) >= 0) streak++; else break; }
  const CASH_GOAL = 7050000, cashPct = Math.min(1, (L.cash || 0) / CASH_GOAL);
  h += `<div class="card"><h2>위험자산 사다리 <small>현재 ${curStep}단계 · 엑셀 판정 도달 가능 ${reach ?? '-'}단계</small></h2><div class="steps">${[6, 7, 8, 9, 10].map((r, i) => `
    <div class="step ${i === curStep ? 'cur' : ''}"><div class="n">${aS('사다리', 'A' + r)}단계 ${i === curStep ? '◀ 현재' : ''}</div>
    <div class="p">위험 ${aPct(aNum(aS('사다리', 'C' + r)), 0)} · 코어 ${aPct(aNum(aS('사다리', 'D' + r)), 0)}</div>
    <div style="margin-top:6px">${esc(aS('사다리', 'B' + r))}</div></div>`).join('')}</div>
    <div class="cond"><b>1단계 조건</b> — 마이너스통장 0원 연속 ${streak}/3개월 기록 ${L.debt < 0 ? `(현재 부채 ${won(Math.abs(L.debt))})` : ''}
      <div class="prog"><span style="width:${Math.min(100, streak / 3 * 100).toFixed(0)}%"></span></div></div>
    <div class="cond"><b>2단계 조건</b> — 현금 완충 ${won(L.cash)} / ${won(CASH_GOAL)} (${aPct(cashPct)})
      <div class="prog"><span style="width:${(cashPct * 100).toFixed(1)}%"></span></div></div>
    ${assetLadderCond()}
    <div class="cond" style="color:var(--sub)">3단계의 나머지 조건(규칙 5-B 12개월)과 4단계(-20% 하락 통과)는 엑셀 「사다리」 시트에서 직접 확인하세요.</div></div>`;

  // ---- holdings ----
  const hold = [];
  for (let r = 4; r <= 40; r++) { const nm = aS('종목기록', 'A' + r); if (typeof nm === 'string' && aNum(aS('종목기록', 'D' + r)) != null && !nm.startsWith('※')) hold.push(r); }
  h += `<div class="card"><h2>보유 종목</h2><table><tr><th>종목</th><th>슬리브</th><th>평가액</th><th>평가손익</th><th>버킷 대비</th><th>상태</th></tr>${hold.map(r => {
    const pnl = aNum(aS('종목기록', 'F' + r));
    return `<tr><td>${esc(aS('종목기록', 'A' + r))} <span style="color:var(--sub);font-size:12px">${esc(aS('종목기록', 'M' + r) || '')}</span></td><td>${esc(aS('종목기록', 'B' + r))}</td><td>${won(aNum(aS('종목기록', 'D' + r)))}</td>
      <td class="${pnl >= 0 ? 'pos' : 'neg'}">${aSgn(pnl)}${won(pnl)}</td><td>${aPct(aNum(aS('종목기록', 'G' + r)))}</td><td>${aTag(aS('종목기록', 'L' + r))}</td></tr>`;
  }).join('')}</table>
  ${hold.some(r => /소급/.test(String(aS('종목기록', 'I' + r) || ''))) ? '<div class="note" style="margin-top:10px">⚠ 반증 조건·매도 기준이 비어 있는 주도주가 있습니다 (엑셀 「종목기록」 I·J열 — 소급 작성 필요).</div>' : ''}</div>`;

  // ---- rule compliance ----
  h += `<div class="card"><h2>규칙 5-B 준수 <small>종합: ${esc(aS('규칙준수', 'B11') || '-')}</small></h2><table><tr><th>지표</th><th>분모</th><th>분자</th><th>상태</th></tr>${[7, 8, 9].map(r =>
    `<tr><td>${esc(aS('규칙준수', 'A' + r))}</td><td>${aS('규칙준수', 'B' + r) ?? '-'}</td><td>${aS('규칙준수', 'C' + r) ?? '-'}</td><td>${aTag(aS('규칙준수', 'E' + r))}</td></tr>`).join('')}</table></div>`;

  // ---- goal ----
  const g16 = aNum(aS('목표계산', 'B16')), g17 = aNum(aS('목표계산', 'B17')), g18 = aNum(aS('목표계산', 'B18'));
  let goalRows = '';
  for (let r = 10; r <= 12; r++) {
    const amt = aNum(aS('목표계산', 'B' + r)); if (!amt) continue;
    goalRows += `<tr><td>${esc(aS('목표계산', 'A' + r))}</td><td>${won(amt)}</td><td>${aS('목표계산', 'C' + r)}년 후</td><td>${won(aNum(aS('목표계산', 'D' + r)))}</td><td><b>${won(aNum(aS('목표계산', 'H' + r)))}</b></td></tr>`;
  }
  h += `<div class="card"><h2>목표 관리 <small>월 필요 적립액 vs 실제 저축</small></h2>
    <table><tr><th>목표</th><th>목표 금액(오늘 돈)</th><th>시점</th><th>준비금</th><th>필요 월적립</th></tr>${goalRows}</table>
    <div style="margin-top:12px;font-size:14px">필요 합계 <b>${won(g16)}</b> · 실제 저축 <b>${won(g17)}</b> · 부족 <b class="${g18 > 0 ? 'neg' : 'pos'}">${won(g18)}</b></div>
    <div class="note">${esc(aS('목표계산', 'B19') || '')} (현금 완충 705만원 달성 전까지는 참고용)</div></div>`;

  view().innerHTML = h;
}

function render() {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  ({ input: viewInput, history: viewHistory, analysis: viewAnalysis, asset: viewAsset, settings: viewSettings })[state.tab]();
  window.scrollTo(0, 0);
}

// ---------- actions ----------
async function run(fn) { try { await fn(); } catch (e) { toast('오류: ' + (e.message || e)); console.error(e); } }

function openModal(html) { const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.hidden = false; m.onclick = e => { if (e.target === m) closeModal(); }; }
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

const handlers = {
  save: () => run(async () => {
    const row = { ...readForm('f_'), source: 'app', import_key: null };
    const saved = await backend.addTx(row); state.tx.push(saved); prep(); toast('저장됨');
    const keepDate = row.tx_date; viewInput(); const d = $('#f_date'); if (d) d.value = keepDate;
  }),
  edit: el => {
    const t = state.tx.find(x => x.id === el.dataset.id); if (!t) return;
    openModal(`<h2 style="margin:0 0 6px;font-size:16px">내역 수정</h2>${formHtml('m_', t)}<button class="btn" data-act="update" data-id="${t.id}">수정 저장</button>
      <button class="btn del" data-act="remove" data-id="${t.id}">삭제</button><button class="btn sec" data-act="closeModal">닫기</button>`);
    wireForm('m_');
  },
  update: el => run(async () => {
    const row = readForm('m_'), i = state.tx.findIndex(x => x.id === el.dataset.id);
    state.tx[i] = await backend.updateTx(el.dataset.id, row); prep(); closeModal(); toast('수정됨'); render();
  }),
  remove: el => run(async () => {
    if (!confirm('이 내역을 삭제할까요?')) return;
    await backend.deleteTx(el.dataset.id); state.tx = state.tx.filter(x => x.id !== el.dataset.id); prep(); closeModal(); toast('삭제됨'); render();
  }),
  closeModal: () => closeModal(),
  saveSettings: () => run(async () => {
    const n = id => parseInt($(id).value.replace(/\D/g, ''), 10);
    const s = { monthLimit: n('#sMonth'), cardLimit: n('#sCard'), deliveryLimit: n('#sDel'), boozeYear: n('#sBooze'), cycleStart: n('#sCs'), payDay: n('#sPd') };
    if (Object.values(s).some(v => !v && v !== 0)) throw new Error('숫자를 확인하세요'); if (s.cycleStart < 2 || s.cycleStart > 28 || s.payDay < 1 || s.payDay > 28) throw new Error('일자는 청구 시작 2~28, 결제일 1~28');
    await backend.saveSettings(s); state.settings = { ...DEFAULT_SETTINGS, ...s }; toast('설정 저장됨');
  }),
  addRule: () => run(async () => {
    const k = $('#rKey').value.trim(); if (!k) throw new Error('분류를 입력하세요');
    await backend.setRules([{ key: k, nature: $('#rNat').value }]); state.rules[k] = $('#rNat').value; prep(); toast('규칙 추가됨'); viewSettings();
  }),
  delRule: el => run(async () => { const k = el.dataset.key; await backend.delRule(k); if (k in DEFAULT_RULES) state.rules[k] = DEFAULT_RULES[k]; else delete state.rules[k]; prep(); viewSettings(); }),
  logout: () => run(async () => { await backend.signOut(); }),
  exportJson: () => download('가계부백업_' + todayISO() + '.json', JSON.stringify({ tx: state.tx.map(({ _n, _m, id, user_id, created_at, ...r }) => r), rules: Object.entries(state.rules).map(([key, nature]) => ({ key, nature })), settings: state.settings }, null, 1), 'application/json'),
  exportCsv: () => {
    const head = ['날짜', '구분', '금액', '결제', '사용처', '내역', '분류', '태그', '성격'];
    const lines = [head, ...[...state.tx].sort((a, b) => a.tx_date < b.tx_date ? -1 : 1).map(t => [t.tx_date, t.kind === 'income' ? '수입' : '지출', t.amount, t.pay === 'card' ? '카드' : '현금·계좌', t.place, t.memo, t.cls, t.tag, t._n])];
    download('가계부_' + todayISO() + '.csv', '﻿' + lines.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'), 'text/csv');
  }
};
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

async function doImport(file) {
  await run(async () => {
    const j = JSON.parse(await file.text());
    if (j.rules?.length) { await backend.setRules(j.rules); j.rules.forEach(r => state.rules[r.key] = r.nature); }
    if (j.settings) { state.settings = { ...DEFAULT_SETTINGS, ...j.settings }; await backend.saveSettings(state.settings); }
    const rows = (j.tx || []).map(r => ({ ...r, import_key: r.import_key || ('bk|' + r.tx_date + '|' + r.amount + '|' + r.place + '|' + r.memo) }));
    const n = await backend.importTx(rows); const all = await backend.loadAll(); state.tx = all.tx; prep();
    toast(`${n}건 가져옴 (이미 있던 ${rows.length - n}건 제외)`); viewSettings();
  });
}

// ---------- 카드·은행 엑셀 가져오기 ----------
// 규칙은 기존 card2naver.py / bank2naver.py와 동일: 취소 제외, 금액=매입금액(없으면 승인금액), 할부는 월별 분할, 은행의 카드대금 출금은 기본 제외
const CARD_PAT = /하나카드|우리카드|국민카드|KB카드|신한카드|삼성카드|현대카드|롯데카드|BC카드|카드결제|카드출금/;
const sp1 = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const cellStr = v => String(v ?? '').replace(/\n/g, '').trim();
const toNum = v => { const n = parseFloat(String(v).replace(/[^\d.-]/g, '')); return isNaN(n) ? 0 : n; };
const normPlace = s => String(s || '').replace(/\s*\(할부 \d+\/\d+\)/g, '').replace(/\[\d+\/\d+개월\]\s*/g, '').replace(/\s+/g, ' ').trim();
const mergeTag = (...ts) => [...new Set(ts.flatMap(t => String(t || '').split(',')).map(s => s.trim()).filter(Boolean))].join(',');
function cellDate(v) {
  if (v instanceof Date) { const d = new Date(v.getTime() + 12 * 3600 * 1000); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
  if (typeof v === 'number') return isoOf(Math.floor(v) - 25569);
  const m = /^\s*(\d{4})\D(\d{1,2})\D(\d{1,2})/.exec(String(v)); return m ? `${m[1]}-${p2(m[2])}-${p2(m[3])}` : null;
}
function addMonths(iso, k) {
  const [y, m, d] = iso.split('-').map(Number), t = new Date(Date.UTC(y, m - 1 + k, 1)), last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(Math.min(d, last))}`;
}
const colMap = row => { const m = {}; row.forEach((h, i) => { const k = cellStr(h); if (k) m[k] = i; }); return m; };

function parseCard(aoa, hi, fname) {
  const col = colMap(aoa[hi]), g = (r, k) => (k in col ? r[col[k]] : '');
  const items = []; let cancelled = 0, cancelAmt = 0;
  for (const r of aoa.slice(hi + 1)) {
    const date = cellDate(g(r, '이용일')); if (!date) continue;
    const appr = toNum(g(r, '승인금액')), buy = toNum(g(r, '매입금액')), amount = Math.round(buy > 0 ? buy : appr);
    if (cellStr(g(r, '상태')) === '취소') { cancelled++; cancelAmt += appr; continue; }
    if (amount <= 0) continue;   // 0원·환불(음수) 행은 건너뜀 (DB는 음수 금액을 받지 않음)
    let n = 1; if (cellStr(g(r, '이용구분')) === '할부') n = Math.max(1, parseInt(toNum(g(r, '할부기간')), 10) || 1);
    items.push({ date, name: sp1(g(r, '가맹점명')) || '카드', amount, n });
  }
  return { type: 'card', fname, items, cancelled, cancelAmt };
}
function parseBank(aoa, hi, fname) {
  const col = colMap(aoa[hi]), g = (r, k) => (k in col ? r[col[k]] : '');
  const items = [];
  for (const r of aoa.slice(hi + 1)) {
    const date = cellDate(g(r, '거래일시')); if (!date) continue;
    const out = Math.round(toNum(g(r, '출금액'))), inn = Math.round(toNum(g(r, '입금액'))); if (!out && !inn) continue;
    let label = '', memo = '';
    for (const k of ['보낸분/받는분', '송금메모', '적요']) { const v = sp1(g(r, k)); if (v && v !== 'nan') { if (!label) label = v; else if (!memo && v !== label) memo = v; } }
    items.push({ date, label: label || '거래', memo, out, inn });
  }
  return { type: 'bank', fname, items };
}
function parseLedger(aoa, hi, fname) {
  const col = colMap(aoa[hi]), g = (r, k) => (k in col ? r[col[k]] : '');
  const items = [];
  for (const r of aoa.slice(hi + 1)) {
    const date = cellDate(g(r, '날짜')); if (!date) continue;
    const cash = toNum(g(r, '현금')), card = toNum(g(r, '카드')), amount = Math.round(cash + card); if (amount <= 0) continue;   // 0원·환불(음수) 행은 건너뜀
    const place = sp1(g(r, '사용처')) || sp1(g(r, '사용내역')) || '거래', memoRaw = sp1(g(r, '사용내역')), memo = memoRaw === place ? '' : memoRaw;
    items.push({ date, place, memo, cash, card, amount, cls: cellStr(g(r, '분류')), tag: cellStr(g(r, '태그')) });
  }
  return { type: 'ledger', fname, items };
}
function detectAndParse(aoa, fname) {
  const find = pred => aoa.slice(0, 15).findIndex(r => pred(r.map(cellStr)));
  let hi = find(cs => cs.some(s => /^이용일/.test(s) && s.length <= 6)); if (hi >= 0) return parseCard(aoa, hi, fname);
  hi = find(cs => cs.includes('거래일시')); if (hi >= 0) return parseBank(aoa, hi, fname);
  hi = find(cs => cs.includes('날짜') && (cs.includes('사용처') || cs.includes('사용내역')) && (cs.includes('현금') || cs.includes('카드'))); if (hi >= 0) return parseLedger(aoa, hi, fname);
  return null;
}

function histMap() {   // 같은 사용처를 전에 분류한 대로 (가장 최근 기록 우선)
  const ex = new Map(), inc = new Map();
  for (const t of state.tx) { const k = normPlace(t.place); if (!k) continue; const m = t.kind === 'income' ? inc : ex; if (!m.has(k)) m.set(k, { cls: t.cls, tag: t.tag }); }
  return { ex, inc };
}
function buildCands() {
  const imp = state.imp, H = histMap(), cands = [], seen = {};
  const keyOf = (pre, date, amt, place, extra) => { const k0 = `${pre}|${date}|${amt}|${place}|${extra || ''}`; seen[k0] = (seen[k0] || 0) + 1; return `${k0}|${seen[k0]}`; };
  for (const f of imp.files) {
    if (f.type === 'card') {
      for (const it of f.items) {
        const parts = (it.n > 1 && imp.mode === 'split') ? it.n : 1, base = Math.floor(it.amount / parts), rem = it.amount - base * parts, h = H.ex.get(normPlace(it.name));
        for (let k = 0; k < parts; k++) {
          const date = parts > 1 ? addMonths(it.date, k) : it.date, amount = base + (k === 0 ? rem : 0);
          const place = parts > 1 ? `${it.name} (할부 ${k + 1}/${parts})` : (it.n > 1 ? `${it.name} (할부 ${it.n}개월 일시)` : it.name);
          cands.push({ tx_date: date, kind: 'expense', amount, pay: 'card', place, memo: '', cls: h ? h.cls : '', tag: mergeTag(h && h.tag, it.n > 1 ? '할부' : ''), source: 'card', import_key: keyOf('cd', date, amount, place, `${it.date}:${it.amount}`) });
        }
      }
    } else if (f.type === 'ledger') {
      for (const it of f.items) {
        const h = it.cls ? null : H.ex.get(normPlace(it.place));
        cands.push({ tx_date: it.date, kind: 'expense', amount: it.amount, pay: it.card > 0 ? 'card' : 'cash', place: it.place, memo: it.memo, cls: it.cls || (h && h.cls) || '', tag: it.cls ? it.tag : mergeTag(it.tag, h && h.tag), source: 'naver', import_key: keyOf('nv', it.date, it.amount, it.place, it.memo) });
      }
    } else {
      for (const it of f.items) {
        const income =!(it.out > 0), amount = income ? it.inn : it.out, cardPay = !income && CARD_PAT.test(it.label), h = (income ? H.inc : H.ex).get(normPlace(it.label));
        cands.push({ tx_date: it.date, kind: income ? 'income' : 'expense', amount, pay: 'cash', place: it.label, memo: it.memo, cls: income ? (h ? h.cls : '수입>기타수입') : (cardPay ? '카드대금' : (h ? h.cls : '')), tag: h ? h.tag : '', source: 'bank', import_key: keyOf('bn', it.date, amount, it.label, income ? 'i' : 'o'), _cardPay: cardPay });
      }
    }
  }
  const keys = new Set(state.tx.map(t => t.import_key).filter(Boolean)), multi = {};
  state.tx.forEach(t => { if (t.import_key && /^(cd|bn|nv)\|/.test(t.import_key)) return; const k = `${t.tx_date}|${t.amount}|${t.kind}`; multi[k] = (multi[k] || 0) + 1; });
  cands.forEach(c => {
    if (keys.has(c.import_key)) { c._dup = true; return; }
    const k = `${c.tx_date}|${c.amount}|${c.kind}`; if (multi[k] > 0) { multi[k]--; c._dup = true; }
    c._on = !c._dup && !(c._cardPay && !imp.incCardPay);
  });
  cands.forEach(c => { const ed = imp.ed[c.import_key]; if (!ed) return; if ('cls' in ed) c.cls = ed.cls; if ('on' in ed && !c._dup) c._on = ed.on; });   // 사용자가 바꾼 값 유지
  cands.sort((a, b) => a.tx_date < b.tx_date ? -1 : a.tx_date > b.tx_date ? 1 : 0);
  imp.cands = cands;
}

function renderImport() {
  const imp = state.imp, c = imp.cands, fresh = c.filter(x => !x._dup), on = c.filter(x => x._on);
  const cards = imp.files.filter(f => f.type === 'card'), banks = imp.files.filter(f => f.type === 'bank'), ledgers = imp.files.filter(f => f.type === 'ledger');
  const newRules = impNewRules();
  const cancelled = cards.reduce((s, f) => s + f.cancelled, 0), dup = c.filter(x => x._dup).length, cardPay = c.filter(x => x._cardPay && !x._dup).length;
  const unc = on.filter(x => x.kind === 'expense' && !x.cls).length, sumOut = on.filter(x => x.kind === 'expense' && x.cls.split('>')[0] !== '카드대금').reduce((s, x) => s + x.amount, 0), sumIn = on.filter(x => x.kind === 'income').reduce((s, x) => s + x.amount, 0);
  const catOpts = sel => ['', ...allCats()].map(x => `<option value="${esc(x)}" ${x === sel ? 'selected' : ''}>${x || '미분류'}</option>`).join('');
  const incOpts = sel => INCOME_CATS.map(x => `<option ${x === sel ? 'selected' : ''}>${x}</option>`).join('');
  const rows = fresh.map(x => { const i = c.indexOf(x); return `<tr><td><input type="checkbox" data-imp="chk" data-i="${i}" ${x._on ? 'checked' : ''} style="width:auto"></td>
    <td style="white-space:nowrap">${x.tx_date.slice(2).replace(/-/g, '.')}</td><td style="text-align:left">${esc(x.place)}${x._cardPay ? ' <span class="tag na">카드대금</span>' : ''}<div class="note" style="margin:0">${x.pay === 'card' ? '카드' : '계좌'}${x.tag ? ' · ' + esc(x.tag) : ''}</div></td>
    <td class="${x.kind === 'income' ? 'pos' : ''}" style="white-space:nowrap">${x.kind === 'income' ? '+' : '−'}${Math.round(x.amount).toLocaleString('ko-KR')}</td>
    <td>${x._cardPay ? '' : x.kind === 'income' ? `<select data-imp="cat" data-i="${i}" style="width:auto;font-size:13px;padding:4px">${incOpts(x.cls.split('>')[1])}</select>` : `<select data-imp="cat" data-i="${i}" style="width:auto;font-size:13px;padding:4px">${catOpts(x.cls ? catOf(x) : '')}</select>`}</td></tr>`; }).join('');
  $('#modal .sheet').innerHTML = `<h2 style="margin:0 0 6px;font-size:16px">엑셀 올리기</h2>
    <div class="note" style="margin:0 0 10px">카드 이용내역, 은행 거래내역, 지출점검시트(원본데이터)·네이버가계부 내려받기 파일을 한 번에 여러 개 올릴 수 있어요.</div>
    <input type="file" id="impFile" accept=".xls,.xlsx" multiple>
    ${imp.asset ? `<div class="banner ok" style="margin-top:12px">자산관리시트 ${esc(imp.asset.file_name)} — 월별기록 기준 ${assetLatestLabel(imp.asset)} · 저장하면 '자산' 탭에 반영됩니다</div>` : ''}
    ${imp.files.length ? `<div class="banner ${fresh.length ? 'ok' : 'warn'}" style="margin-top:12px">
      ${cards.length ? `카드 ${cards.reduce((s, f) => s + f.items.length, 0)}건${cancelled ? ` (취소 ${cancelled}건 제외)` : ''}` : ''}${cards.length && banks.length ? ' · ' : ''}${banks.length ? `은행 ${banks.reduce((s, f) => s + f.items.length, 0)}건` : ''}${(cards.length || banks.length) && ledgers.length ? ' · ' : ''}${ledgers.length ? `가계부 ${ledgers.reduce((s, f) => s + f.items.length, 0)}건` : ''}
      → 새 내역 <b>${fresh.length}건</b> · 이미 있어서 건너뜀 <b>${dup}건</b>${cardPay ? ` · 카드대금 ${cardPay}건` : ''}${newRules.length ? ` · 분류 규칙 ${newRules.length}개 추가 예정` : ''}</div>
      <div class="row2" style="margin-top:10px">${cards.length ? `<div><label class="f">할부 처리</label><select data-imp="mode"><option value="split" ${imp.mode === 'split' ? 'selected' : ''}>월별로 나누기 (기존 방식)</option><option value="full" ${imp.mode === 'full' ? 'selected' : ''}>한 번에 전액</option></select></div>` : ''}
      ${banks.length ? `<div><label class="f">은행의 카드대금 출금</label><select data-imp="cardpay"><option value="0" ${imp.incCardPay ? '' : 'selected'}>제외 (카드 내역과 중복)</option><option value="1" ${imp.incCardPay ? 'selected' : ''}>포함</option></select></div>` : ''}</div>
      ${newRules.length ? `<div class="note">추가될 규칙: ${newRules.map(r => `${esc(r.key)} → ${esc(r.nature)}`).join(', ')}</div>` : ''}
      <div class="note">체크를 풀면 가져오지 않습니다. 분류는 파일에 적힌 값을 쓰고, 비어 있으면 같은 사용처를 전에 분류한 대로 채웠어요. 처음 보는 곳은 '미분류'예요.${unc ? ` <b>미분류 ${unc}건</b>` : ''}</div>
      <div style="overflow-x:auto;margin-top:8px"><table><tr><th></th><th>날짜</th><th style="text-align:left">사용처</th><th>금액</th><th>분류</th></tr>${rows || '<tr><td colspan="5" class="note">새로 가져올 내역이 없습니다.</td></tr>'}</table></div>
      <div class="note" style="margin-top:8px">선택 ${on.length}건 · 지출 ${won(sumOut)} · 수입 ${won(sumIn)}</div>
      ` : ''}
    ${(imp.files.length || imp.asset) ? `<button class="btn" data-act="impGo" ${(on.length || imp.asset) ? '' : 'disabled style="opacity:.5"'}>${imp.asset ? (on.length ? `자산 저장 + ${on.length}건 가져오기` : '자산 데이터 저장') : `${on.length}건 가져오기`}</button>` : ''}
    <button class="btn sec" data-act="closeModal">닫기</button>`;
  $('#impFile').onchange = e => e.target.files.length && loadImportFiles([...e.target.files]);
}
async function loadImportFiles(files) {
  await run(async () => {
    await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    const parsed = [], ruleMap = new Map();
    state.imp.rules = []; state.imp.asset = null;
    for (const f of files) {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      if (wb.SheetNames.includes('월별기록') && wb.SheetNames.includes('대시보드')) {   // 자산관리시트: 날짜를 엑셀 일련번호 그대로 두기 위해 cellDates 없이 다시 읽음
        const wb2 = XLSX.read(buf, { type: 'array' }), sheets = {};
        for (const sn of ['목표계산', '월별기록', '대시보드', '사다리', '비중조정이력', '규칙준수', '종목기록']) {
          const ws = wb2.Sheets[sn]; if (!ws) continue;
          const o = {};
          for (const addr of Object.keys(ws)) {
            if (addr.startsWith('!')) continue;
            const cell = ws[addr]; if (!cell || cell.t === 'e' || cell.v == null || cell.v === '') continue;
            o[addr] = cell.v;
          }
          sheets[sn] = o;
        }
        state.imp.asset = { file_name: f.name, sheets };
        continue;
      }
      for (const rn of wb.SheetNames.filter(n => n.includes('분류규칙'))) {
        for (const r of XLSX.utils.sheet_to_json(wb.Sheets[rn], { header: 1, raw: true, defval: '' })) {
          for (const [ki, ni] of [[0, 1], [3, 4]]) {
            const key = cellStr(r[ki]), nature = cellStr(r[ni]);
            if (key && NATURES.includes(nature)) ruleMap.set(key, nature);
          }
        }
      }
      let res = null;
      const names = [...wb.SheetNames.filter(n => n.includes('원본데이터')), ...wb.SheetNames.filter(n => !n.includes('원본데이터'))];
      for (const sn of names) { res = detectAndParse(XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' }), f.name); if (res) break; }
      if (!res) throw new Error(`${f.name}: 카드 이용내역('이용일'), 은행 거래내역('거래일시'), 가계부/지출점검시트('날짜·사용처·현금·카드'), 자산관리시트('월별기록·대시보드' 시트) 형식이 아닙니다`);
      parsed.push(res);
    }
    state.imp.files = parsed; state.imp.rules = [...ruleMap].map(([key, nature]) => ({ key, nature })); buildCands(); renderImport();
  });
}
const impNewRules = () => (state.imp.rules || []).filter(r => !(r.key in state.rules));
handlers.openImport = () => { state.imp = { files: [], mode: 'split', incCardPay: false, cands: [], ed: {}, rules: [], asset: null }; openModal(''); renderImport(); };
handlers.impGo = () => run(async () => {
  const rows = state.imp.cands.filter(x => x._on).map(({ _dup, _on, _cardPay, ...r }) => r);
  if (!rows.length && !state.imp.asset) return;
  const parts = [];
  if (state.imp.asset) { state.asset = await backend.saveAsset(state.imp.asset); state.assetErr = ''; parts.push('자산 데이터 저장'); }
  if (rows.length) {
    const newRules = impNewRules();
    if (newRules.length) { await backend.setRules(newRules); newRules.forEach(r => { state.rules[r.key] = r.nature; }); }
    const n = await backend.importTx(rows); const all = await backend.loadAll(); state.tx = all.tx; state.asset = all.asset || state.asset; state.assetErr = all.assetErr || ''; prep();
    parts.push(`${n}건 가져옴`); if (newRules.length) parts.push(`규칙 ${newRules.length}개 추가`);
  }
  closeModal(); toast(parts.join(' · ')); render();
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-imp]'); if (!el || !state.imp) return;
  const k = el.dataset.imp, i = +el.dataset.i, c = state.imp.cands;
  const ed = x => (state.imp.ed[x.import_key] ??= {});
  if (k === 'chk') { c[i]._on = el.checked; ed(c[i]).on = el.checked; renderImportKeepScroll(); }
  else if (k === 'cat') { const x = c[i]; if (x.kind === 'income') x.cls = '수입>' + el.value; else x.cls = el.value ? (el.value === catOf(x) && x.cls ? x.cls : el.value) : ''; ed(x).cls = x.cls; renderImportKeepScroll(); }
  else if (k === 'mode') { state.imp.mode = el.value; buildCands(); renderImport(); }
  else if (k === 'cardpay') { state.imp.incCardPay = el.value === '1'; c.forEach(x => { if (x._cardPay && !x._dup) x._on = state.imp.incCardPay; }); renderImport(); }
});
function renderImportKeepScroll() { const s = $('#modal .sheet'), y = s.scrollTop; renderImport(); $('#modal .sheet').scrollTop = y; }

// ---------- boot ----------
document.addEventListener('click', e => {
  const b = e.target.closest('#nav button'); if (b) { state.tab = b.dataset.tab; render(); return; }
  const a = e.target.closest('[data-act]'); if (a && handlers[a.dataset.act]) handlers[a.dataset.act](a, e);
});

async function enter(session) {
  state.user = session.user; $('#login').hidden = true; $('#shell').hidden = false; $('#modeBadge').hidden = !DEMO;
  await run(async () => {
    const all = await backend.loadAll();
    state.tx = all.tx; state.rules = { ...DEFAULT_RULES, ...Object.fromEntries((all.rules || []).map(r => [r.key, r.nature])) };
    state.settings = { ...DEFAULT_SETTINGS, ...(all.settings || {}) }; state.asset = all.asset || null; state.assetErr = all.assetErr || ''; prep();
    if (DEMO) { const seed = new URLSearchParams(location.search).get('seed'); if (seed) { const j = await (await fetch(seed)).json(); if (j.rules) { await backend.setRules(j.rules); j.rules.forEach(r => state.rules[r.key] = r.nature); } if (j.settings) state.settings = { ...DEFAULT_SETTINGS, ...j.settings }; await backend.importTx(j.tx); state.tx = (await backend.loadAll()).tx; prep(); } }
    state.tab = new URLSearchParams(location.search).get('tab') || state.tab; render();
  });
}
function showLogin() { state.user = null; state.tx = []; $('#shell').hidden = true; $('#login').hidden = false; closeModal(); }

(async function boot() {
  if (!DEMO) { try { await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'); } catch (e) { document.body.innerHTML = '<p style="padding:20px">인터넷 연결을 확인하세요.</p>'; return; } }
  backend = DEMO ? makeMock() : makeSupabase();
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#lErr').textContent = '';
    try { await backend.signIn($('#lEmail').value.trim(), $('#lPw').value); $('#lPw').value = ''; } catch (err) { $('#lErr').textContent = '로그인에 실패했습니다. 이메일과 비밀번호를 확인하세요.'; }
  });
  // 로그인 상태 변화: 콜백 안에서 바로 서버를 호출하면 멈출 수 있어 setTimeout으로 뺀다
  backend.onAuth(s => { if (s) { if (!state.user || state.user.id !== s.user.id) setTimeout(() => enter(s), 0); } else setTimeout(showLogin, 0); });
  const s = await backend.getSession(); if (s) { if (!state.user) enter(s); } else showLogin();
})();
