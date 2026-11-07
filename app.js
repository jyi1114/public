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
let TODAY_OVERRIDE = null;   // 테스트용: DEMO 모드에서만 ?today=YYYY-MM-DD 로 오늘 날짜를 바꿈
if (DEMO) { const q = new URLSearchParams(location.search).get('today'); if (/^\d{4}-\d{2}-\d{2}$/.test(q || '')) TODAY_OVERRIDE = q; }
const todayISO = () => { if (TODAY_OVERRIDE) return TODAY_OVERRIDE; const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const dnum = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const isoOf = dn => new Date(dn * 86400000).toISOString().slice(0, 10);
const mmdd = iso => `${iso.slice(5, 7)}.${iso.slice(8, 10)}`;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const wdOf = iso => WD[new Date(dnum(iso) * 86400000).getUTCDay()];
const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200); };
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('스크립트를 불러오지 못했습니다: ' + src)); document.head.appendChild(s); });
const statusCls = t => /⚠|초과|부족|위험/.test(t || '') ? 'warn' : /정상|양호/.test(t || '') ? 'ok' : 'na';
const tag = (t, c) => t ? `<span class="tag ${c || statusCls(t)}">${esc(t)}</span>` : '';

const DELIVERY_PAT = /우아한형제들|배달의민족|배민|땡겨요|요기요|쿠팡이츠|위대한상상/;   // 배달 앱 사용처 → 가져올 때 '식비>배달'로 자동 분류
const DEFAULT_SETTINGS = { monthLimit: 2350000, cardLimit: 1910000, payDays: [{ from: '2026-07', day: 21 }, { from: '2027-01', day: 13 }], overdraftLimit: 2500000 };
const DEFAULT_RULES = { '식비': '변동', '교통/차량': '변동', '주거/통신': '고정', '생활용품': '변동', '건강/문화': '변동', '술/유흥': '변동',
  '경조사': '비정기', '여행/숙박': '비정기', '교육': '변동', '자녀': '변동', '반려동물': '변동', '세금/이자': '비정기', '카드대금': '제외', '저축/보험': '제외', '이체': '제외',
  '미분류': '변동', '기타': '변동', '용돈/기타': '변동', '의복/미용': '변동' };
const CAT_ALIAS = { '의류/미용': '의복/미용', '경조사/회비': '경조사' };
const normCls = cls => { if (!cls) return ''; const s = String(cls).replace(/\s*>\s*/g, '>').trim(), i = s.indexOf('>'), head = i < 0 ? s : s.slice(0, i); return head in CAT_ALIAS ? CAT_ALIAS[head] + (i < 0 ? '' : s.slice(i)) : s; };
const INCOME_CATS =['급여', '상여', '부수입', '이자/배당', '환급', '캐시백', '상품권할인', '기타수입'];
const payLabel = p => p === 'card' ? '카드' : p === 'prepaid' ? '대전사랑' : p === 'onnuri' ? '온누리' : '현금·계좌';
const NATURES = ['고정', '변동', '비정기', '제외'];

const state = { user: null, tx: [], rules: { ...DEFAULT_RULES }, settings: { ...DEFAULT_SETTINGS }, tab: 'input', hFilter: { month: todayISO().slice(0, 7), cats: [], kind: null }, hSort: 'new', hLimit: 200, hQuery: '', aMonth: null, form: null, asset: null, assetErr: '' };

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
  if (cls.includes('>') && (state.rulesN || state.rules)[cls]) return (state.rulesN || state.rules)[cls];   // 규칙 키의 '>' 앞뒤 띄어쓰기는 무시
  if (cat === '카드대금' || cat === '저축/보험') return '제외';
  const tags = (t.tag || '').split(',').map(s => s.trim());   // 예: '비정기,할부'
  if (tags.includes('비정기')) return '비정기';
  if (tags.includes('고정')) return '고정';
  return state.rules[cat] || '변동';
}
function prep() { state.rulesN = Object.fromEntries(Object.entries(state.rules).map(([k, v]) => [normCls(k), v])); state.tx.forEach(t => { t.cls = normCls(t.cls); t._n = natureOf(t); t._m = t.tx_date.slice(0, 7); t.amount = Number(t.amount); }); state.tx.sort((a, b) => a.tx_date < b.tx_date ? 1 : a.tx_date > b.tx_date ? -1 : (a.created_at < b.created_at ? 1 : -1)); }
const isSpend = t => t.kind === 'expense' && t._n !== '제외';
const monthsOf = () => [...new Set(state.tx.map(t => t._m))].sort().reverse();

function allCats() { return [...new Set([...Object.keys(state.rules).filter(k => !k.includes('>')).map(normCls),...state.tx.filter(t => t.kind === 'expense').map(catOf)])].filter(c => c !== '카드대금').sort((a, b) => a.localeCompare(b, 'ko')); }
function subsOf(cat) { return [...new Set(state.tx.filter(t => t.kind === 'expense' && catOf(t) === cat && subOf(t)).map(subOf))].sort((a, b) => a.localeCompare(b, 'ko')); }

// ---------- card billing cycle ----------
const PAY_FIRST_YM = '2026-07';   // 결제 목록 시작월 (이전에 저장된 결제일 기록이 더 늦게 시작해도 여기서부터)
const PAY_DAYS_OK = [1, 5, 7, 8, 10, 12, 13, 14, 15, 17, 18, 20, 21, 23];   // 하나카드 결제일 표(일시불)에 있는 결제일
const addM = (ym, k) => { const [y, m] = ym.split('-').map(Number), n = y * 12 + m - 1 + k; return `${Math.floor(n / 12)}-${p2(n % 12 + 1)}`; };
const ymDay = (ym, d) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${p2(Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate()))}`; };   // 그 달 말일을 넘으면 말일로
const payDaysOf = () => { const l = (state.settings.payDays || []).filter(e => e && /^\d{4}-\d{2}$/.test(e.from) && PAY_DAYS_OK.includes(Number(e.day))); return (l.length ? l : DEFAULT_SETTINGS.payDays).map(e => ({ from: e.from, day: Number(e.day) })).sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0); };
function periodStart(ym, day) {   // 결제월 ym·결제일 day의 청구 기간 시작일 (하나카드 일시불 표)
  return day <= 12 ? ymDay(addM(ym, -2), day + 18) : day === 13 ? ymDay(addM(ym, -1), 1) : ymDay(addM(ym, -1), day - 12);
}
function periodEnd(ym, day) {   // 청구 기간 종료일: 12일 이하 전월 (day+17)일 / 13일 전월 말일 / 14일 이상 당월 (day-13)일
  return day <= 12 ? ymDay(addM(ym, -1), day + 17) : day === 13 ? isoOf(dnum(ym + '-01') - 1) : ymDay(ym, day - 13);
}
function payments(today) {   // 첫 결제월부터 (오늘 달 + 2개월)까지: [{ ym, pay, start, end }]
  const pd = payDaysOf(), last = addM(today.slice(0, 7), 2), list = [], first = pd[0].from < PAY_FIRST_YM ? pd[0].from : PAY_FIRST_YM;
  for (let ym = first, k = 0; (ym <= last || !list.length) && k < 240; ym = addM(ym, 1), k++) {
    const day = (pd.filter(e => e.from <= ym).pop() || pd[0]).day, prev = list[list.length - 1];   // 첫 기록보다 앞선 달은 첫 결제일을 그대로 씀
    list.push({ ym, pay: ymDay(ym, day), start: prev ? isoOf(dnum(prev.end) + 1) : periodStart(ym, day), end: periodEnd(ym, day) });
  }
  return list;
}
const nextPayIdx = (list, today) => { const i = list.findIndex(p => p.pay > today); return i < 0 ? list.length - 1 : i; };   // 결제일 당일에는 다음 결제가 기본 (21일 루틴은 출금 후 잔액을 기록)

// ---------- forms ----------
function formHtml(p, t) {
  t = t || { kind: 'expense', tx_date: todayISO(), amount: '', pay: 'card', place: '', memo: '', cls: '', tag: '' };
  const inc = t.kind === 'income', cat = inc || !t.cls ? '' : catOf(t), sub = inc ? '' : subOf(t);
  const cats = allCats(); if (cat && !cats.includes(cat)) cats.unshift(cat);
  const incCat = inc ? (subOf(t) || INCOME_CATS[0]) : INCOME_CATS[0];
  return `<div data-form="${p}">
    <div class="seg" data-grp="kind"><button type="button" data-val="expense" class="${inc ? '' : 'on'}">지출</button><button type="button" data-val="income" class="${inc ? 'on' : ''}">수입</button></div>
    <label class="f">금액</label><input class="amt" id="${p}amount" inputmode="numeric" placeholder="0" value="${t.amount ? Number(t.amount).toLocaleString('ko-KR') : ''}" autocomplete="off">
    <div><label class="f">날짜</label><input id="${p}date" type="date" value="${esc(t.tx_date)}"></div>
      <div id="${p}payWrap" ${inc ? 'hidden' : ''}><label class="f">결제수단</label><div class="seg" data-grp="pay"><button type="button" data-val="card" style="font-size:14px;padding:10px 4px;white-space:nowrap" class="${t.pay === 'card' ? 'on' : ''}">카드</button><button type="button" data-val="cash" style="font-size:14px;padding:10px 4px;white-space:nowrap" class="${t.pay === 'cash' ? 'on' : ''}">현금·계좌</button><button type="button" data-val="prepaid" style="font-size:14px;padding:10px 4px;white-space:nowrap" class="${t.pay === 'prepaid' ? 'on' : ''}">대전사랑</button><button type="button" data-val="onnuri" style="font-size:14px;padding:10px 4px;white-space:nowrap" class="${t.pay === 'onnuri' ? 'on' : ''}">온누리</button></div></div>
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
function rowHtml(t, showDate) {
  const inc = t.kind === 'income', ex = t._n === '제외';
  return `<div class="item ${ex ? 'ex' : ''}" data-act="edit" data-id="${t.id}"><div class="l"><div class="t">${esc(t.place || t.memo || (inc ? '수입' : '(사용처 없음)'))}</div>
    <div class="s">${showDate ? `<span class="d">${mmdd(t.tx_date)}</span>` : ''}${esc(t.cls.replace('>', ' › ') || '미분류')} · ${inc ? '' : payLabel(t.pay)}${t.tag ? ' · ' + esc(t.tag) : ''}${ex ? ' · 제외' : ''}</div></div>
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
    <div class="card"><h2>최근 입력 <small>눌러서 수정</small></h2>${recent.length ? recent.map(t => rowHtml(t)).join('') : '<div class="note">아직 입력한 내역이 없습니다.</div>'}</div>`;
  wireForm('f_');
}

const HSORTS = { new: '날짜 최신순', old: '날짜 오래된순', high: '금액 높은순', low: '금액 낮은순' };
// 내역 탭 대분류 필터: 수입은 '수입>종류', 지출은 대분류 이름을 키로 쓴다
const hCatKey = t => t.kind === 'income' ? '수입>' + (subOf(t) || '기타') : catOf(t);
const hCatLabel = k => k.startsWith('수입>') ? k.slice(3) : k;
function hCatGroups(kind) {
  const ko = (a, b) => hCatLabel(a).localeCompare(hCatLabel(b), 'ko'), NONSPEND = ['이체', '카드대금', '저축/보험'];
  const expK = [...new Set(['미분류', ...state.tx.filter(isSpend).map(catOf), ...allCats().filter(c => !NONSPEND.includes(c))])].sort(ko);
  const incK = [...new Set([...state.tx.filter(t => t.kind === 'income').map(hCatKey), ...INCOME_CATS.map(c => '수입>' + c)])].sort(ko);
  const exK = [...new Set(state.tx.filter(t => t.kind === 'expense' && !isSpend(t)).map(catOf))].sort(ko);
  if (kind === 'expense') return [{ title: '', keys: expK }];
  if (kind === 'income') return [{ title: '', keys: incK }];
  if (kind === 'excluded') return [{ title: '', keys: exK }];
  const ex2 = exK.filter(k => !expK.includes(k));
  return [{ title: '지출', keys: expK }, { title: '수입', keys: incK }, ...(ex2.length ? [{ title: '이체·제외', keys: ex2 }] : [])];
}
function hUpdateCatBtn() { const F = state.hFilter, n = F.cats.length, b = $('#hFCatBtn'); if (b) b.textContent = (n === 0 ? '대분류 전체' : n === 1 ? hCatLabel(F.cats[0]) : `${hCatLabel(F.cats[0])} 외 ${n - 1}`) + ' ▾'; }
function hSyncCats() {   // 종류 필터에 맞게 패널 옵션을 다시 만들고, 목록에 없는 선택은 버림
  const F = state.hFilter, groups = hCatGroups(F.kind), valid = new Set(groups.flatMap(g => g.keys)), p = $('#hCatPanel'); if (!p) return;
  F.cats = F.cats.filter(c => valid.has(c));
  p.innerHTML = `<button type="button" class="catClear" data-clear="1">전체 해제</button>` + groups.map(g => (g.title ? `<div class="catGrp">${esc(g.title)}</div>` : '') + g.keys.map(c => `<label class="catRow"><input type="checkbox" value="${esc(c)}" ${F.cats.includes(c) ? 'checked' : ''}><span>${esc(hCatLabel(c))}</span></label>`).join('')).join('');
  hUpdateCatBtn();
}
function viewHistory() {
  const F = state.hFilter; if (!Array.isArray(F.cats)) F.cats = [];
  const months = monthsOf(); if (F.month && !months.includes(F.month)) months.unshift(F.month);
  view().innerHTML = `<div class="card" style="overflow:visible;position:relative;z-index:5"><input id="hQuery" type="search" placeholder="검색 (미분류 = 분류 안 된 내역)" value="${esc(state.hQuery)}">
    <div class="hfsel"><span class="hflbl">필터</span><select id="hFKind">${[['', '전체'], ['expense', '지출'], ['income', '수입'], ['excluded', '이체·제외']].map(([v, l]) => `<option value="${v}" ${v === (F.kind || '') ? 'selected' : ''}>${l}</option>`).join('')}</select><select id="hFMonth"><option value="">월 전체</option>${months.map(m => `<option value="${m}" ${m === F.month ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <div class="catWrap"><button type="button" id="hFCatBtn" class="catBtn"></button>
        <div class="catPanel" id="hCatPanel" hidden></div></div><button type="button" class="hreset" id="hReset">초기화</button></div></div>
    <div id="hBody"></div>`;
  $('#hQuery').addEventListener('input', e => { state.hQuery = e.target.value; state.hLimit = 200; renderHistoryBody(); });
  $('#hReset').onclick = () => { state.hFilter = { month: todayISO().slice(0, 7), cats: [], kind: null }; state.hQuery = ''; state.hSort = 'new'; state.hLimit = 200; viewHistory(); };
  $('#hFKind').onchange = e => { F.kind = e.target.value || null; state.hLimit = 200; hSyncCats(); renderHistoryBody(); };
  $('#hFMonth').onchange = e => { F.month = e.target.value || null; state.hLimit = 200; renderHistoryBody(); };
  $('#hFCatBtn').onclick = () => { const p = $('#hCatPanel'); p.hidden = !p.hidden; };
  $('#hCatPanel').onchange = e => {
    const cb = e.target.closest('input[type=checkbox]'); if (!cb) return;
    F.cats = [...$('#hCatPanel').querySelectorAll('input:checked')].map(x => x.value); state.hLimit = 200; hUpdateCatBtn(); renderHistoryBody();
  };
  $('#hCatPanel').onclick = e => {
    if (!e.target.closest('[data-clear]')) return;
    $('#hCatPanel').querySelectorAll('input').forEach(x => x.checked = false); F.cats = []; state.hLimit = 200; hUpdateCatBtn(); renderHistoryBody();
  };
  if (!viewHistory._doc) { viewHistory._doc = true; document.addEventListener('click', e => { const p = $('#hCatPanel'); if (p && !p.hidden && !e.target.closest('.catWrap')) p.hidden = true; }); }   // 한 번만 등록
  hSyncCats();
  renderHistoryBody();
}
function renderHistoryBody() {
  const F = state.hFilter; if (!Array.isArray(F.cats)) F.cats = [];
  const q = state.hQuery.trim().toLowerCase(), flat = state.hSort === 'high' || state.hSort === 'low';
  const cmpDate = (a, b) => a.tx_date < b.tx_date ? 1 : a.tx_date > b.tx_date ? -1 : ((a.created_at || '') < (b.created_at || '') ? 1 : (a.created_at || '') > (b.created_at || '') ? -1 : 0);
  const kindOk = t => !F.kind || (F.kind === 'expense' ? isSpend(t) : F.kind === 'income' ? t.kind === 'income' : t.kind === 'expense' && !isSpend(t));
  const list = state.tx.filter(t => kindOk(t) && (!F.month || t._m === F.month) && (!F.cats.length || F.cats.includes(hCatKey(t)))
    && (!q || (q === '미분류' ? t.kind === 'expense' && catOf(t) === '미분류' : (t.place + ' ' + t.memo + ' ' + t.cls).toLowerCase().includes(q))));
  list.sort(state.hSort === 'old' ? (a, b) => -cmpDate(a, b) : state.hSort === 'high' ? (a, b) => (b.amount - a.amount) || cmpDate(a, b) : state.hSort === 'low' ? (a, b) => (a.amount - b.amount) || cmpDate(a, b) : cmpDate);
  const exp = list.filter(isSpend).reduce((s, t) => s + t.amount, 0), inc = list.filter(t => t.kind === 'income').reduce((s, t) => s + t.amount, 0);
  const dayTot = {}; if (!flat) list.forEach(t => { if (isSpend(t)) dayTot[t.tx_date] = (dayTot[t.tx_date] || 0) + t.amount; });
  const shown = list.slice(0, state.hLimit), rest = list.length - shown.length;
  let body = '', last = '';
  shown.forEach(t => {
    if (!flat && t.tx_date !== last) { last = t.tx_date; const day = dayTot[last]; body += `<div class="dayh"><span>${mmdd(last)} (${wdOf(last)})</span><span>${day ? won(day) : ''}</span></div>`; }
    body += rowHtml(t, flat);
  });
  $('#hBody').innerHTML = `<div class="card"><div class="sum"><div class="sumk ${F.kind === 'expense' ? 'on' : ''}" data-kind="expense">지출<b>${won(exp)}</b></div><div class="sumk ${F.kind === 'income' ? 'on' : ''}" data-kind="income">수입<b class="pos">${won(inc)}</b></div><div>건수<b>${list.length}건</b></div></div></div>
    <div class="card"><div class="lhead"><span></span><select id="hSort">${Object.entries(HSORTS).map(([v, l]) => `<option value="${v}" ${v === state.hSort ? 'selected' : ''}>${l}</option>`).join('')}</select></div>${body || '<div class="note">조건에 맞는 내역이 없습니다.</div>'}${rest > 0 ? `<button class="btn sec" data-act="hMore">더 보기 (${rest}건 남음)</button>` : ''}</div>`;
  $('#hSort').onchange = e => { state.hSort = e.target.value; state.hLimit = 200; renderHistoryBody(); };
  $('#hBody').querySelectorAll('.sumk').forEach(el => el.onclick = () => {
    F.kind = F.kind === el.dataset.kind ? null : el.dataset.kind; const ks = $('#hFKind'); if (ks) ks.value = F.kind || ''; state.hLimit = 200; hSyncCats(); renderHistoryBody();
  });
}

function meter(label, value, limit, right, cls) {   // cls: 막대 색을 직접 지정할 때 ('' | 'mid' | 'over')
  const r = limit ? value / limit : 0, c = cls != null ? cls : r > 1 ? 'over' : r > 0.8 ? 'mid' : '';
  return `<div class="meter"><div class="top"><span>${label}</span><span>${right}</span></div><div class="prog"><span class="${c}" style="width:${Math.min(100, r * 100).toFixed(1)}%"></span></div></div>`;
}
function barChart(items, limit, selected) {   // items[i].k = 'YYYY-MM'. 달마다 고정 폭 칸 → 많으면 가로 스크롤
  const SLOT = 76, H = 200, pl = 8, pr = 8, pt = 24, pb = 26, W = items.length * SLOT + pl + pr, bw = 26, gap = 4;
  const maxV = Math.max(limit * 1.15, ...items.map(i => Math.max(i.total, i.inc || 0)), 1), y = v => pt + (H - pt - pb) * (1 - v / maxV);
  const cols = [['고정', 'var(--c1)'], ['변동', 'var(--c2)'], ['비정기', 'var(--c4)']];
  let g = '';
  items.forEach((it, i) => {
    const sx = pl + SLOT * i, xi = sx + (SLOT - 2 * bw - gap) / 2, x = xi + bw + gap, sel = it.k === selected; let acc = 0;
    g += `<g data-month="${esc(it.k)}" style="cursor:pointer"${selected && !sel ? ' opacity=".5"' : ''}>`;
    if (sel) g += `<rect x="${sx + 2}" y="2" width="${SLOT - 4}" height="${H - 4}" rx="8" fill="var(--accent)" fill-opacity=".14" stroke="var(--accent)" stroke-width="1.5"/>`;
    g += `<rect x="${sx}" y="0" width="${SLOT}" height="${H}" fill="transparent"/>`;
    cols.forEach(([k, c]) => { const v = it[k] || 0; if (v > 0) g += `<rect x="${x}" y="${y(acc + v)}" width="${bw}" height="${y(acc) - y(acc + v)}" fill="${c}"/>`; acc += v; });
    if ((it.inc || 0) > 0) g += `<rect x="${xi}" y="${y(it.inc)}" width="${bw}" height="${y(0) - y(it.inc)}" fill="var(--inc)" fill-opacity=".75"/><text x="${xi + bw / 2}" y="${y(it.inc) - 6}" text-anchor="middle" style="fill:var(--inc);font-size:10px">${(it.inc / 10000).toFixed(0)}만</text>`;
    if (it.total > 0) g += `<text x="${x + bw / 2}" y="${y(it.total) - 6}" text-anchor="middle" style="fill:var(--text);font-size:10px">${(it.total / 10000).toFixed(0)}만</text>`;
    g += `<text x="${sx + SLOT / 2}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text></g>`;
  });
  const ly = y(limit);
  g += `<line x1="${pl}" x2="${W - pr}" y1="${ly}" y2="${ly}" stroke="var(--bad)" stroke-dasharray="4 3" pointer-events="none"/><text x="${W - pr}" y="${ly - 4}" text-anchor="end" style="fill:var(--bad)" pointer-events="none">한도 ${(limit / 10000).toFixed(0)}만</text>`;
  return `<div id="mChartWrap" style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" style="display:block">${g}</svg></div><div class="lg"><span><i style="background:var(--inc)"></i>수입</span><span><i style="background:var(--c1)"></i>고정비</span><span><i style="background:var(--c2)"></i>변동비</span><span><i style="background:var(--c4)"></i>비정기</span></div>`;
}

function catLimitsOf() {   // 대분류별 한도 목록. catLimits가 없으면 예전 boozeYear를 옮겨 온 기본값
  const S = state.settings;
  if (Array.isArray(S.catLimits)) return S.catLimits.filter(e => e && typeof e.key === 'string' && e.key && Number(e.amount) > 0 && (e.unit === 'm' || e.unit === 'y')).map(e => ({ key: e.key, amount: Number(e.amount), unit: e.unit }));
  return [{ key: '식비>술/유흥', amount: Number(S.boozeYear) > 0 ? Number(S.boozeYear) : 2400000, unit: 'y' }];
}
const limMatch = (key, t) => key.includes('>') ? ((t.cls || '') === key || (t.cls || '').startsWith(key + '>')) : catOf(t) === key;
function catBarChart(items, limit, selected, stack, single) {   // items[i] = { k:'YYYY-MM', label, v, parts:{소분류:금액} }. stack = {order:[이름..], color:{이름:css}} 이면 소분류별 누적, 아니면 single 색 단색. barChart와 같은 칸 폭
  const SLOT = 76, H = 200, pl = 8, pr = 8, pt = 24, pb = 26, W = items.length * SLOT + pl + pr, bw = 30;
  const maxV = Math.max((limit || 0) * 1.15, ...items.map(i => i.v), 1), y = v => pt + (H - pt - pb) * (1 - v / maxV);
  let g = '';
  items.forEach((it, i) => {
    const sx = pl + SLOT * i, x = sx + (SLOT - bw) / 2, sel = it.k === selected, over = limit > 0 && it.v > limit;
    g += `<g data-month="${esc(it.k)}" style="cursor:pointer"${selected && !sel ? ' opacity=".5"' : ''}>`;
    if (sel) g += `<rect x="${sx + 2}" y="2" width="${SLOT - 4}" height="${H - 4}" rx="8" fill="var(--accent)" fill-opacity=".14" stroke="var(--accent)" stroke-width="1.5"/>`;
    g += `<rect x="${sx}" y="0" width="${SLOT}" height="${H}" fill="transparent"/>`;
    if (it.v > 0) {
      if (stack) { let acc = 0; stack.order.forEach(n => { const v = (it.parts || {})[n] || 0; if (v > 0) g += `<rect x="${x}" y="${y(acc + v)}" width="${bw}" height="${Math.max(0, y(acc) - y(acc + v))}" fill="${stack.color[n]}"${n === '기타' ? ' fill-opacity=".35"' : ''}/>`; acc += v; }); }
      else g += `<rect x="${x}" y="${y(it.v)}" width="${bw}" height="${y(0) - y(it.v)}" fill="${single || 'var(--c2)'}"/>`;
      if (over) g += `<rect x="${x - 1}" y="${y(it.v)}" width="${bw + 2}" height="${y(0) - y(it.v)}" fill="none" stroke="var(--bad)" stroke-width="1.5" pointer-events="none"/>`;
      g += `<text x="${x + bw / 2}" y="${y(it.v) - 6}" text-anchor="middle" style="fill:${over ? 'var(--bad)' : 'var(--text)'};font-size:10px${over ? ';font-weight:700' : ''}">${(it.v / 10000).toFixed(it.v < 100000 ? 1 : 0)}만</text>`;
    }
    g += `<text x="${sx + SLOT / 2}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text></g>`;
  });
  if (limit > 0) { const ly = y(limit); g += `<line x1="${pl}" x2="${W - pr}" y1="${ly}" y2="${ly}" stroke="var(--bad)" stroke-dasharray="4 3" pointer-events="none"/><text x="${W - pr}" y="${ly - 4}" text-anchor="end" style="fill:var(--bad)" pointer-events="none">한도 ${(limit / 10000).toFixed(0)}만</text>`; }
  return `<div id="catChartWrap" style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" style="display:block">${g}</svg></div>`;
}

function saveAScroll() {   // 분석 탭의 내부 스크롤 영역 위치 저장 (화면에 분석 탭이 그려져 있을 때만)
  const cw = $('#mChartWrap'), tw = $('#mTableWrap');
  if (cw && tw) state.aScroll = { l: cw.scrollLeft, t: tw.scrollTop };
}
function viewAnalysis() {
  const S = state.settings, today = todayISO(), spend = state.tx.filter(isSpend);
  if (!spend.length && !state.tx.some(t => t.kind === 'income')) { view().innerHTML = '<div class="card"><div class="note">분석할 지출 내역이 아직 없습니다. 입력하거나 설정에서 기존 내역을 가져오세요.</div></div>'; return; }
  const B = {};
  spend.forEach(t => {
    const m = B[t._m] ??= { 고정: 0, 변동: 0, 비정기: 0, total: 0, n: 0, cats: {}, items: [], first: t.tx_date, last: t.tx_date, deliv: 0, delivAmt: 0, booze: 0 };
    m[t._n] += t.amount; m.total += t.amount; m.n++; m.first = t.tx_date < m.first ? t.tx_date : m.first; m.last = t.tx_date > m.last ? t.tx_date : m.last;
    const c = catOf(t); m.cats[c] = (m.cats[c] || 0) + t.amount; m.items.push(t);
    if (/배달/.test(t.cls)) { m.deliv++; m.delivAmt += t.amount; } if (/술\/유흥/.test(t.cls)) m.booze += t.amount;
  });
  const incBy = {}, incM = {};
  state.tx.filter(t => t.kind === 'income').forEach(t => {
    incBy[t._m] = (incBy[t._m] || 0) + t.amount;
    B[t._m] ??= { 고정: 0, 변동: 0, 비정기: 0, total: 0, n: 0, cats: {}, items: [], first: t.tx_date, last: t.tx_date, deliv: 0, delivAmt: 0, booze: 0 };   // 수입만 있는 달도 표시
    const im = incM[t._m] ??= { total: 0, n: 0, types: {}, items: [] }, ty = subOf(t) || '기타';
    im.total += t.amount; im.n++; im.types[ty] = (im.types[ty] || 0) + t.amount; im.items.push(t);
  });
  const keys = Object.keys(B).sort(), curKey = today.slice(0, 7);
  const note = k => k === curKey ? ' (진행 중)' : (k === keys[0] && +B[k].first.slice(8) > 9 ? ' (일부 기간)' : '');
  if (!state.aMonth || !B[state.aMonth]) state.aMonth = B[curKey] ? curKey : ([...keys].reverse().find(k => k <= curKey) || keys[0]);   // 미래 달(할부)은 기본 선택하지 않음
  let h = '';

  // --- 현금 점검 (다음 카드 결제 vs 통장 잔액) ---
  const od = Number(S.overdraftLimit) || 0, pl = payments(today), di = nextPayIdx(pl, today), opts = pl.slice(0, di + 1);
  const pc = opts.find(p => p.ym === state.pSel) || opts[di], ci = pl.indexOf(pc), prev = pl[ci - 1], isDef = ci === di, past = pc.pay <= today && !isDef, upc = !past;
  const dday = Math.max(0, Math.ceil(dnum(pc.pay) - dnum(today))), mdOf = iso => `${+iso.slice(5, 7)}.${+iso.slice(8, 10)}`, dd = x => x.replace(/-/g, '.');
  const cashCalc = p => {   // 결제 p의 청구 예정액·통장 잔액 계산
    const pv = pl[pl.indexOf(p) - 1], bill0 = spend.filter(t => t.pay === 'card' && t.tx_date >= p.start && t.tx_date <= p.end).reduce((s, t) => s + t.amount, 0);
    const inProg = today < p.end, ptotal = dnum(p.end) - dnum(p.start) + 1, el = Math.min(Math.max(dnum(today), dnum(p.start)), dnum(p.end)) - dnum(p.start) + 1;
    const est = inProg && el >= 5 ? bill0 / el * ptotal : null;
    let bal = null;   // 통장 잔액: 이 결제 기간(앞 결제일 ≤ 날짜 < 이번 결제일) 안의 기록 중 최신 (결제일 당일 기록은 다음 결제 몫)
    const inWin = d => (!pv || d >= pv.pay) && d < p.pay;
    const latest = l => [...(l || [])].filter(s => inWin(s.date) && !isNaN(Number(s.balance))).sort((a, b) => a.date < b.date ? -1 : 1).pop();
    const bs = latest(S.bankSnaps), ba = latest(S.bankAuto);   // 직접 입력한 잔액이 있으면 그것이 우선, 없으면 은행 거래내역의 최근 잔액
    if (bs) bal = { date: bs.date, v: Number(bs.balance), src: `통장 잔액 기록 ${dd(bs.date)}`, manual: true };
    else if (ba) bal = { date: ba.date, v: Number(ba.balance), src: `은행 거래내역 ${dd(ba.date)}` };
    if (!bs && state.asset) { const M = aMonths(), L = M[M.length - 1]; if (L && L.date != null) { const ad = aToDate(L.date).toISOString().slice(0, 10); if (inWin(ad) && (!bal || ad > bal.date)) bal = { date: ad, v: (L.debt < 0 ? L.debt : (L.cash || 0)), src: `자산 시트 ${dd(ad)} 기준` }; } }
    return { bill0, inProg, ptotal, el, est, bill: est != null ? est : bill0, bal, hasAuto: !!ba };
  };
  const { bill0, inProg, ptotal, el, est, bill, bal, hasAuto } = cashCalc(pc), lbl = inProg ? ' (예상)' : '';
  const has21 = upc && pc.pay.slice(8, 10) === '21', [ty, tm] = today.split('-').map(Number);
  const mid21 = upc && !has21 && [0, 1, 2].some(k => { const d = isoOf(Date.UTC(ty, tm - 1 + k, 21) / 86400000); return today < d && d < pc.pay; });
  let cashRows = '<div class="note">이 결제 기간의 통장 잔액을 기록하세요.</div>';
  if (bal) {
    const avail = bal.v + od, after = bal.v - bill, ago = Math.round(dnum(today) - dnum(bal.date)), pre = past ? '당시 ' : '';
    const verdict = after >= 0 ? tag(pre + '적절' + lbl, 'ok') : after >= -od ? tag(pre + '위험' + lbl, 'warn') : tag(pre + '파산' + lbl, 'bad');
    const mLim = avail > 0 ? avail : (bill > 0 ? bill / 2 : 0);   // 인출 가능액이 0 이하이면 막대를 '초과'로 가득 채움
    cashRows = `${meter('청구 예정액 / 인출 가능액', bill, mLim, `<b>${won(bill)}</b> / ${won(avail)} ${verdict}`, after >= 0 ? '' : after >= -od ? 'mid' : 'over')}
      <table><tr><td>청구 예정액${lbl}</td><td><b>${won(bill)}</b></td></tr>
      <tr><td>통장 잔액 <span class="note">${bal.src}</span></td><td><b>${won(bal.v)}</b></td></tr>
      <tr><td>통장 인출 가능액 <span class="note">잔액 + 마이너스 한도 ${won(od)}</span></td><td><b>${won(avail)}</b></td></tr>
      <tr><td>인출 후 통장 잔액(예상)</td><td><b class="${after < 0 ? 'neg' : ''}">${won(after)}</b></td></tr>
      <tr><td>판정</td><td>${verdict}</td></tr></table>
      ${ago > 10 && upc ? `<div class="note" style="color:var(--warn)">잔액 기록이 ${ago}일 전이에요. 새로 기록하세요.</div>` : ''}`;
  }
  const PR = S.payRecords || {};
  const vTag = (v, s = '') => v >= 0 ? tag('적절' + s, 'ok') : v >= -od ? tag('위험' + s, 'warn') : tag('파산' + s, 'bad');
  const isConf = p => { const r = PR[p.ym]; return !!(r && r.bal != null && !isNaN(r.bal)); };   // 은행 거래내역으로 확정된 결제
  if (isConf(pc)) {   // 확정된 결제: 은행 기록(청구액·결제일+2일 잔액)으로 위쪽도 그림
    const r = PR[pc.ym], cb = Number(r.bill) || 0, before = r.bal + cb, avail = before + od, verdict = vTag(r.bal, ' (확정)');
    const mLim = avail > 0 ? avail : (cb > 0 ? cb / 2 : 0);
    cashRows = `${meter('청구액 / 인출 가능액', cb, mLim, `<b>${won(cb)}</b> / ${won(avail)} ${verdict}`, r.bal >= 0 ? '' : r.bal >= -od ? 'mid' : 'over')}
      <table><tr><td>청구액 (확정)</td><td><b>${won(cb)}</b></td></tr>
      <tr><td>결제 전 통장 잔액 <span class="note">추정: 인출 후 잔액 + 청구액</span></td><td><b>${won(before)}</b></td></tr>
      <tr><td>통장 인출 가능액 <span class="note">잔액 + 마이너스 한도 ${won(od)}</span></td><td><b>${won(avail)}</b></td></tr>
      <tr><td>인출 후 통장 잔액 (확정) <span class="note">${r.balDate ? dd(r.balDate) : ''} 은행 기록</span></td><td><b class="${r.bal < 0 ? 'neg' : ''}">${won(r.bal)}</b></td></tr>
      <tr><td>판정</td><td>${verdict}</td></tr></table>`;
  }
  const pastHtml = `<div class="note" style="margin:14px 0 6px">결제 기록</div><table><tr><th style="text-align:left">월</th><th>청구액</th><th>통장잔액</th><th>판정</th></tr>${[...opts].reverse().map(p => {
    const sel = p === pc, conf = isConf(p), r = PR[p.ym];
    const head = `<tr data-pr="${p.ym}" style="cursor:pointer;${sel ? 'background:var(--bg)' : ''}"><td style="text-align:left;${sel ? 'box-shadow:inset 3px 0 0 var(--accent);font-weight:700' : ''}">${mdOf(p.pay)} 결제${conf ? '' : ' (예측)'}</td>`;
    if (conf) return head + `<td>${won(r.bill)}</td><td>${won(r.bal)} <span class="note">${r.balDate ? dd(r.balDate).slice(5) : ''}</span></td><td>${vTag(r.bal)}</td></tr>`;
    const c = cashCalc(p), aft = c.bal ? c.bal.v - c.bill : null;   // 확정 전: 카드 사용액과 기록한 통장 잔액으로 계산한 인출 후 예상 잔액
    return head + `<td>${won(c.bill)}</td>` + (aft != null ? `<td>${won(aft)} <span class="note">예상</span></td><td>${vTag(aft)}</td></tr>` : `<td>-</td><td><span class="note">잔액 기록 필요</span></td></tr>`);
  }).join('')}</table><div class="note">(예측) 줄은 카드 사용액과 기록한 통장 잔액으로 계산한 인출 후 예상 잔액이에요. 결제일+2일까지 들어간 은행 거래내역을 올리면 확정 기록(하나카드·KB카드출금 합계, 결제일+2일 마지막 거래 후 잔액)으로 바뀌고 (예측)이 떨어져요.</div>`;
  h += `<div class="card"><h2>현금 점검 <small><select id="pSel" style="width:auto;font-size:13px;padding:4px 8px">${[...opts].reverse().map(p => `<option value="${p.ym}" ${p === pc ? 'selected' : ''}>${mdOf(p.pay)} 결제${isConf(p) ? '' : ' (예측)'}</option>`).join('')}</select> · ${pc.pay >= today ? 'D-' + dday : '결제 완료'} · 사용분 ${dd(pc.start)} ~ ${dd(pc.end)}</small></h2>
    ${est != null ? `<div class="note" style="margin:0 0 8px">지금까지 ${won(bill0)} · 이 속도면 약 ${won(est)} (${el}/${ptotal}일 경과)</div>` : ''}
    ${cashRows}
    ${has21 ? '<div class="note">결제일에 급여도 들어와요 (판정은 급여 전 잔액 기준)</div>' : mid21 ? '<div class="note">그 사이 21일 급여·자동이체로 실제 잔액은 달라질 수 있어요</div>' : ''}
    ${pastHtml}
    <div class="row2 snapRow" style="margin-top:12px"><div><label class="f">확인한 날짜</label><input id="bkDate" type="date" value="${today}"></div><div><label class="f">통장 잔액(원)</label><input id="bkBal" inputmode="text" placeholder="예: -1416257"></div></div>
    <div class="row2" style="margin-top:8px"><button class="btn sec" data-act="saveBankSnap" style="margin:0">잔액 기록</button>${bal && bal.manual ? `<button class="btn sec" data-act="useBankAuto" data-from="${prev ? prev.pay : ''}" data-to="${pc.pay}" style="margin:0" ${hasAuto || state.asset ? '' : 'disabled title="이 기간의 은행 거래내역이 없어요"'}>통장 기록으로 변경</button>` : ''}</div></div>`;

  // --- monthly ---
  const mrows = keys.map(k => ({ k, ...B[k], inc: incBy[k] || 0, label: k.slice(2) }));
  const sth = 'position:sticky;top:0;background:var(--card)';
  h += `<div class="card"><h2>월별 수입지출 <small>카드대금·저축·이체 제외 · 누르면 아래 월 상세가 바뀝니다</small></h2>${barChart(mrows, S.monthLimit, state.aMonth)}
    <div style="height:10px"></div><div id="mTableWrap" style="max-height:320px;overflow-y:auto"><table><tr><th style="${sth}">월</th><th style="${sth}">지출 계</th><th style="${sth}">수입</th><th style="${sth}">판정 <span class="tip" tabindex="0" role="button" aria-label="판정 설명">ⓘ<span class="tipbox">그 달 지출 합계(카드대금·저축·이체 제외)가 월 생활비 한도(${won(S.monthLimit)}) 이하면 정상, 넘으면 ⚠ 초과. 진행 중이거나 일부 기간만 있는 달은 참고용이에요.</span></span></th><th style="${sth}">배달</th><th style="${sth}">배달 금액</th><th style="${sth}">술·유흥</th></tr>
    ${[...mrows].reverse().map(m => { const sel = m.k === state.aMonth; return `<tr data-month="${m.k}" style="cursor:pointer;${sel ? 'background:var(--bg)' : ''}"><td style="${sel ? 'box-shadow:inset 3px 0 0 var(--accent);font-weight:700' : ''}">${m.k}<span class="note">${note(m.k)}</span></td><td><b>${won(m.total)}</b></td><td>${won(incBy[m.k] || 0)}</td><td>${tag(m.total > S.monthLimit ? '⚠ 초과' : '정상')}</td><td>${m.deliv}건</td><td>${won(m.delivAmt)}</td><td>${won(m.booze)}</td></tr>`; }).join('')}</table></div>
    <div class="note">진행 중이거나 일부 기간만 있는 달은 한도 판정이 의미 없습니다.</div></div>`;

  // --- 대분류별 월별 지출 ---
  const CL = catLimitsOf(), catTot = {};
  spend.forEach(t => { const c = catOf(t); catTot[c] = (catTot[c] || 0) + t.amount; });
  const chipKeys = Object.keys(catTot).sort((a, b) => catTot[b] - catTot[a]);
  const allCatKeys = new Set(); spend.forEach(t => { const c = catOf(t), s = subOf(t); allCatKeys.add(c); if (s) allCatKeys.add(c + '>' + s); });
  // 칩: 윗줄은 대분류, 아랫줄은 선택한 대분류의 소분류만
  if (!(chipKeys.includes(state.catSel) || (state.catSel && state.catSel.includes('>') && allCatKeys.has(state.catSel)))) state.catSel = chipKeys.includes('식비') ? '식비' : chipKeys[0];
  const csel = state.catSel, cmLim = (CL.find(e => e.unit === 'm' && e.key === csel) || {}).amount || 0;
  const isSub = !!csel && csel.includes('>'), pcat = csel ? csel.split('>')[0] : '';
  const PAL = ['var(--c1)', 'var(--c3)', 'var(--c2)', 'var(--c4)', 'var(--c5)'], subTot = {};   // 상위 5개 소분류만 색, 나머지는 '기타'
  if (csel) keys.forEach(k => B[k].items.forEach(t => { if (catOf(t) === pcat) { const s = subOf(t) || '기타'; subTot[s] = (subTot[s] || 0) + t.amount; } }));
  const topSubs = Object.keys(subTot).filter(s => s !== '기타').sort((a, b) => subTot[b] - subTot[a]).slice(0, 5);
  if (!state.subColor) state.subColor = {};
  const usedC = new Set(), subIdx = {};
  topSubs.forEach(s => { const i = state.subColor[pcat + '>' + s]; if (Number.isInteger(i) && i >= 0 && i < PAL.length && !usedC.has(i)) { subIdx[s] = i; usedC.add(i); } });
  topSubs.forEach(s => { if (subIdx[s] == null) { let i = 0; while (usedC.has(i)) i++; subIdx[s] = i; usedC.add(i); state.subColor[pcat + '>' + s] = i; } });
  const stackOrder = [...topSubs, ...(Object.keys(subTot).some(s => !topSubs.includes(s)) ? ['기타'] : [])], stackColor = { '기타': 'var(--sub)' };
  topSubs.forEach(s => stackColor[s] = PAL[subIdx[s]]);
  const crows = keys.map(k => {
    const its = csel ? B[k].items.filter(t => limMatch(csel, t)) : [], parts = {};
    if (csel && !isSub) its.forEach(t => { let n = subOf(t) || '기타'; if (!topSubs.includes(n)) n = '기타'; parts[n] = (parts[n] || 0) + t.amount; });
    return { k, label: k.slice(2), v: its.reduce((s, t) => s + t.amount, 0), parts };
  });
  const subChips = Object.keys(subTot).filter(s => s !== '기타' && allCatKeys.has(pcat + '>' + s)).sort((a, b) => subTot[b] - subTot[a]).map(s => pcat + '>' + s);
  const chipHtml = c => {
    const sub = c.includes('>'), sel = c === csel || (!sub && c === pcat), p = c.split('>');   // 소분류를 보고 있어도 부모 대분류 칩은 선택 상태
    const st = sub
      ? `font:inherit;font-size:11px;padding:2px 8px;border-radius:12px;cursor:pointer;border:1px solid ${sel ? 'var(--accent)' : 'var(--line)'};background:${sel ? 'color-mix(in srgb,var(--accent) 14%,transparent)' : 'transparent'};color:${sel ? 'var(--accent)' : 'var(--sub)'}${sel ? ';font-weight:600' : ''}`
      : `font:inherit;font-size:12px;padding:4px 10px;border-radius:14px;cursor:pointer;border:1px solid ${sel ? 'var(--accent)' : 'var(--line)'};background:${sel ? 'var(--accent)' : 'var(--bg)'};color:${sel ? '#fff' : 'var(--sub)'}`;
    return `<button type="button" data-act="catSel" data-v="${esc(c)}" style="${st}">${sub ? `<span style="opacity:.6">${esc(p[0])} ›</span> ${esc(p.slice(1).join('>'))}` : esc(c)}</button>`;
  };
  const legendHtml = csel && !isSub && stackOrder.length ? `<div class="lg">${stackOrder.map(n => {
    const key = pcat + '>' + n, ok = n !== '기타' && allCatKeys.has(key);
    const sw = `<i style="background:${stackColor[n]}${n === '기타' ? ';opacity:.35' : ''}"></i>`, tx = `${sw}${esc(n)}`;
    return ok ? `<button type="button" data-act="catSel" data-v="${esc(key)}" style="font:inherit;font-size:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:left">${tx}</button>` : `<span>${tx}</span>`;
  }).join('')}</div>` : '';
  if (csel) h += `<div class="card"><h2>대분류별 월별 지출 <small>칩을 누르면 분류가 바뀝니다 · 막대를 누르면 아래 월 상세가 바뀝니다</small></h2>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;align-items:center">${chipKeys.map(chipHtml).join('')}</div>
    ${subChips.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px;padding-left:10px;border-left:2px solid var(--line);align-items:center">${subChips.map(chipHtml).join('')}</div>` : ''}
    ${catBarChart(crows, cmLim, state.aMonth, isSub ? null : { order: stackOrder, color: stackColor }, isSub ? (subIdx[csel.split('>')[1]] != null ? PAL[subIdx[csel.split('>')[1]]] : 'var(--c6)') : null)}
    ${legendHtml}
    ${cmLim ? `<div class="note">한도 ${won(cmLim)}</div>` : ''}</div>`;

  // --- month detail ---
  const cur = B[state.aMonth], cats = Object.entries(cur.cats).sort((a, b) => b[1] - a[1]);
  const irreg = cur.items.filter(t => t._n === '비정기').sort((a, b) => a.tx_date < b.tx_date ? 1 : -1), top = [...cur.items].sort((a, b) => b.amount - a.amount).slice(0, 8);
  const im = incM[state.aMonth], cardUse = cur.items.filter(t => t.pay === 'card').reduce((s, t) => s + t.amount, 0);
  let incSec = '<div class="note">이번 달 수입 기록이 없습니다.</div>';
  if (im) {
    const itypes = Object.entries(im.types).sort((a, b) => b[1] - a[1]), itop = [...im.items].sort((a, b) => b.amount - a.amount).slice(0, 8);
    incSec = `<div style="margin:6px 0 10px">수입 합계 <b class="pos">${won(im.total)}</b> <span class="note">${im.n}건</span></div>
      <div class="two"><div><div class="note" style="margin:0 0 6px">종류별</div>${itypes.map(([c, v]) => `<div class="hbar go" data-inc="${esc(c)}" style="cursor:pointer"><span class="lbl">${esc(c)}</span><span class="track"><span style="width:${(v / itypes[0][1] * 100).toFixed(1)}%;background:var(--inc)"></span></span><span class="val">${won(v)} · ${pct(v / im.total)}</span></div>`).join('')}</div>
        <div><div class="note" style="margin:0 0 6px">큰 수입 TOP 8</div><table>${itop.map(t => `<tr><td>${mmdd(t.tx_date)} ${esc(t.place || t.memo)}</td><td>${won(t.amount)}</td></tr>`).join('')}</table></div></div>`;
  }
  h += `<div class="card" id="mDetail"><h2>월 상세 <small><select id="aMonth" style="width:auto;font-size:13px;padding:4px 8px">${[...keys].reverse().map(k => `<option value="${k}" ${k === state.aMonth ? 'selected' : ''}>${k}${note(k)}</option>`).join('')}</select></small></h2>
    <div class="secT">수입</div>
    ${incSec}
    <div class="secT">지출</div>
    ${meter('카드 사용액 / 카드 한도', cardUse, S.cardLimit, `<b>${won(cardUse)}</b> / ${won(S.cardLimit)} ${tag(cardUse > S.cardLimit ? '⚠ 한도 초과' : '정상')}`)}
    ${meter('월 생활비 한도', cur.total, S.monthLimit, `<b>${won(cur.total)}</b> / ${won(S.monthLimit)}${cur.total > S.monthLimit ? ' · ' + won(cur.total - S.monthLimit) + ' 초과' : ''}`)}
    ${(() => {   // 대분류별: 같은 폭·같은 눈금(가장 큰 대분류 기준). ▸ 버튼으로 소분류 펼치기(기본은 닫힘). 한도는 값 아래 작은 줄
      const limOf = k => (CL.find(e => e.unit === 'm' && e.key === k) || {}).amount || 0, open = state.mdOpen ??= {};
      const mx = Math.max(cats.length ? cats[0][1] : 1, ...CL.filter(e => e.unit === 'm' && cats.some(([c]) => e.key === c || e.key.startsWith(c + '>'))).map(e => e.amount));   // 눈금: 가장 큰 대분류와 한도 중 큰 값 (한도선이 막대 안에 들어오게)
      const subsOfCat = c => { const m = {}; cur.items.forEach(t => { if (catOf(t) === c && subOf(t)) m[subOf(t)] = (m[subOf(t)] || 0) + t.amount; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
      const withSubs = cats.map(([c]) => c), allOpen = withSubs.length && withSubs.every(c => open[c]);   // 소분류가 없어도 모든 대분류에 ▸ 버튼
      const tg = c => `<button type="button" data-act="mdToggle" data-v="${esc(c)}" aria-label="${esc(c)} 소분류 ${open[c] ? '닫기' : '열기'}" style="font:inherit;font-size:10px;width:18px;height:18px;padding:0;margin-right:4px;border:1px solid var(--line);border-radius:4px;background:${open[c] ? 'var(--accent)' : 'var(--bg)'};color:${open[c] ? '#fff' : 'var(--sub)'};cursor:pointer;line-height:1">${open[c] ? '▾' : '▸'}</button>`;
      const bar = (lbl, v, lim, extra) => { const r = lim ? v / lim : 0, bc = r > 1 ? 'var(--bad)' : r > 0.8 ? 'var(--caution)' : '', tc = r > 1 ? 'var(--bad)' : r > 0.8 ? 'var(--warn)' : 'var(--sub)';   // 80% 초과 노랑, 100% 초과 빨강
        const ln = lim ? `<i style="position:absolute;top:-2px;bottom:-2px;left:calc(${Math.min(100, lim / mx * 100).toFixed(1)}% - 1px);border-left:2px dashed ${r > 1 ? 'var(--bad)' : 'var(--text)'};opacity:.7"></i>` : '';   // 한도선(점선)
        const arrow = extra.cat && lim ? '<span style="color:var(--sub)"> ›</span>' : '';   // 한도 줄은 › 를 첫 줄에 붙여 두 줄 이내로 (go 클래스의 ::after는 셋째 줄로 밀림)
        return `<div class="hbar${extra.cat && !lim ? ' go' : ''}"${extra.cat ? ` data-cat="${esc(extra.cat)}" style="cursor:pointer"` : ''}><span class="lbl" style="${extra.sub ? 'padding-left:14px;font-size:11px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis' : 'display:flex;align-items:center;white-space:nowrap'}">${lbl}</span><span class="track" style="position:relative;overflow:visible"><span style="width:${(v / mx * 100).toFixed(1)}%;border-radius:4px${bc ? ';background:' + bc : extra.sub ? ';opacity:.6' : ''}"></span>${ln}</span><span class="val"><span style="white-space:nowrap">${won(v)} · ${pct(v / cur.total)}${arrow}</span>${lim ? `<div style="font-size:11px;color:${tc};white-space:nowrap">한도 ${won(lim)}</div>` : ''}</span></div>`; };
      const head = `<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 6px"><span class="note" style="margin:0">대분류별</span>${withSubs.length ? `<button type="button" data-act="mdAll" style="font:inherit;font-size:11px;padding:2px 8px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--sub);cursor:pointer">${allOpen ? '모두 닫기' : '모두 열기'}</button>` : ''}</div>`;
      return head + cats.map(([c, v]) => { const ss = subsOfCat(c); return bar(tg(c) + esc(c), v, limOf(c), { cat: c }) + (open[c] ? (ss.length ? ss.map(([s, u]) => bar('└ ' + esc(s), u, limOf(c + '>' + s), { sub: true })).join('') : '<div style="height:20px;margin:5px 0"></div>') : ''); }).join('');   // 소분류가 없으면 펼쳤을 때 빈 줄
    })()}
    <div class="two" style="margin-top:14px"><div><div class="note" style="margin:0 0 6px">큰 지출 TOP 8</div><table>${top.map(t => `<tr><td style="text-align:left">${mmdd(t.tx_date)} ${esc(t.place || t.memo)}</td><td>${won(t.amount)}</td></tr>`).join('')}</table></div>
      <div><div class="note" style="margin:0 0 6px">비정기 ${irreg.length}건 · ${won(cur['비정기'])}</div>
      ${irreg.length ? `<table>${irreg.map(t => `<tr><td style="text-align:left">${mmdd(t.tx_date)} ${esc(t.place || t.memo)}<div class="note" style="margin:0">${esc((t.cls || '').replace('>', ' › '))}</div></td><td>${won(t.amount)}</td></tr>`).join('')}</table>` : '<div class="note">없음</div>'}</div></div>
    ${cur.cats['미분류'] ? `<div class="banner warn" style="margin-top:12px">분류가 비어 있는 지출 ${won(cur.cats['미분류'])}이 있습니다.</div>` : ''}</div>`;

  // --- year limits ---
  const yr = today.slice(0, 4), yLims = CL.filter(e => e.unit === 'y');
  if (yLims.length) h += `<div class="card"><h2>연간 한도 <small>${yr}년 누적</small></h2>${yLims.map(e => { const u = spend.filter(t => t._m.startsWith(yr) && limMatch(e.key, t)).reduce((s, t) => s + t.amount, 0); return meter(esc(e.key.replace('>', ' › ')), u, e.amount, `<b>${won(u)}</b> / ${won(e.amount)} (${pct(u / e.amount)})`); }).join('')}</div>`;

  // --- 대전사랑카드(지역화폐) ---
  const snaps = [...(S.prepaidSnaps || [])].sort((a, b) => a.date < b.date ? -1 : 1);
  const clsOf = t => t.cls || '', isTopT = t => t.kind === 'expense' && clsOf(t).startsWith('이체>선불충전'), isCbUse = t => clsOf(t) === '이체>캐시백사용', isCbEarn = t => t.kind === 'income' && clsOf(t) === '수입>캐시백';
  const isPPSpend = t => t.kind === 'expense' && t.pay === 'prepaid' && !clsOf(t).startsWith('이체');
  const ppTx = state.tx.filter(t => isTopT(t) || isCbUse(t) || isCbEarn(t) || isPPSpend(t));
  const sumOf = (l, f) => l.filter(f).reduce((s, t) => s + t.amount, 0);
  let djHtml = '', onHtml = '';
  {
    const agg = l => { const topups = sumOf(l, isTopT), spentFull = sumOf(l, isPPSpend), cbEarned = sumOf(l, isCbEarn), cbUsed = sumOf(l, isCbUse); return { topups, spentFull, cbEarned, cbUsed, chargeDelta: topups - (spentFull - cbUsed), cbDelta: cbEarned - cbUsed }; };
    const A = agg(ppTx), Am = agg(ppTx.filter(t => t._m === curKey)), S0 = snaps.length ? snaps[snaps.length - 1] : null, sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + won(Math.abs(v));
    let snapHtml = `<div class="note" style="margin:8px 0 0">받은 캐시백 합계(기록 기간): <b>${won(A.cbEarned)}</b></div>`;
    if (S0) {
      const Aa = agg(ppTx.filter(t => t.tx_date > S0.date));
      snapHtml += `<div class="note">최근 확인 잔액 (${S0.date.replace(/-/g, '.')}): 충전 ${won(S0.charge)} · 캐시백 ${won(S0.cashback)}</div>
        <div style="margin-top:6px">추정 충전 잔액 (오늘): <b>${won(S0.charge + Aa.chargeDelta)}</b> · 추정 캐시백 잔액: <b>${won(S0.cashback + Aa.cbDelta)}</b></div>
        <div class="note">앱에 보이는 잔액과 다르면 빠진 기록이 있을 수 있어요.</div>`;
    } else {
      snapHtml += `<div class="note">기록 기간 순증감: 충전 잔액 ${sg(A.chargeDelta)}, 캐시백 잔액 ${sg(A.cbDelta)}. 앱에 보이는 현재 잔액을 한 번 입력하면 이후 잔액을 추정해요.</div>`;
    }
    djHtml = `<table><tr><th></th><th>충전</th><th>사용(전액)</th><th>캐시백 적립</th><th>캐시백 사용</th></tr>
      <tr><td>${curKey.replace('-', '.')}</td><td>${won(Am.topups)}</td><td>${won(Am.spentFull)}</td><td>${won(Am.cbEarned)}</td><td>${won(Am.cbUsed)}</td></tr>
      <tr><td>전체</td><td>${won(A.topups)}</td><td>${won(A.spentFull)}</td><td>${won(A.cbEarned)}</td><td>${won(A.cbUsed)}</td></tr></table>${snapHtml}
      <div class="row2 snapRow snap3" style="margin-top:12px"><div><label class="f">확인한 날짜</label><input id="ppDate" type="date" value="${today}"></div><div><label class="f">충전 잔액(원)</label><input id="ppCharge" inputmode="numeric" placeholder="0"></div>
      <div><label class="f">캐시백 잔액(원)</label><input id="ppCb" inputmode="numeric" placeholder="0"></div></div>
      <button class="btn sec" data-act="saveSnap">잔액 기록</button>`;
  }
  // --- 온누리상품권 ---
  const onSnaps = [...(S.onnuriSnaps || [])].sort((a, b) => a.date < b.date ? -1 : 1);
  const isOnFace = t => t.kind === 'expense' && clsOf(t).startsWith('이체>온누리충전'), isOnDisc = t => t.kind === 'income' && clsOf(t) === '수입>상품권할인', isOnSpend = t => t.kind === 'expense' && t.pay === 'onnuri' && !clsOf(t).startsWith('이체');
  const isOnPaid = t => t.kind === 'expense' && clsOf(t).startsWith('이체>온누리결제');   // 은행에서 실제로 낸 돈 (잔액 계산에는 쓰지 않음)
  const onTx = state.tx.filter(t => isOnFace(t) || isOnDisc(t) || isOnSpend(t) || isOnPaid(t));
  {
    const aggO = l => { const charges = sumOf(l, isOnFace), discount = sumOf(l, isOnDisc), spent = sumOf(l, isOnSpend), paid = sumOf(l, isOnPaid); return { charges, paid, discount, spent, delta: charges - spent }; };
    const A = aggO(onTx), Am = aggO(onTx.filter(t => t._m === curKey)), S0 = onSnaps.length ? onSnaps[onSnaps.length - 1] : null;
    let snapHtml = '';
    if (S0) snapHtml = `<div class="note" style="margin:8px 0 0">최근 확인 잔액 (${S0.date.replace(/-/g, '.')}): ${won(S0.balance)}</div>
      <div style="margin-top:6px">추정 잔액 (오늘): <b>${won(S0.balance + aggO(onTx.filter(t => t.tx_date > S0.date)).delta)}</b></div><div class="note">앱에 보이는 잔액과 다르면 빠진 기록이 있을 수 있어요.</div>`;
    else snapHtml = `<div class="note" style="margin:8px 0 0">기록 기간 순증감: 잔액 ${A.delta > 0 ? '+' : A.delta < 0 ? '−' : ''}${won(Math.abs(A.delta))}. 앱에 보이는 현재 잔액을 한 번 입력하면 이후 잔액을 추정해요.</div>`;
    onHtml = `<table><tr><th></th><th>충전(상품권 금액)</th><th>실제 낸 돈</th><th>할인 혜택</th><th>사용</th></tr>
      <tr><td>${curKey.replace('-', '.')}</td><td>${won(Am.charges)}</td><td>${won(Am.paid)}</td><td>${won(Am.discount)}</td><td>${won(Am.spent)}</td></tr>
      <tr><td>전체</td><td>${won(A.charges)}</td><td>${won(A.paid)}</td><td>${won(A.discount)}</td><td>${won(A.spent)}</td></tr></table>${snapHtml}
      <div class="row2 snapRow" style="margin-top:12px"><div><label class="f">확인한 날짜</label><input id="onDate" type="date" value="${today}"></div><div><label class="f">잔액(원)</label><input id="onBal" inputmode="numeric" placeholder="0"></div></div>
      <button class="btn sec" data-act="saveOnnuriSnap">잔액 기록</button>`;
  }
  if (ppTx.length || snaps.length || onTx.length || onSnaps.length) {
    const tb = state.ppTab === 'on' ? 'on' : 'dj';
    h += `<div class="card"><h2>지역화폐 <small>충전은 지출이 아니라 이체</small></h2>
      <div class="seg" style="margin-bottom:10px"><button type="button" data-act="ppTab" data-v="dj" class="${tb === 'dj' ? 'on' : ''}">대전사랑카드</button><button type="button" data-act="ppTab" data-v="on" class="${tb === 'on' ? 'on' : ''}">온누리상품권</button></div>
      ${tb === 'dj' ? djHtml : onHtml}</div>`;
  }

  saveAScroll();   // 다시 그리기 전 스크롤 위치 저장
  const hadScroll = !!state.aScroll;
  view().innerHTML = h;
  const cw = $('#mChartWrap'), tw = $('#mTableWrap');
  const topOf = (wrap, row) => {
    const th = wrap.querySelector('th'), hh = th ? th.offsetHeight : 0, want = Math.max(0, row.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop - hh);
    // 선택한 행 아래에 행이 적으면 맨 위까지 올라오지 못하므로, 필요한 만큼 빈 여백을 덧붙인다
    let sp = wrap.querySelector('.tspace'); const lack = want - (wrap.scrollHeight - (sp ? sp.offsetHeight : 0) - wrap.clientHeight);
    if (lack > 0) { if (!sp) { sp = document.createElement('div'); sp.className = 'tspace'; wrap.appendChild(sp); } sp.style.height = Math.ceil(lack) + 'px'; } else if (sp) sp.style.height = '0px';
    return want;
  };
  const alignM = () => {   // 선택한 달: 차트는 오른쪽 끝에, 표는 맨 위(머리글 아래)에
    const g = cw.querySelector(`g[data-month="${state.aMonth}"]`), idx = keys.indexOf(state.aMonth);
    let right = 8 + (idx + 1) * 76; try { if (g) { const b = g.getBBox(); right = b.x + b.width; } } catch (_) {}
    cw.scrollLeft = Math.max(0, right - cw.clientWidth);
    const row = tw.querySelector(`tr[data-month="${state.aMonth}"]`); if (row) tw.scrollTop = topOf(tw, row);
  };
  if (hadScroll) {
    const keep = (wrap, top) => {   // 정렬 때 붙였던 빈 여백을 다시 그린 뒤에도 유지 (스크롤이 튀지 않게)
      const lack = top - (wrap.scrollHeight - wrap.clientHeight);
      if (lack > 0) { const sp = document.createElement('div'); sp.className = 'tspace'; sp.style.height = Math.ceil(lack) + 'px'; wrap.appendChild(sp); }
      wrap.scrollTop = top;
    };
    cw.scrollLeft = state.aScroll.l || 0; keep(tw, state.aScroll.t || 0); }
  else { alignM(); state.aScroll = { l: cw.scrollLeft, t: tw.scrollTop }; }   // 처음에는 선택한 달이 보이도록 정렬
  if (state.aAlign === 'month') alignM();
  state.aAlign = null;
  const pick = e => {
    const el = e.target.closest('[data-month]'); if (!el || !B[el.dataset.month]) return;
    state.aMonth = el.dataset.month; viewAnalysis();
    const d = $('#mDetail'); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  cw.onclick = pick; tw.onclick = pick;
  const cc = $('#catChartWrap');
  if (cc) { cc.onclick = pick; const g = cc.querySelector(`g[data-month="${state.aMonth}"]`); let right = 8 + (keys.indexOf(state.aMonth) + 1) * 76; try { if (g) { const b = g.getBBox(); right = b.x + b.width; } } catch (_) {} cc.scrollLeft = Math.max(0, right - cc.clientWidth); }
  view().querySelectorAll('[data-inc]').forEach(el => el.onclick = () => {
    state.hFilter = { month: state.aMonth, cats: ['수입>' + el.dataset.inc], kind: 'income' }; state.hQuery = ''; state.hSort = 'new'; state.hLimit = 200; state.tab = 'history'; render();
  });
  view().querySelectorAll('[data-cat]').forEach(el => el.onclick = e => {
    if (e.target.closest('[data-act]')) return;   // ▸ 펼치기 버튼은 내역으로 이동하지 않음
    state.hFilter = { month: state.aMonth, cats: [el.dataset.cat], kind: 'expense' }; state.hQuery = ''; state.hSort = 'new'; state.hLimit = 200; state.tab = 'history'; render();
  });
  $('#aMonth').onchange = e => { state.aMonth = e.target.value; state.aAlign = 'month'; viewAnalysis(); };
  $('#pSel').onchange = e => { state.pSel = e.target.value; viewAnalysis(); };
  document.querySelectorAll('tr[data-pr]').forEach(tr => { tr.onclick = () => { state.pSel = tr.dataset.pr; viewAnalysis(); }; });
}

function viewSettings() {
  const S = state.settings, rules = Object.entries(state.rules).sort((a, b) => a[0].localeCompare(b[0], 'ko'));
  const pDays = payDaysOf(), pl = payments(todayISO()), np = pl[nextPayIdx(pl, todayISO())], pdFrom = dnum(np.pay) - dnum(todayISO()) <= 7 ? addM(np.ym, 1) : np.ym;   // 새 결제일 기본 적용월
  const cLims = catLimitsOf(), clKeys = [...new Set(state.tx.filter(t => t.kind === 'expense' && t.cls && !t.cls.startsWith('이체')).flatMap(t => { const c = catOf(t), s = subOf(t); return s ? [c, c + '>' + s] : [c]; }))].sort((a, b) => a.localeCompare(b, 'ko'));
  view().innerHTML = `<div class="card"><h2>한도·카드 설정</h2><div class="row2">
      <div><label class="f">월 생활비 한도(원)</label><input id="sMonth" inputmode="numeric" value="${S.monthLimit}"></div><div><label class="f">카드 사용 한도(원)</label><input id="sCard" inputmode="numeric" value="${S.cardLimit}"></div>
      <div><label class="f">마이너스 인출 한도(원)</label><input id="sOd" inputmode="numeric" value="${S.overdraftLimit}"></div></div>
    <button class="btn" data-act="saveSettings">설정 저장</button></div>

    <div class="card"><h2>대분류별 한도 <small>대분류 또는 '대분류 › 소분류' · 월/연 기준</small></h2>
      ${cLims.length ? `<table>${cLims.map(e => state.clEdit === e.key   // 수정 중인 줄: 금액·월/연을 바로 고침
        ? `<tr><td style="text-align:left">${esc(e.key.replace('>', ' › '))}</td><td><input id="clEdAmt" inputmode="numeric" value="${e.amount.toLocaleString('ko-KR')}" style="width:110px;padding:4px 6px;font-size:13px"></td><td><select id="clEdUnit" style="width:auto;padding:4px;font-size:13px"><option value="m" ${e.unit === 'm' ? 'selected' : ''}>월</option><option value="y" ${e.unit === 'y' ? 'selected' : ''}>연</option></select></td><td style="white-space:nowrap"><button class="btn sm" data-act="saveCatLimit" data-key="${esc(e.key)}" style="margin:0 4px 0 0">저장</button><button class="btn sec sm" data-act="editCatLimit" data-key="" style="margin:0">취소</button></td></tr>`
        : `<tr><td style="text-align:left">${esc(e.key.replace('>', ' › '))}</td><td>${won(e.amount)}</td><td>${e.unit === 'y' ? '연' : '월'}</td><td style="white-space:nowrap"><button class="btn sec sm" data-act="editCatLimit" data-key="${esc(e.key)}" style="margin:0 4px 0 0">수정</button><button class="btn sec sm" data-act="delCatLimit" data-key="${esc(e.key)}" style="margin:0">삭제</button></td></tr>`).join('')}</table>` : '<div class="note">설정된 한도가 없습니다.</div>'}
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px"><select id="clKey" style="flex:1 1 140px;min-width:0">${clKeys.map(k => `<option value="${esc(k)}">${esc(k.replace('>', ' › '))}</option>`).join('')}</select>
        <input id="clAmt" inputmode="numeric" placeholder="금액(원)" autocomplete="off" style="flex:1 1 110px;min-width:0">
        <select id="clUnit" style="flex:0 0 72px;min-width:0"><option value="m">월</option><option value="y">연</option></select></div>
      <button class="btn sec" data-act="addCatLimit">추가</button>
      <div class="note">같은 분류를 다시 추가하면 바뀝니다. 월 한도는 분석 탭의 월 상세·대분류별 차트에, 연 한도는 '연간 한도'에 표시돼요.</div></div>

    <div class="card"><h2>카드결제일(하나카드 기준)</h2>
      <table>${pDays.map(e => `<tr><td>${esc(e.from)} 결제부터</td><td><b>${e.day}일</b></td></tr>`).join('')}</table>
      <div class="row2" style="margin-top:12px"><div><label class="f">바뀐 결제일</label><select id="pdDay">${PAY_DAYS_OK.map(d => `<option value="${d}">${d}일</option>`).join('')}</select></div><div><label class="f">몇 월 결제부터</label><input id="pdFrom" type="month" value="${pdFrom}"></div></div>
      <button class="btn sec" data-act="addPayDay">결제일 변경 추가</button>
      <button class="btn sec" data-act="delPayDay" ${pDays.length > 1 ? '' : 'disabled'}>마지막 변경 지우기</button>
      <div class="note">결제일을 바꾸면 그 결제월부터 선택지와 청구 기간이 바뀌어요. 청구 기간은 하나카드 결제일 표 기준.</div></div>

    <div class="card"><h2>분류 규칙 <small>대분류(또는 '대분류>소분류') → 성격</small></h2>
      <table>${rules.map(([k, n]) => `<tr><td>${esc(k)}</td><td><select data-rule="${esc(k)}" style="width:auto;padding:4px 8px;font-size:14px">${NATURES.map(x => `<option ${x === n ? 'selected' : ''}>${x}</option>`).join('')}</select></td><td>${state.rules[k] !== DEFAULT_RULES[k] || !(k in DEFAULT_RULES) ? `<button class="btn sec sm" data-act="delRule" data-key="${esc(k)}">삭제</button>` : ''}</td></tr>`).join('')}</table>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px"><select id="rCat" style="flex:1 1 140px;min-width:0"><option value="">대분류 선택</option>${[...new Set(['미분류', '카드대금', ...allCats(), ...Object.keys(state.rules).filter(k => !k.includes('>')).map(normCls)])].sort((a, b) => a.localeCompare(b, 'ko')).map(c => `<option>${esc(c)}</option>`).join('')}</select>
        <input id="rSub" list="rSubs" placeholder="소분류 (비우면 대분류 기본값)" autocomplete="off" disabled style="flex:1 1 140px;min-width:0"><datalist id="rSubs"></datalist>
        <select id="rNat" style="flex:1 1 140px;min-width:0">${NATURES.map(x => `<option>${x}</option>`).join('')}</select></div>
      <button class="btn sec" data-act="addRule">규칙 추가</button>
      <div class="note">우선순위: 세부 예외 → 카드대금·저축/보험은 제외 → 내역의 '고정/비정기' 표시 → 대분류 기본값</div></div>

    <div class="card"><h2>데이터 가져오기·내보내기</h2>
      <label class="f">기존 내역 가져오기 (import.json)</label><input id="fImport" type="file" accept=".json,application/json">
      <div class="note">카드·은행·지출점검시트 엑셀은 입력 탭의 '엑셀 올리기'에서 올리세요.</div>
      <div class="row2" style="margin-top:14px"><button class="btn sec" data-act="exportJson" style="margin:0">백업(JSON)</button><button class="btn sec" data-act="exportCsv" style="margin:0">엑셀용(CSV)</button></div>
      <div class="note">전체 ${state.tx.length}건 저장됨. 백업 파일에는 개인 내역이 들어 있으니 인터넷에 올리지 마세요.</div></div>

    <div class="card"><h2>계정</h2><div class="note" style="margin:0 0 10px">${DEMO ? '미리보기 모드 — 이 화면의 데이터는 새로고침하면 사라집니다.' : '로그인: ' + esc(state.user?.email || '')}</div>
      ${DEMO ? '' : '<button class="btn sec" data-act="logout">로그아웃</button>'}</div>`;
  $('#rCat').onchange = e => {
    const cat = e.target.value, sub = $('#rSub');
    sub.value = ''; sub.disabled = !cat;
    $('#rSubs').innerHTML = cat ? [...new Set([...subsOf(cat), ...Object.keys(state.rules).filter(k => k.startsWith(cat + '>')).map(k => k.slice(cat.length + 1))])].filter(Boolean).map(s => `<option value="${esc(s)}">`).join('') : '';
  };
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
const ROUTINE_EOM_FROM = '2026-12-31';   // 메인 월 루틴: 이 날짜부터 매월 말일 (그 전에는 21일)
function aNextRoutine() {   // 다음 메인 월 루틴 날짜 { iso, label, days }
  const t = todayISO(), [y, m] = t.split('-').map(Number), d21 = `${y}-${p2(m)}-21`, eom = isoOf(Date.UTC(y, m, 0) / 86400000), n21 = `${addM(t.slice(0, 7), 1)}-21`;
  let iso = t <= d21 && d21 < ROUTINE_EOM_FROM ? d21 : eom >= ROUTINE_EOM_FROM ? eom : (n21 < ROUTINE_EOM_FROM ? n21 : ROUTINE_EOM_FROM);
  if (iso < t) iso = isoOf(Date.UTC(y, m + 1, 0) / 86400000);   // 이번 달 말일이 지났으면 (그럴 일은 없지만) 다음 달 말일
  return { iso, label: `${+iso.slice(5, 7)}월 ${+iso.slice(8, 10)}일${iso >= ROUTINE_EOM_FROM ? '(말일)' : ''}`, days: Math.round(dnum(iso) - dnum(t)) };
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
  const nr = aNextRoutine();
  const up = state.asset.uploaded_at ? new Date(state.asset.uploaded_at) : null;
  const upTxt = up && !isNaN(up) ? `${up.getFullYear()}.${p2(up.getMonth() + 1)}.${p2(up.getDate())} ${p2(up.getHours())}:${p2(up.getMinutes())}` : '-';
  let h = `<div class="note" style="margin:0 0 10px">기준: ${aYmd(L.date)} 월별기록 · 파일 ${esc(state.asset.file_name || '-')} · 업로드 ${upTxt}</div>`;

  // ---- banner: 21일 리마인더 / 기록 지연 ----
  const daysSince = Math.floor((Date.now() - aToDate(L.date).getTime()) / 86400000);
  h += daysSince > 35
    ? `<div class="banner warn">마지막 기록이 ${daysSince}일 전입니다. 월 루틴(시트 갱신)을 확인하세요. 다음 월 루틴: ${nr.label} (D-${nr.days})</div>`
    : `<div class="banner ok">기록은 최신입니다. 다음 월 루틴: ${nr.label} (D-${nr.days}) · 2026-12-31부터 매월 말일</div>`;

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
    ['현금성(입출금통장)', L.cash, 'var(--c4)'], ['증권 예수금', L.deposit, 'var(--c5)'], ['투자 버킷', L.bucket, 'var(--c6)']
  ];
  const gross = comp.reduce((s, c) => s + (c[1] || 0), 0);
  h += `<div class="card"><h2>자산 구성 <small>총자산 ${won(gross)} − 부채 ${won(Math.abs(L.debt || 0))}</small></h2>
    <div class="stack">${comp.map(c => `<span style="width:${((c[1] || 0) / gross * 100).toFixed(2)}%;background:${c[2]}"></span>`).join('')}</div>
    <table>${comp.map(c => `<tr><td><span class="legend"><span><i style="background:${c[2]}"></i></span></span>${c[0]}</td><td>${won(c[1])}</td><td>${aPct((c[1] || 0) / gross)}</td></tr>`).join('')}
    <tr><td><span class="legend"><span><i style="background:var(--debt)"></i></span></span>부채 (마이너스통장)</td><td class="neg">${won(L.debt)}</td><td></td></tr></table>
    ${(L.debt || 0) > 0 ? `<div class="banner warn" style="margin-top:10px">월별기록 G열(부채)에 플러스 금액 ${won(L.debt)}이 들어 있어요. 마이너스통장이 플러스가 되면 G열은 0으로 두고, 그 금액은 E열 '현금성(입출금통장)'에 더해 적어 주세요.</div>` : ''}
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
  // 1단계 조건 (전략서 v13): 카드 결제 후(결제일+2일) 통장 잔액 0원 이상 3회 연속 — 앱 결제 기록의 확정분 기준
  const PRs = state.settings.payRecords || {}, donePays = payments(todayISO()).filter(p => p.pay < todayISO() && PRs[p.ym] && PRs[p.ym].bal != null);
  let streak = 0; for (let i = donePays.length - 1; i >= 0; i--) { if (PRs[donePays[i].ym].bal >= 0) streak++; else break; }
  const lastPR = donePays.length ? PRs[donePays[donePays.length - 1].ym] : null;
  const CASH_GOAL = 7050000, cashPct = Math.min(1, (L.cash || 0) / CASH_GOAL);
  h += `<div class="card"><h2>위험자산 사다리 <small>현재 ${curStep}단계 · 엑셀 판정 도달 가능 ${reach ?? '-'}단계</small></h2><div class="steps">${[6, 7, 8, 9, 10].map((r, i) => `
    <div class="step ${i === curStep ? 'cur' : ''}"><div class="n">${aS('사다리', 'A' + r)}단계 ${i === curStep ? '◀ 현재' : ''}</div>
    <div class="p">위험 ${aPct(aNum(aS('사다리', 'C' + r)), 0)} · 코어 ${aPct(aNum(aS('사다리', 'D' + r)), 0)}</div>
    <div style="margin-top:6px">${esc(aS('사다리', 'B' + r))}</div></div>`).join('')}</div>
    <div class="cond"><b>1단계 조건</b> — 카드 결제 후(결제일+2일) 통장 잔액 0원 이상 연속 ${streak}/3회 ${lastPR ? `(최근 확정 ${won(lastPR.bal)})` : '(확정 기록 없음 — 은행 거래내역을 올리세요)'}
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
  if (state.shown === 'analysis') { saveAScroll(); state.aPageY = window.scrollY; }   // 분석 탭을 떠나기(또는 다시 그리기) 직전의 위치 저장
  const keepY = state.shown === 'settings' && state.tab === 'settings' ? window.scrollY : null;   // 설정 탭 안에서 다시 그릴 때(수정·추가·삭제)는 보던 위치 유지
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  ({ input: viewInput, history: viewHistory, analysis: viewAnalysis, asset: viewAsset, settings: viewSettings })[state.tab]();
  state.shown = state.tab;
  if (state.tab === 'analysis' && state.aPageY != null) { window.scrollTo(0, state.aPageY); state.aPageY = null; } else window.scrollTo(0, keepY ?? 0);
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
  hMore: () => { state.hLimit = (state.hLimit || 200) + 200; renderHistoryBody(); },
  saveSettings: () => run(async () => {
    const n = id => parseInt($(id).value.replace(/\D/g, ''), 10);
    const s = { monthLimit: n('#sMonth'), cardLimit: n('#sCard'), overdraftLimit: n('#sOd') };
    if (Object.values(s).some(v => !v && v !== 0)) throw new Error('숫자를 확인하세요'); if (s.overdraftLimit < 0) throw new Error('마이너스 인출 한도는 0 이상이어야 해요');
    const merged = { ...state.settings, ...s };
    await backend.saveSettings(merged); state.settings = { ...DEFAULT_SETTINGS, ...merged }; toast('설정 저장됨');
  }),
  addCatLimit: () => run(async () => {
    const key = $('#clKey').value, amount = parseInt($('#clAmt').value.replace(/\D/g, ''), 10), unit = $('#clUnit').value === 'y' ? 'y' : 'm';
    if (!key) throw new Error('분류를 선택하세요'); if (!(amount > 0)) throw new Error('금액을 확인하세요');
    const catLimits = [...catLimitsOf().filter(e => e.key !== key), { key, amount, unit }];
    const merged = { ...state.settings, catLimits };
    await backend.saveSettings(merged); state.settings = { ...DEFAULT_SETTINGS, ...merged }; toast('한도 저장됨'); render();
  }),
  editCatLimit: el => { state.clEdit = el.dataset.key || null; render(); },
  saveCatLimit: el => run(async () => {
    const key = el.dataset.key, amount = parseInt($('#clEdAmt').value.replace(/\D/g, ''), 10), unit = $('#clEdUnit').value === 'y' ? 'y' : 'm';
    if (!(amount > 0)) throw new Error('금액을 확인하세요');
    const catLimits = catLimitsOf().map(e => e.key === key ? { key, amount, unit } : e), merged = { ...state.settings, catLimits };
    await backend.saveSettings(merged); state.settings = { ...DEFAULT_SETTINGS, ...merged }; state.clEdit = null; toast('한도 수정됨'); render();
  }),
  delCatLimit: el => run(async () => {
    const catLimits = catLimitsOf().filter(e => e.key !== el.dataset.key), merged = { ...state.settings, catLimits };
    await backend.saveSettings(merged); state.settings = { ...DEFAULT_SETTINGS, ...merged }; toast('한도 삭제됨'); render();
  }),
  mdToggle: el => { const o = state.mdOpen ??= {}; o[el.dataset.v] = !o[el.dataset.v]; viewAnalysis(); },
  mdAll: el => { const o = state.mdOpen ??= {}, cats = [...$('#mDetail').querySelectorAll('[data-act="mdToggle"]')].map(b => b.dataset.v), all = cats.every(c => o[c]); cats.forEach(c => o[c] = !all); viewAnalysis(); },
  catSel: el => { const v = el.dataset.v; state.catSel = v.includes('>') && state.catSel === v ? v.split('>')[0] : v; viewAnalysis(); },   // 선택된 소분류 칩을 다시 누르면 해제(부모 대분류로)
  addPayDay: () => run(async () => {
    const day = parseInt($('#pdDay').value, 10), from = $('#pdFrom').value, cur = payDaysOf();
    if (!PAY_DAYS_OK.includes(day)) throw new Error('하나카드 결제일 표에 있는 날짜만 고를 수 있어요');
    if (!/^\d{4}-\d{2}$/.test(from)) throw new Error('결제월을 입력하세요');
    const payDays = [...cur.filter(e => e.from !== from), { from, day }].sort((a, b) => a.from < b.from ? -1 : 1);
    const merged = { ...state.settings, payDays };
    await backend.saveSettings(merged); state.settings = { ...DEFAULT_SETTINGS, ...merged }; state.pSel = null; toast('결제일 변경 추가됨'); render();
  }),
  delPayDay: () => run(async () => {
    const cur = payDaysOf(); if (cur.length < 2) throw new Error('지울 변경 내역이 없어요');
    const merged = { ...state.settings, payDays: cur.slice(0, -1) };
    await backend.saveSettings(merged); state.settings = { ...DEFAULT_SETTINGS, ...merged }; state.pSel = null; toast('마지막 변경을 지웠어요'); render();
  }),
  ppTab: el => { state.ppTab = el.dataset.v; viewAnalysis(); },
  saveOnnuriSnap: () => run(async () => {
    const date = $('#onDate').value, v = $('#onBal').value.replace(/\D/g, ''), balance = v === '' ? NaN : parseInt(v, 10);
    if (!date) throw new Error('날짜를 입력하세요');
    if (isNaN(balance)) throw new Error('잔액을 숫자로 입력하세요');
    const onnuriSnaps = [...(state.settings.onnuriSnaps || []).filter(s => s.date !== date), { date, balance }].sort((a, b) => a.date < b.date ? -1 : 1).slice(-24);
    const merged = { ...state.settings, onnuriSnaps };
    await backend.saveSettings(merged); state.settings = { ...DEFAULT_SETTINGS, ...merged }; toast('잔액 기록됨'); viewAnalysis();
  }),
  useBankAuto: el => run(async () => {   // 이 결제 기간에 직접 입력한 통장 잔액을 지우고 은행 거래내역 잔액을 쓰게 함
    const from = el.dataset.from || '', to = el.dataset.to, inWin = d => (!from || d >= from) && d < to;
    const mine = (state.settings.bankSnaps || []).filter(s => inWin(s.date)); if (!mine.length) return;
    if (!confirm(`이 결제 기간에 직접 입력한 통장 잔액 ${mine.length}건(${mine.map(s => s.date.slice(5).replace('-', '.')).join(', ')})을 지우고 은행 거래내역 잔액을 쓸까요?`)) return;
    const merged = { ...state.settings, bankSnaps: (state.settings.bankSnaps || []).filter(s => !inWin(s.date)) };
    await backend.saveSettings(merged); state.settings = { ...DEFAULT_SETTINGS, ...merged }; toast('통장 기록으로 변경됨'); viewAnalysis();
  }),
  saveBankSnap: () => run(async () => {
    const date = $('#bkDate').value, v = $('#bkBal').value.replace(/[,\s]/g, '');
    if (!date) throw new Error('날짜를 입력하세요');
    if (!/^-?\d+$/.test(v)) throw new Error('잔액을 숫자로 입력하세요 (마이너스는 - 로)');
    const bankSnaps = [...(state.settings.bankSnaps || []).filter(s => s.date !== date), { date, balance: parseInt(v, 10) }].sort((a, b) => a.date < b.date ? -1 : 1).slice(-24);
    const merged = { ...state.settings, bankSnaps };
    await backend.saveSettings(merged); state.settings = { ...DEFAULT_SETTINGS, ...merged }; toast('잔액 기록됨'); viewAnalysis();
  }),
  saveSnap: () => run(async () => {
    const num = id => { const v = $(id).value.replace(/\D/g, ''); return v === '' ? NaN : parseInt(v, 10); };
    const date = $('#ppDate').value, charge = num('#ppCharge'), cashback = num('#ppCb');
    if (!date) throw new Error('날짜를 입력하세요');
    if (isNaN(charge) || isNaN(cashback) || charge < 0 || cashback < 0) throw new Error('충전 잔액과 캐시백 잔액을 숫자로 입력하세요');
    const snaps = [...(state.settings.prepaidSnaps || []).filter(s => s.date !== date), { date, charge, cashback }].sort((a, b) => a.date < b.date ? -1 : 1).slice(-24);
    const merged = { ...state.settings, prepaidSnaps: snaps };
    await backend.saveSettings(merged); state.settings = { ...DEFAULT_SETTINGS, ...merged }; toast('잔액 기록됨'); render();
  }),
  addRule: () => run(async () => {
    const cat = $('#rCat').value; if (!cat) throw new Error('대분류를 선택하세요');
    const sub = $('#rSub').value.replace(/>/g, '').trim(), k = normCls(cat + (sub ? '>' + sub : ''));
    await backend.setRules([{ key: k, nature: $('#rNat').value }]); state.rules[k] = $('#rNat').value; prep(); toast('규칙 추가됨'); viewSettings();
  }),
  delRule: el => run(async () => { const k = el.dataset.key; await backend.delRule(k); if (k in DEFAULT_RULES) state.rules[k] = DEFAULT_RULES[k]; else delete state.rules[k]; prep(); viewSettings(); }),
  logout: () => run(async () => { await backend.signOut(); }),
  exportJson: () => download('가계부백업_' + todayISO() + '.json', JSON.stringify({ tx: state.tx.map(({ _n, _m, id, user_id, created_at, ...r }) => r), rules: Object.entries(state.rules).map(([key, nature]) => ({ key, nature })), settings: state.settings }, null, 1), 'application/json'),
  exportCsv: () => {
    const head = ['날짜', '구분', '금액', '결제', '사용처', '내역', '분류', '태그', '성격'];
    const lines = [head, ...[...state.tx].sort((a, b) => a.tx_date < b.tx_date ? -1 : 1).map(t => [t.tx_date, t.kind === 'income' ? '수입' : '지출', t.amount, payLabel(t.pay), t.place, t.memo, t.cls, t.tag, t._n])];
    download('가계부_' + todayISO() + '.csv', '﻿' + lines.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'), 'text/csv');
  }
};
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

async function doImport(file) {
  await run(async () => {
    const j = JSON.parse(await file.text());
    if (j.rules?.length) { j.rules = j.rules.map(r => ({ ...r, key: normCls(r.key) })); await backend.setRules(j.rules); j.rules.forEach(r => state.rules[r.key] = r.nature); }
    if (j.settings) { state.settings = { ...DEFAULT_SETTINGS, ...j.settings }; await backend.saveSettings(state.settings); }
    const rows = (j.tx || []).map(r => ({ ...r, cls: normCls(r.cls), import_key: r.import_key || ('bk|' + r.tx_date + '|' + r.amount + '|' + r.place + '|' + r.memo) }));
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

function parseCardKB(aoa, hi, fname) {   // KB국민카드 이용내역 (이용하신곳 / 국내이용금액(원) / 해외이용금액($) 형식)
  const col = colMap(aoa[hi]), g = (r, k) => (k in col ? r[col[k]] : '');
  const items = [], cancels = []; let cancelled = 0, cancelAmt = 0;
  for (const r of aoa.slice(hi + 1)) {
    const date = cellDate(g(r, '이용일')); if (!date) continue;
    if (cellStr(g(r, '상태')).includes('취소')) { const amount = Math.abs(Math.round(toNum(g(r, '국내이용금액(원)')))); if (amount > 0) cancels.push({ date, name: sp1(g(r, '이용하신곳')) || '카드', amount, approval: cellStr(g(r, '승인번호')) }); continue; }
    const krw = Math.round(toNum(g(r, '국내이용금액(원)')) - toNum(g(r, '할인금액'))), usd = toNum(g(r, '해외이용금액($)'));
    if (krw <= 0 && usd <= 0) continue;
    const name = sp1(g(r, '이용하신곳')) || '카드';
    let n = 1; const m = /(\d+)\s*개월/.exec(cellStr(g(r, '결제방법'))); if (m && +m[1] > 1) n = +m[1];
    items.push({ date, name, amount: krw > 0 ? krw : 0, usd: krw > 0 ? 0 : usd, n, check: /체크/.test(cellStr(g(r, '이용카드명'))), approval: cellStr(g(r, '승인번호')) });
  }
  const openCancels = [];   // 같은 파일 안의 원거래와 상계 (승인번호 우선, 없으면 같은 사용처·금액). 못 찾은 취소는 이미 저장된 내역과 대조하도록 넘김
  for (const cn of cancels) {
    let it = cn.approval ? items.find(x => x.approval === cn.approval && x.amount > 0) : null;
    if (!it) it = items.find(x => x.amount > 0 && x.name === cn.name && x.amount === cn.amount && x.date <= cn.date);
    if (!it) { openCancels.push(cn); continue; }
    cancelled++; cancelAmt += cn.amount;
    if (cn.amount >= it.amount) items.splice(items.indexOf(it), 1); else it.amount -= cn.amount;
  }
  return { type: 'card', fname, items, cancelled, cancelAmt, openCancels };
}
function parseCard(aoa, hi, fname) {
  const col = colMap(aoa[hi]), g = (r, k) => (k in col ? r[col[k]] : '');
  if ('이용하신곳' in col || '국내이용금액(원)' in col) return parseCardKB(aoa, hi, fname);
  const items = []; let cancelled = 0, cancelAmt = 0;
  for (const r of aoa.slice(hi + 1)) {
    const date = cellDate(g(r, '이용일')); if (!date) continue;
    const appr = toNum(g(r, '승인금액')), buy = toNum(g(r, '매입금액')), amount = Math.round(buy > 0 ? buy : appr);
    if (cellStr(g(r, '상태')).includes('취소')) { cancelled++; cancelAmt += appr; continue; }
    if (amount <= 0) continue;   // 0원·환불(음수) 행은 건너뜀 (DB는 음수 금액을 받지 않음)
    let n = 1; if (cellStr(g(r, '이용구분')) === '할부') n = Math.max(1, parseInt(toNum(g(r, '할부기간')), 10) || 1);
    items.push({ date, name: sp1(g(r, '가맹점명')) || '카드', amount, n, point: toNum(g(r, '포인트사용')), approval: cellStr(g(r, '승인번호')), full: Math.round(appr) });
  }
  return { type: 'card', fname, items, cancelled, cancelAmt };
}
function parseBank(aoa, hi, fname) {
  const col = colMap(aoa[hi]), g = (r, k) => (k in col ? r[col[k]] : '');
  const items = []; let seq = 0;
  for (const r of aoa.slice(hi + 1)) {
    const date = cellDate(g(r, '거래일시')); if (!date) continue;
    const out = Math.round(toNum(g(r, '출금액'))), inn = Math.round(toNum(g(r, '입금액'))); if (!out && !inn) continue;
    let label = '', memo = '';
    for (const k of ['보낸분/받는분', '송금메모', '적요']) { const v = sp1(g(r, k)); if (v && v !== 'nan') { if (!label) label = v; else if (!memo && v !== label) memo = v; } }
    const raw = g(r, '거래일시'), tm = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(raw)), jeok = sp1(g(r, '적요')), balRaw = g(r, '잔액');
    const ts = date + ' ' + (tm ? `${p2(tm[1])}:${tm[2]}:${tm[3] || '00'}` : `00:00:00.${String(99999 - seq).padStart(5, '0')}`);   // 시간이 없으면 행 순서(최신순)로 대체
    const bal = balRaw === '' || balRaw == null || String(balRaw).trim() === '' ? null : Math.round(toNum(balRaw)); seq++;
    items.push({ date, label: label || '거래', memo, out, inn, ts, bal, jeok: jeok === 'nan' ? '' : jeok });
  }
  return { type: 'bank', fname, items };
}
function bankDailyBals(files) {   // 은행 거래내역 → 날짜별 마지막 거래 후 잔액 [{ date, balance }]
  const items = files.flatMap(f => f.items).filter(it => it.bal != null && !isNaN(it.bal)).sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0), m = {};
  for (const it of items) m[it.date] = it.bal;
  return Object.entries(m).map(([date, balance]) => ({ date, balance }));
}
function payRecordsFromBank(files) {   // 은행 거래내역 → 지난 카드 결제 확정 기록 { ym: { ym, bill, bal, balDate, src } }
  const seen = new Set(), items = [], src = {};
  for (const f of files) for (const it of f.items) { const k = [it.ts, it.out, it.inn, it.bal].join('|'); if (seen.has(k)) continue; seen.add(k); items.push(it); src[k] = f.fname; }
  if (!items.length) return {};
  const today = todayISO(), recs = {};
  items.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
  for (const P of payments(today)) {
    if (P.pay >= today) continue;
    const lim = isoOf(dnum(P.pay) + 2), mon = items.filter(it => it.date.startsWith(P.ym));
    if (!mon.length || items[0].date > P.pay || !items.some(it => it.date >= lim)) continue;   // 파일이 결제일 ~ 결제일+2일을 모두 포함할 때만
    const bill = mon.filter(it => it.jeok !== '체크카드' && /하나카드|KB카드출금/.test(`${it.label} ${it.memo} ${it.jeok}`)).reduce((s, it) => s + it.out, 0);
    const upto = items.filter(it => it.date <= lim && it.bal != null), last = upto[upto.length - 1];
    if (!last) continue;
    recs[P.ym] = { ym: P.ym, bill, bal: last.bal, balDate: last.date, src: src[[last.ts, last.out, last.inn, last.bal].join('|')] || '' };
  }
  return recs;
}
function parseLedger(aoa, hi, fname) {
  const col = colMap(aoa[hi]), g = (r, k) => (k in col ? r[col[k]] : '');
  const items = [];
  for (const r of aoa.slice(hi + 1)) {
    const date = cellDate(g(r, '날짜')); if (!date) continue;
    const cash = toNum(g(r, '현금')), card = toNum(g(r, '카드')), amount = Math.round(cash + card); if (amount <= 0) continue;   // 0원·환불(음수) 행은 건너뜀
    const place = sp1(g(r, '사용처')) || sp1(g(r, '사용내역')) || '거래', memoRaw = sp1(g(r, '사용내역')), memo = memoRaw === place ? '' : memoRaw;
    items.push({ date, place, memo, cash, card, amount, cls: normCls(cellStr(g(r, '분류'))), tag: cellStr(g(r, '태그')) });
  }
  return { type: 'ledger', fname, items };
}
function parseLocalPay(aoa, hi, fname) {   // 대전사랑카드 앱 내보내기 (결제·충전 파일 / 캐시백 파일)
  const col = colMap(aoa[hi]), g = (r, k) => (k in col ? r[col[k]] : '');
  const items = [], cancels = []; let cancelled = 0;
  for (const r of aoa.slice(hi + 1)) {
    const date = cellDate(g(r, '승인일시')); if (!date) continue;
    const ts = cellStr(g(r, '승인일시')), type = sp1(g(r, '거래유형')), amt = Math.round(Math.abs(toNum(g(r, '금액')))), place = sp1(g(r, '사용처'));
    if (!amt) continue;
    if (type.includes('취소')) { cancels.push({ base: type.replace('취소', '').trim(), amt, place }); continue; }
    items.push({ date, ts, kind: type, amt, place });
  }
  for (const c of cancels) {
    let idx = -1; for (let i = items.length - 1; i >= 0; i--) { const it = items[i]; if (it.kind === c.base && it.amt === c.amt && it.place === c.place) { idx = i; break; } }
    if (idx >= 0) { items.splice(idx, 1); cancelled++; }
  }
  const unknown = items.filter(it => !['결제', '충전', '캐시백 적립', '캐시백 사용'].includes(it.kind)).length;
  return { type: 'localpay', fname, items, cancelled, unknown };
}
const dateYmd8 = v => { const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(v ?? '').trim()); return m ? `${m[1]}-${m[2]}-${m[3]}` : cellDate(v); };   // 20261025 형식도 인식
const timeHms = v => String(v ?? '').trim().replace(/\.0+$/, '').replace(/[:\s]/g, '').padStart(6, '0');
function parseOnnuri(aoa, hi, fname, type) {   // 디지털 온누리 결제내역(onnuripay) / 충전내역(onnuricharge)
  const col = colMap(aoa[hi]), g = (r, k) => (k in col ? r[col[k]] : '');
  const items = [], cancels = []; let cancelled = 0;
  for (const r of aoa.slice(hi + 1)) {
    const date = dateYmd8(g(r, '거래일자')); if (!date) continue;
    const ts = timeHms(g(r, '거래시각')), amount = Math.round(Math.abs(toNum(g(r, '거래금액')))), st = cellStr(g(r, '거래상태')), ty = cellStr(g(r, '거래유형'));
    const place = sp1(g(r, type === 'onnuripay' ? '가맹점 및 상품권명' : '상품권명'));
    if (!amount) continue;
    if (st.includes('취소') || ty.includes('취소')) { if (type === 'onnuripay') cancels.push({ date, place, amount, ts }); continue; }
    if (type === 'onnuricharge' ? !st.includes('완료') : (st && !st.includes('완료'))) continue;
    items.push({ date, ts, place, amount });
  }
  for (const c of cancels) {   // 취소 행은 같은 날짜·가맹점·금액의 결제완료 행 하나와 함께 제외
    let idx = -1; for (let i = items.length - 1; i >= 0; i--) { const it = items[i]; if (it.date === c.date && it.place === c.place && it.amount === c.amount && it.ts <= c.ts) { idx = i; break; } }
    if (idx < 0) for (let i = items.length - 1; i >= 0; i--) { const it = items[i]; if (it.date === c.date && it.place === c.place && it.amount === c.amount) { idx = i; break; } }
    if (idx >= 0) { items.splice(idx, 1); cancelled++; }
  }
  return { type, fname, items, cancelled };
}
function detectAndParse(aoa, fname) {
  const find = pred => aoa.slice(0, 15).findIndex(r => pred(r.map(cellStr)));
  let hiO = find(cs => cs.includes('거래일자') && cs.includes('거래금액') && (cs.includes('가맹점 및 상품권명') || cs.includes('상품권명'))); if (hiO >= 0) return parseOnnuri(aoa, hiO, fname, aoa[hiO].map(cellStr).includes('가맹점 및 상품권명') ? 'onnuripay' : 'onnuricharge');
  let hi0 = find(cs => cs.includes('승인일시') && cs.includes('거래유형') && cs.includes('금액')); if (hi0 >= 0) return parseLocalPay(aoa, hi0, fname);
  let hi = find(cs => cs.some(s => /^이용일/.test(s) && s.length <= 6)); if (hi >= 0) return parseCard(aoa, hi, fname);
  hi = find(cs => cs.includes('거래일시')); if (hi >= 0) return parseBank(aoa, hi, fname);
  hi = find(cs => cs.includes('날짜') && (cs.includes('사용처') || cs.includes('사용내역')) && (cs.includes('현금') || cs.includes('카드'))); if (hi >= 0) return parseLedger(aoa, hi, fname);
  return null;
}

// 사용처 비교용: 법인 표기·공백·특수문자를 없애고 소문자로
const canonPlace = s => normPlace(s).replace(/\(주\)|㈜|주식회사|\(유\)|\bco\.?\s*,?\s*ltd\.?|\binc\.?/gi, '').replace(/[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, '').toLowerCase();
const upgradeCls = (cls, h) => (cls && !cls.includes('>') && h && h.cls && h.cls.includes('>') && h.cls.split('>')[0] === cls) ? h.cls : cls;   // 파일에는 대분류만 있고 기록에는 소분류까지 있으면 기록 쪽으로
function histMap() {   // 같은 사용처를 전에 분류한 대로 (가장 최근 기록 우선)
  const ex = new Map(), inc = new Map(), exC = new Map(), incC = new Map();
  for (const t of state.tx) {
    const k = normPlace(t.place); if (!k) continue; const isInc = t.kind === 'income', m = isInc ? inc : ex, cm = isInc ? incC : exC, v = { cls: t.cls, tag: t.tag };
    if (!m.has(k)) m.set(k, v);
    const c = canonPlace(t.place); if (c && !cm.has(c)) cm.set(c, v);
  }
  const exL = [...exC], incL = [...incC];   // 최근 순
  const look = (isInc, place) => {   // 정확히 같음 → 정규화 후 같음 → 한쪽이 다른 쪽을 포함(3글자 이상, 가장 최근)
    const k = normPlace(place); if (!k) return null;
    const m = isInc ? inc : ex; if (m.has(k)) return m.get(k);
    const c = canonPlace(place); if (!c) return null;
    const cm = isInc ? incC : exC; if (cm.has(c)) return cm.get(c);
    if (c.length < 3) return null;
    for (const [c2, v] of (isInc ? incL : exL)) if (c2.length >= 3 && (c2.includes(c) || c.includes(c2))) return v;
    return null;
  };
  return { ex, inc, look };
}
function buildCands() {
  const imp = state.imp, H = histMap(), cands = [], seen = {};
  const look0 = H.look;   // 배달 앱 사용처(캐시백 제외)는 기록이 이미 '식비>배달…'이면 그대로, 아니면 '식비>배달'로 강제
  H.look = (isInc, place) => {
    const h = look0(isInc, place), p = String(place || '');
    if (isInc || !DELIVERY_PAT.test(p) || /캐시백/.test(p)) return h;
    return (h && h.cls && h.cls.startsWith('식비>배달')) ? h : { cls: '식비>배달', tag: h ? h.tag : '' };
  };
  const keyOf = (pre, date, amt, place, extra) => { const k0 = `${pre}|${date}|${amt}|${place}|${extra || ''}`; seen[k0] = (seen[k0] || 0) + 1; return `${k0}|${seen[k0]}`; };
  for (const f of imp.files) {
    if (f.type === 'card') {
      for (const it of f.items) {
        if (f.payAs === 'prepaid') {   // 지역화폐: 전액을 지출로, 캐시백(포인트) 사용분은 같은 날 수입으로 따로
          const amount = it.full > 0 ? it.full : it.amount, h = H.look(false, it.name), ap =it.approval ? 'ap' + it.approval : it.date;
          cands.push({ tx_date: it.date, kind: 'expense', amount, pay: 'prepaid', place: it.name, memo: '', cls: h ? h.cls : '', tag: h ? h.tag : '', source: 'card', import_key: keyOf('pp', it.date, amount, it.name, ap) });
          continue;
        }
        if (it.usd > 0 && !(it.amount > 0)) {   // 해외 결제: 원화 청구액을 사용자가 입력해야 함
          const place = `${it.name} (해외 $${it.usd})`, h = H.look(false, it.name);
          cands.push({ tx_date: it.date, kind: 'expense', amount: 0, pay: it.check ? 'cash' : 'card', place, memo: '', cls: h ? h.cls : '', tag: h ? h.tag : '', source: 'card', _needAmt: true,
            import_key: it.approval ? keyOf('cd', it.date, it.usd, place, 'ap' + it.approval) : keyOf('cd', it.date, it.usd, place, `${it.date}:usd`) });
          continue;
        }
        const parts = (it.n > 1 && imp.mode === 'split') ? it.n : 1, base = Math.floor(it.amount / parts), rem = it.amount - base * parts, h = H.look(false, it.name);
        for (let k = 0; k < parts; k++) {
          const date = parts > 1 ? addMonths(it.date, k) : it.date, amount = base + (k === 0 ? rem : 0);
          const place = parts > 1 ? `${it.name} (할부 ${k + 1}/${parts})` : (it.n > 1 ? `${it.name} (할부 ${it.n}개월 일시)` : it.name);
          cands.push({ tx_date: date, kind: 'expense', amount, pay: it.check ? 'cash' : 'card', place, memo: '', cls: h ? h.cls : '', tag: mergeTag(h && h.tag, it.n > 1 ? '할부' : ''), source: 'card', import_key: keyOf('cd', date, amount, place, it.approval ? 'ap' + it.approval : `${it.date}:${it.amount}`) });
        }
      }
    } else if (f.type === 'localpay') {
      for (const it of f.items) {
        const nm = it.place || '대전사랑카드', h = H.look(false, nm);
        if (it.kind === '결제') cands.push({ tx_date: it.date, kind: 'expense', amount: it.amt, pay: 'prepaid', place: nm, memo: '', cls: h ? h.cls : '', tag: h ? h.tag : '', source: 'localpay', import_key: keyOf('lw', it.date, it.amt, it.place, it.ts + '결제') });
        else if (it.kind === '충전') cands.push({ tx_date: it.date, kind: 'expense', amount: it.amt, pay: 'cash', place: '대전사랑카드 충전', memo: '', cls: '이체>선불충전', tag: '', source: 'localpay', _topup: true, import_key: keyOf('lw', it.date, it.amt, '충전', it.ts) });
        else if (it.kind === '캐시백 적립') cands.push({ tx_date: it.date, kind: 'income', amount: it.amt, pay: 'prepaid', place: `${nm} 캐시백 적립`, memo: '', cls: '수입>캐시백', tag: '', source: 'localpay', import_key: keyOf('lc', it.date, it.amt, it.place, it.ts + '적립') });
        else if (it.kind === '캐시백 사용') cands.push({ tx_date: it.date, kind: 'expense', amount: it.amt, pay: 'prepaid', place: `${nm} 캐시백 사용`, memo: '', cls: '이체>캐시백사용', tag: '', source: 'localpay', import_key: keyOf('lc', it.date, it.amt, it.place, it.ts + '사용') });
      }
    } else if (f.type === 'onnuripay') {
      for (const it of f.items) {
        const h = H.look(false, it.place);
        cands.push({ tx_date: it.date, kind: 'expense', amount: it.amount, pay: 'onnuri', place: it.place || '온누리', memo: '', cls: h ? h.cls : '', tag: h ? h.tag : '', source: 'onnuri', import_key: keyOf('op', it.date, it.amount, it.place, it.ts) });
      }
    } else if (f.type === 'onnuricharge') {
      for (const it of f.items) cands.push({ tx_date: it.date, kind: 'expense', amount: it.amount, pay: 'cash', place: '온누리상품권 충전', memo: '', cls: '이체>온누리충전', tag: '', source: 'onnuri', _topup: true, _onnuriFace: true, import_key: keyOf('oc', it.date, it.amount, '충전', it.ts) });
    } else if (f.type === 'ledger') {
      for (const it of f.items) {
        const h = H.look(false, it.place);
        cands.push({ tx_date: it.date, kind: 'expense', amount: it.amount, pay: it.card > 0 ? 'card' : 'cash', place: it.place, memo: it.memo, cls: it.cls ? upgradeCls(it.cls, h) : ((h && h.cls) || ''), tag: it.cls ? it.tag : mergeTag(it.tag, h && h.tag), source: 'naver', import_key: keyOf('nv', it.date, it.amount, it.place, it.memo) });
      }
    } else {
      for (const it of f.items) {
        const income =!(it.out > 0), onn = !income && /온누리/.test(it.label), amount = income ? it.inn : it.out, cardPay = !income && CARD_PAT.test(it.label), topup = !income && /오픈지역사랑상품|지역사랑상품|대전사랑/.test(it.label), h = H.look(income, it.label);
        cands.push({ tx_date: it.date, kind: income ? 'income' : 'expense', amount, pay: 'cash', place: it.label, memo: it.memo, cls: income ? (h ? h.cls : '수입>기타수입') : (onn ? '이체>온누리결제' : cardPay ? '카드대금' : topup ? '이체>선불충전' : (h ? h.cls : '')), tag: h ? h.tag : '', source: 'bank', import_key: keyOf('bn', it.date, amount, it.label, income ? 'i' : 'o'), _cardPay: cardPay, _topup: topup });
      }
    }
  }
  const keys = new Set(state.tx.map(t => t.import_key).filter(Boolean)), multi = {};
  state.tx.forEach(t => { if (t.import_key && /^(cd|bn|nv|pp|cb|lw|lc|op|oc|od)\|/.test(t.import_key)) return; const k = `${t.tx_date}|${t.amount}|${t.kind}`; multi[k] = (multi[k] || 0) + 1; });
  cands.forEach(c => {
    if (keys.has(c.import_key)) { c._dup = true; c._kdup = true; return; }
    const k = `${c.tx_date}|${c.amount}|${c.kind}`; if (!c._needAmt && multi[k] > 0) { multi[k]--; c._dup = true; }
    c._on = !c._dup && !c._needAmt && !(c._cardPay && !imp.incCardPay);
  });
  // 출처가 달라도 같은 지역화폐 결제·충전이면 한 번만 (대전사랑 앱 파일 > 카드 명세서 > 은행 순서로 남김)
  {
    const grpOf = o => {   // pp 대전사랑 결제 / top 대전사랑 충전 / op 온누리 결제 / otop 온누리 충전(액면가)
      const cls = o.cls || ''; if (o.kind !== 'expense') return null;
      if (cls.startsWith('이체>선불충전')) return 'top';
      if (cls.startsWith('이체>온누리충전')) return 'otop';
      if (cls.startsWith('이체')) return null;
      return o.pay === 'prepaid' ? 'pp' : o.pay === 'onnuri' ? 'op' : null;
    };
    const ex = { pp: {}, top: {}, op: {}, otop: {} }, bat = { pp: {}, top: {}, op: {}, otop: {} }, bump = (m, k, d) => { m[k] = (m[k] || 0) + d; };
    state.tx.forEach(t => { const g0 = grpOf(t); if (g0) bump(ex[g0], `${t.tx_date}|${t.amount}`, 1); });
    const pri = c => (c.source === 'localpay' || c.source === 'onnuri') ? 0 : c.source === 'card' ? 1 : c.source === 'bank' ? 2 : 3;
    [...cands].sort((a, b) => pri(a) - pri(b)).forEach(c => {
      const grp = grpOf(c); if (!grp) return;
      const k = `${c.tx_date}|${c.amount}`;
      if (c._kdup) { if (ex[grp][k] > 0) ex[grp][k]--; return; }   // 이미 같은 키로 들어간 행: 기존 기록 몫을 소진
      if (c._dup) return;
      if (ex[grp][k] > 0) { ex[grp][k]--; c._dup = true; c._on = false; return; }
      if (bat[grp][k] && bat[grp][k] !== c.source) { c._dup = true; c._on = false; return; }   // 다른 출처에서 이미 채택된 같은 날짜·금액 (같은 출처끼리의 동일 금액 반복 결제는 유지)
      bat[grp][k] = c.source;
    });
  }
  // 온누리 할인: 은행 '이체>온누리결제'(낸 돈) ↔ '이체>온누리충전'(액면가)을 같은 날짜끼리 짝지어 차액을 '수입>상품권할인'으로.
  // 파일을 올리는 순서와 무관하게, 이번에 올린 후보 + 이미 저장된 기록을 모두 모아서 계산한다.
  {
    const sel = (cls, pred) => [...cands.filter(c => c.kind === 'expense' && (c.cls || '') === cls && !c._dup).map(c => ({ date: c.tx_date, amount: c.amount, isNew: true })),
      ...state.tx.filter(t => t.kind === 'expense' && (t.cls || '').startsWith(cls)).map(t => ({ date: t.tx_date, amount: t.amount, isNew: false }))];
    const paids = sel('이체>온누리결제'), faces = sel('이체>온누리충전');
    const take = (pool, date, amount) => { let i = pool.findIndex(p => p.date === date && p.amount === amount && !p.isNew); if (i < 0) i = pool.findIndex(p => p.date === date && p.amount === amount); if (i >= 0) pool.splice(i, 1); };
    state.tx.forEach(t => {   // 이미 만들어진 할인 행이 쓴 충전/결제 쌍은 다시 짝짓지 않음
      const m = /^od\|([^|]+)\|\d+\|f(\d+)\|p(\d+)\|/.exec(t.import_key || ''); if (!m) return;
      take(faces, m[1], +m[2]); take(paids, m[1], +m[3]);
    });
    for (const date of [...new Set(paids.map(p => p.date))]) {
      const ps = paids.filter(p => p.date === date).sort((a, b) => b.amount - a.amount), fs = faces.filter(f => f.date === date).sort((a, b) => b.amount - a.amount);
      for (const p of ps) {
        const fi = fs.findIndex(f => f.amount >= p.amount && p.amount >= f.amount * 0.5); if (fi < 0) continue;
        const face = fs.splice(fi, 1)[0].amount, diff = face - p.amount; if (diff <= 0) continue;
        const key = keyOf('od', date, diff, 'f' + face, 'p' + p.amount), dup = keys.has(key);
        cands.push({ tx_date: date, kind: 'income', amount: diff, pay: 'onnuri', place: '온누리상품권 할인', memo: '', cls: '수입>상품권할인', tag: '', source: 'onnuri', import_key: key, _dup: dup, _on: !dup });
      }
    }
  }
  cands.forEach(c => { const ed = imp.ed[c.import_key]; if (!ed) return; if ('cls' in ed) c.cls = ed.cls; if (ed.amount > 0 && c._needAmt) { c.amount = ed.amount; c._needAmt = false; if (!c._dup) c._on = true; } if ('on' in ed && !c._dup && !c._needAmt) c._on = ed.on; });   // 사용자가 바꾼 값 유지
  cands.forEach(c => { c._unc0 = c.kind === 'expense' && !c.cls && !c._cardPay && !c._topup; });   // 목록을 (다시) 만들 때만 계산 → 분류를 고르는 동안 행 순서는 고정
  cands.sort((a, b) => a.tx_date < b.tx_date ? -1 : a.tx_date > b.tx_date ? 1 : 0);
  imp.cands = cands;
  // 다른 파일에서 이미 저장된 원거래의 취소: 저장된 내역에서 찾아 삭제(또는 부분취소면 금액 수정) 계획
  const cd = [], used = new Set(), off = imp.cancelOff ??= {};
  for (const f of imp.files) for (const cn of (f.type === 'card' && f.openCancels) || []) {
    let ms = cn.approval ? state.tx.filter(t => t.source === 'card' && t.pay === 'card' && (t.import_key || '').includes(`|ap${cn.approval}|`) && !used.has(t.id)) : [];
    if (!ms.length && !cn.approval) { const t = state.tx.find(t => t.source === 'card' && t.pay === 'card' && t.place === cn.name && t.amount === cn.amount && t.tx_date <= cn.date && !used.has(t.id)); if (t) ms = [t]; }
    if (!ms.length) continue;
    const sum = ms.reduce((s, t) => s + t.amount, 0);
    if (cn.amount >= sum) ms.forEach(t => { used.add(t.id); cd.push({ id: t.id, tx_date: t.tx_date, place: t.place, amount: t.amount, cancelDate: cn.date, on: !off[t.id] }); });
    else if (ms.length === 1) { used.add(ms[0].id); cd.push({ id: ms[0].id, tx_date: ms[0].tx_date, place: ms[0].place, amount: ms[0].amount, newAmount: ms[0].amount - cn.amount, cancelDate: cn.date, on: !off[ms[0].id] }); }
  }
  imp.cancelDel = cd;
}

function renderImport() {
  const imp = state.imp, c = imp.cands, fresh = c.filter(x => !x._dup), on = c.filter(x => x._on);
  const cards = imp.files.filter(f => f.type === 'card'), banks = imp.files.filter(f => f.type === 'bank'), ledgers = imp.files.filter(f => f.type === 'ledger'), lps = imp.files.filter(f => f.type === 'localpay');
  const newRules = impNewRules(), nPayRec = banks.length ? Object.keys(payRecordsFromBank(banks)).length : 0, lastBal = banks.length ? bankDailyBals(banks).pop() : null;
  const cancelled = cards.reduce((s, f) => s + f.cancelled, 0), dup = c.filter(x => x._dup).length, cardPay = c.filter(x => x._cardPay && !x._dup).length;
  const unc = on.filter(x => x.kind === 'expense' && !x.cls).length, sumOut = on.filter(x => x.kind === 'expense' && x.cls.split('>')[0] !== '카드대금').reduce((s, x) => s + x.amount, 0), sumIn = on.filter(x => x.kind === 'income').reduce((s, x) => s + x.amount, 0);
  const catOpts = sel => ['', ...allCats()].map(x => `<option value="${esc(x)}" ${x === sel ? 'selected' : ''}>${x || '미분류'}</option>`).join('');
  const incOpts = sel => INCOME_CATS.map(x => `<option ${x === sel ? 'selected' : ''}>${x}</option>`).join('');
  const impCats = allCats();
  const subLists = impCats.map((cat, ci) => { const subs = [...new Set([...subsOf(cat), ...Object.keys(state.rules).filter(k => k.startsWith(cat + '>')).map(k => k.slice(cat.length + 1))])].filter(Boolean); return `<datalist id="subs-${ci}">${subs.map(s => `<option value="${esc(s)}">`).join('')}</datalist>`; }).join('');
  const cdel = imp.cancelDel || [], nCan = cdel.filter(x => x.on).length;
  const needAmt = fresh.filter(x => x._needAmt).length, ons = imp.files.filter(f => f.type === 'onnuripay' || f.type === 'onnuricharge');
  const rowOf = x => { const i = c.indexOf(x); return `<tr><td><input type="checkbox" data-imp="chk" data-i="${i}" ${x._on ? 'checked' : ''} ${x._needAmt ? 'disabled' : ''} style="width:auto"></td>
    <td style="white-space:nowrap">${x.tx_date.slice(2).replace(/-/g, '.')}</td><td style="text-align:left">${x._unc0 && x.cls ? '<span style="color:var(--ok)">✓ </span>' : ''}${esc(x.place)}${x._cardPay ? ' <span class="tag na">카드대금</span>' : ''}${x._topup ? ' <span class="tag na">충전</span>' : ''}${x.cls === '수입>캐시백' ? ' <span class="tag na">캐시백 적립</span>' : x.cls === '이체>캐시백사용' ? ' <span class="tag na">캐시백 사용</span>' : ''}<div class="note" style="margin:0">${['card', 'prepaid', 'onnuri'].includes(x.pay) ? payLabel(x.pay) : (x.source === 'card' ? '체크카드' : '계좌')}${x.tag ? ' · ' + esc(x.tag) : ''}</div></td>
    <td class="${x.kind === 'income' ? 'pos' : ''}" style="white-space:nowrap">${x._needAmt ? `<input data-imp="amt" data-i="${i}" inputmode="numeric" placeholder="원화 금액" style="width:110px;font-size:13px;padding:4px">` : `${x.kind === 'income' ? '+' : '−'}${Math.round(x.amount).toLocaleString('ko-KR')}`}</td>
    <td>${x._cardPay ? '' : (x.cls.startsWith('이체') || x.cls === '수입>캐시백' || x.cls === '수입>상품권할인') ? `<span class="note" style="margin:0">${esc(x.cls.replace('>', ' › '))}</span>` : x.kind === 'income' ? `<select data-imp="cat" data-i="${i}" style="width:auto;font-size:13px;padding:4px">${incOpts(x.cls.split('>')[1])}</select>` : `<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end"><select data-imp="cat" data-i="${i}" style="width:auto;font-size:13px;padding:4px">${catOpts(x.cls ? catOf(x) : '')}</select><input data-imp="sub" data-i="${i}" ${x.cls && impCats.includes(catOf(x)) ? `list="subs-${impCats.indexOf(catOf(x))}"` : ''} placeholder="소분류" value="${esc(x.cls ? subOf(x) : '')}" ${x.cls ? '' : 'disabled'} autocomplete="off" style="width:110px;font-size:13px;padding:4px"></div>`}</td></tr>`; };
  const grpA = fresh.filter(x => x._unc0), grpB = fresh.filter(x => !x._unc0), nUnc = grpA.filter(x => !x.cls).length;
  const rows = (grpA.length ? `<tr><td colspan="5" style="text-align:left;font-size:12px;color:var(${nUnc ? '--warn' : '--ok'});padding-top:10px">${nUnc ? `미분류 ${nUnc}건 — 분류를 골라주세요 (위쪽)` : '미분류 정리 완료 ✓'}</td></tr>` + grpA.map(rowOf).join('') : '')
    + (grpA.length && grpB.length ? '<tr><td colspan="5" style="text-align:left;font-size:12px;color:var(--sub);padding-top:10px">분류된 내역</td></tr>' : '') + grpB.map(rowOf).join('');
  $('#modal .sheet').innerHTML = `${subLists}<h2 style="margin:0 0 6px;font-size:16px">엑셀 올리기</h2>
    <div class="note" style="margin:0 0 10px">카드 이용내역, 은행 거래내역, 지출점검시트(원본데이터)·네이버가계부 내려받기 파일을 한 번에 여러 개 올릴 수 있어요.</div>
    <input type="file" id="impFile" accept=".xls,.xlsx" multiple>
    ${imp.asset ? `<div class="banner ok" style="margin-top:12px">자산관리시트 ${esc(imp.asset.file_name)} — 월별기록 기준 ${assetLatestLabel(imp.asset)} · 저장하면 '자산' 탭에 반영됩니다</div>` : ''}
    ${imp.files.length ? `<div class="banner ${fresh.length ? 'ok' : 'warn'}" style="margin-top:12px">
      ${cards.length ? `카드 ${cards.reduce((s, f) => s + f.items.length, 0)}건${cancelled ? ` (취소 ${cancelled}건 제외)` : ''}` : ''}${cards.length && banks.length ? ' · ' : ''}${banks.length ? `은행 ${banks.reduce((s, f) => s + f.items.length, 0)}건` : ''}${(cards.length || banks.length) && ledgers.length ? ' · ' : ''}${ledgers.length ? `가계부 ${ledgers.reduce((s, f) => s + f.items.length, 0)}건` : ''}${(cards.length || banks.length || ledgers.length) && lps.length ? ' · ' : ''}${lps.map(f => { const nk = f.items.length - f.unknown, wal = f.items.some(it => it.kind === '결제' || it.kind === '충전'); return `대전사랑 ${wal ? '결제/충전' : '캐시백'} ${nk}건${f.cancelled ? ` (취소 ${f.cancelled}쌍 제외)` : ''}${(() => { const mv = f.items.filter(it => it.kind === '잔액이동').length, other = f.unknown - mv; return (mv ? ` · 잔액이동 ${mv}건 제외 (카드 교체 때 잔액 옮김 — 분석 탭에 현재 잔액을 한 번 입력하세요)` : '') + (other > 0 ? ` · 알 수 없는 유형 ${other}건 제외` : ''); })()}`; }).join(' · ')}
      ${ons.length ? `${(cards.length || banks.length || ledgers.length || lps.length) ? ' · ' : ''}${ons.map(f => `온누리 ${f.type === 'onnuripay' ? '결제' : '충전'} ${f.items.length}건${f.cancelled ? ` (취소 ${f.cancelled}쌍 제외)` : ''}`).join(' · ')}` : ''}
      → 새 내역 <b>${fresh.length}건</b> · 이미 있어서 건너뜀 <b>${dup}건</b>${cardPay ? ` · 카드대금 ${cardPay}건` : ''}${nPayRec ? ` · 카드 결제 확정 기록 ${nPayRec}건` : ''}${lastBal ? ` · 통장 잔액 ${lastBal.date.slice(5).replace('-', '.')} ${won(lastBal.balance)}` : ''}${newRules.length ? ` · 분류 규칙 ${newRules.length}개 추가 예정` : ''}</div>
      ${imp.files.map((f, fi) => f.type === 'card' ? `<div class="note">${esc(f.fname)} — 결제수단: <select data-imp="fpay" data-f="${fi}" style="width:auto;font-size:13px;padding:4px"><option value="card" ${f.payAs === 'prepaid' ? '' : 'selected'}>신용카드</option><option value="prepaid" ${f.payAs === 'prepaid' ? 'selected' : ''}>대전사랑카드</option></select></div>` : '').join('')}
      <div class="row2" style="margin-top:10px">${cards.length ? `<div><label class="f">할부 처리</label><select data-imp="mode"><option value="split" ${imp.mode === 'split' ? 'selected' : ''}>월별로 나누기 (기존 방식)</option><option value="full" ${imp.mode === 'full' ? 'selected' : ''}>한 번에 전액</option></select></div>` : ''}
      ${banks.length ? `<div><label class="f">은행의 카드대금 출금</label><select data-imp="cardpay"><option value="0" ${imp.incCardPay ? '' : 'selected'}>제외 (카드 내역과 중복)</option><option value="1" ${imp.incCardPay ? 'selected' : ''}>포함</option></select></div>` : ''}</div>
      ${needAmt ? `<div class="note"><b>해외 결제 ${needAmt}건은 원화 청구 금액을 입력해야 가져올 수 있어요 (카드 명세서 참고).</b></div>` : ''}
      ${cdel.length ? `<div class="banner warn" style="margin-top:8px"><b>취소된 결제 ${cdel.length}건</b> — 저장하면 기존 내역에서 ${cdel.some(x => x.newAmount) ? '지우거나 금액을 고쳐요' : '지워요'} (체크를 풀면 그대로 둠)${cdel.map((x, i) => `<label style="display:flex;gap:6px;align-items:center;font-size:13px;margin-top:4px"><input type="checkbox" data-imp="cdel" data-i="${i}" ${x.on ? 'checked' : ''} style="width:auto"><span>${x.tx_date.slice(5).replace('-', '.')} ${esc(x.place)} ${won(x.amount)}(${x.cancelDate.slice(5).replace('-', '.')} 취소${x.newAmount ? ` · 금액 수정 → ${won(x.newAmount)}` : ''})</span></label>`).join('')}</div>` : ''}
      ${newRules.length ? `<div class="note">추가될 규칙: ${newRules.map(r => `${esc(r.key)} → ${esc(r.nature)}`).join(', ')}</div>` : ''}
      <div class="note">체크를 풀면 가져오지 않습니다. 분류는 파일에 적힌 값을 쓰고, 비어 있으면 같은 사용처를 전에 분류한 대로 채웠어요. 처음 보는 곳은 '미분류'예요.${nUnc ? ` <b>미분류 ${nUnc}건</b>` : ''}</div>
      <div style="overflow-x:auto;margin-top:8px"><table><tr><th></th><th>날짜</th><th style="text-align:left">사용처</th><th>금액</th><th>분류</th></tr>${rows || '<tr><td colspan="5" class="note">새로 가져올 내역이 없습니다.</td></tr>'}</table></div>
      <div class="note" style="margin-top:8px">선택 ${on.length}건 · 지출 ${won(sumOut)} · 수입 ${won(sumIn)}</div>
      ` : ''}
    ${(imp.files.length || imp.asset) ? `<button class="btn" data-act="impGo" ${(on.length || imp.asset || nPayRec || lastBal || nCan) ? '' : 'disabled style="opacity:.5"'}>${imp.asset ? (on.length ? `자산 저장 + ${on.length}건 가져오기` : '자산 데이터 저장') : (!on.length && (nPayRec || lastBal) ? '카드 결제·통장 잔액 기록 저장' : !on.length && nCan ? '취소 반영' : `${on.length}건 가져오기`)}</button>` : ''}
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
            if (key && NATURES.includes(nature)) ruleMap.set(normCls(key), nature);
          }
        }
      }
      let res = null;
      const names = [...wb.SheetNames.filter(n => n.includes('원본데이터')), ...wb.SheetNames.filter(n => !n.includes('원본데이터'))];
      for (const sn of names) { res = detectAndParse(XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' }), f.name); if (res) break; }
      if (!res) throw new Error(`${f.name}: 카드 이용내역('이용일'), 은행 거래내역('거래일시'), 가계부/지출점검시트('날짜·사용처·현금·카드'), 자산관리시트('월별기록·대시보드' 시트) 형식이 아닙니다`);
      if (res.type === 'card') res.payAs = /대전사랑|지역화폐|지역사랑/.test(f.name) ? 'prepaid' : 'card';
      parsed.push(res);
    }
    state.imp.files = parsed; state.imp.rules = [...ruleMap].map(([key, nature]) => ({ key, nature })); buildCands(); renderImport();
  });
}
const impNewRules = () => (state.imp.rules || []).filter(r => !(r.key in state.rules));
handlers.openImport = () => { state.imp = { files: [], mode: 'split', incCardPay: false, cands: [], ed: {}, rules: [], asset: null }; openModal(''); renderImport(); };
handlers.impGo = () => run(async () => {
  const rows = state.imp.cands.filter(x => x._on && x.amount > 0).map(({ _dup, _on, _cardPay, _needAmt, _topup, _kdup, _unc0, _onnuriFace, ...r }) => r);
  const bankFiles = state.imp.files.filter(f => f.type === 'bank'), recs = payRecordsFromBank(bankFiles), nRec = Object.keys(recs).length, dBals = bankDailyBals(bankFiles);
  const cdo = (state.imp.cancelDel || []).filter(x => x.on);
  if (!rows.length && !state.imp.asset && !nRec && !dBals.length && !cdo.length) return;
  const parts = [];
  if (cdo.length) {   // 취소된 결제: 기존 내역 삭제 (부분취소는 금액 수정)
    for (const x of cdo) { if (x.newAmount) await backend.updateTx(x.id, { amount: x.newAmount }); else await backend.deleteTx(x.id); }
    const all = await backend.loadAll(); state.tx = all.tx; state.asset = all.asset || state.asset; state.assetErr = all.assetErr || ''; prep();
    parts.push(`취소 반영 ${cdo.length}건`);
  }
  if (nRec || dBals.length) {   // 확정 기록 + 은행 잔액(날짜별 마지막 거래 후 잔액)을 설정에 저장
    const nd = new Set(dBals.map(b => b.date)), bankAuto = [...(state.settings.bankAuto || []).filter(b => !nd.has(b.date)), ...dBals].sort((a, b) => a.date < b.date ? -1 : 1).slice(-400);
    const merged = { ...state.settings, payRecords: { ...(state.settings.payRecords || {}), ...recs }, bankAuto };
    await backend.saveSettings(merged); state.settings = { ...DEFAULT_SETTINGS, ...merged };
    if (nRec) parts.push(`카드 결제 확정 기록 ${nRec}건`); if (dBals.length) parts.push(`통장 잔액 ${dBals[dBals.length - 1].date.slice(5).replace('-', '.')}까지`);
  }
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
  else if (k === 'cat') {
    const x = c[i];
    if (x.kind === 'income') x.cls = '수입>' + el.value;
    else if (!el.value) x.cls = '';
    else if (el.value === catOf(x) && x.cls) { /* 같은 대분류: 기존 분류 유지 */ }
    else x.cls = el.value + (impSuggestSub(x.place, el.value) ? '>' + impSuggestSub(x.place, el.value) : '');   // 대분류가 바뀌면 같은 사용처의 전 소분류를 제안, 없으면 비움
    ed(x).cls = x.cls; delete ed(x).prop; impPropagate(x); renderImportKeepScroll();
  }
  else if (k === 'sub') {
    const x = c[i]; if (!x.cls || x.kind === 'income') return;
    const sub = el.value.replace(/>/g, '').trim();
    x.cls = catOf(x) + (sub ? '>' + sub : '');
    ed(x).cls = x.cls; delete ed(x).prop; impPropagate(x); renderImportKeepScroll();
  }
  else if (k === 'cdel') { const x = state.imp.cancelDel[i]; if (x) { x.on = el.checked; (state.imp.cancelOff ??= {})[x.id] = !el.checked; renderImportKeepScroll(); } }
  else if (k === 'mode') { state.imp.mode = el.value; buildCands(); renderImport(); }
  else if (k === 'amt') { const v = parseInt(el.value.replace(/\D/g, ''), 10) || 0; if (v > 0) { c[i].amount = v; c[i]._needAmt = false; c[i]._on = true; ed(c[i]).amount = v; ed(c[i]).on = true; renderImportKeepScroll(); } }
  else if (k === 'fpay') { state.imp.files[+el.dataset.f].payAs = el.value; buildCands(); renderImport(); }
  else if (k === 'cardpay') { state.imp.incCardPay = el.value === '1'; c.forEach(x => { if (x._cardPay && !x._dup) x._on = state.imp.incCardPay; }); renderImport(); }
});
function impSuggestSub(place, cat) {   // 같은 사용처(정규화)로 같은 대분류에 전에 쓴 소분류 중 가장 최근 것
  const cp = canonPlace(place); if (!cp) return '';
  const t = state.tx.find(t => t.kind === 'expense' && catOf(t) === cat && subOf(t) && canonPlace(t.place) === cp);
  return t ? subOf(t) : '';
}
function impPropagate(x) {   // 같은 사용처의 다른 새 내역(사용자가 직접 바꾸지 않은 것)에 같은 분류 적용
  const cp = canonPlace(x.place); if (!cp) return;
  state.imp.cands.forEach(o => {
    if (o === x || o._dup || o.kind !== 'expense' || o._cardPay || o._topup) return;
    if ((o.cls || '').startsWith('이체') || o.cls === '카드대금') return;
    const e = state.imp.ed[o.import_key]; if (e && 'cls' in e && !e.prop) return;   // 직접 고친 행은 건드리지 않음
    if (canonPlace(o.place) !== cp) return;
    o.cls = x.cls; (state.imp.ed[o.import_key] ??= {}).cls = x.cls; state.imp.ed[o.import_key].prop = true;
  });
}
function renderImportKeepScroll() { const s = $('#modal .sheet'), y = s.scrollTop; renderImport(); $('#modal .sheet').scrollTop = y; }

// ---------- ⓘ 툴팁 (본문 밖 fixed 박스라 스크롤 영역에 잘리지 않음) ----------
const tipEl = () => { let b = $('#tipFloat'); if (!b) { b = document.createElement('div'); b.id = 'tipFloat'; document.body.appendChild(b); } return b; };
function tipPlace(t) {
  const b = tipEl(), r = t.getBoundingClientRect(); b.textContent = t.querySelector('.tipbox').textContent; b.classList.add('on');
  const w = b.offsetWidth, h = b.offsetHeight; let y = r.bottom + 6; if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
  b.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + 'px'; b.style.top = y + 'px';
}
function tipHide(all) { const b = $('#tipFloat'); if (b) b.classList.remove('on'); if (all) document.querySelectorAll('.tip.open').forEach(x => x.classList.remove('open')); }
document.addEventListener('click', e => {   // 캡처 단계: ⓘ를 누르면 행·월 선택 등 다른 클릭 처리로 넘어가지 않게 막는다
  const t = e.target.closest && e.target.closest('.tip');
  if (!t) { tipHide(true); return; }
  e.stopPropagation(); const was = t.classList.contains('open'); tipHide(true); if (!was) { t.classList.add('open'); tipPlace(t); }
}, true);
document.addEventListener('mouseover', e => { const t = e.target.closest && e.target.closest('.tip'); if (t && !t.classList.contains('open')) tipPlace(t); });
document.addEventListener('mouseout', e => { const t = e.target.closest && e.target.closest('.tip'); if (t && !t.classList.contains('open') && !t.contains(e.relatedTarget)) tipHide(false); });
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('tip')) { e.preventDefault(); e.target.click(); } });
window.addEventListener('scroll', () => tipHide(true), true);

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
