const STORAGE_KEY = 'expiry_inventory_app_v1';

const DAY_MS = 24 * 60 * 60 * 1000;

const commonCatalog = [
  { itemName: '營養品', category: '食品', safetyStock: 10, location: '庫房 A', barcode: '4710000000011' },
  { itemName: '口罩', category: '醫材', safetyStock: 20, location: '庫房 B', barcode: '4710000000028' },
  { itemName: '酒精棉片', category: '醫材', safetyStock: 12, location: '護理站', barcode: '4710000000035' },
  { itemName: '清潔手套', category: '清潔用品', safetyStock: 8, location: '庫房 C', barcode: '4710000000042' },
  { itemName: '影印紙', category: '行政用品', safetyStock: 5, location: '辦公室', barcode: '4710000000059' },
];

const demoState = {
  batches: [
    {
      id: 'b-001',
      itemName: '營養品',
      category: '食品',
      quantity: 12,
      safetyStock: 10,
      expiryDate: '2026-05-28',
      location: '庫房 A',
      receivedAt: '2026-05-02',
    },
    {
      id: 'b-002',
      itemName: '口罩',
      category: '醫材',
      quantity: 50,
      safetyStock: 20,
      expiryDate: '2026-08-30',
      location: '庫房 B',
      receivedAt: '2026-05-02',
    },
    {
      id: 'b-003',
      itemName: '酒精棉片',
      category: '醫材',
      quantity: 8,
      safetyStock: 12,
      expiryDate: '2026-05-12',
      location: '護理站',
      receivedAt: '2026-05-02',
    },
    {
      id: 'b-004',
      itemName: '清潔手套',
      category: '清潔用品',
      quantity: 4,
      safetyStock: 8,
      expiryDate: '2027-02-01',
      location: '庫房 C',
      receivedAt: '2026-05-02',
    },
  ],
  movements: [
    {
      id: 'm-001',
      type: '進貨',
      itemName: '營養品',
      quantity: 12,
      reason: '示範資料',
      createdAt: new Date('2026-05-02T09:00:00').toISOString(),
    },
  ],
};

let state = loadState();
let activeFilter = 'all';
let scannerStream = null;
let scannerTimer = null;
let speechRecognition = null;

const els = {
  receiveForm: document.getElementById('receiveForm'),
  issueForm: document.getElementById('issueForm'),
  stockTable: document.getElementById('stockTable'),
  batchList: document.getElementById('batchList'),
  movementList: document.getElementById('movementList'),
  issueItem: document.getElementById('issueItem'),
  itemNames: document.getElementById('itemNames'),
  toast: document.getElementById('toast'),
  totalItems: document.getElementById('totalItems'),
  totalUnits: document.getElementById('totalUnits'),
  soonCount: document.getElementById('soonCount'),
  expiredCount: document.getElementById('expiredCount'),
  lowCount: document.getElementById('lowCount'),
  batchCount: document.getElementById('batchCount'),
  quickItemSelect: document.getElementById('quickItemSelect'),
  quickInputHint: document.getElementById('quickInputHint'),
  repeatLastBtn: document.getElementById('repeatLastBtn'),
  scanCodeBtn: document.getElementById('scanCodeBtn'),
  voiceInputBtn: document.getElementById('voiceInputBtn'),
  barcodePanel: document.getElementById('barcodePanel'),
  barcodeVideo: document.getElementById('barcodeVideo'),
  barcodeManual: document.getElementById('barcodeManual'),
};

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return structuredClone(demoState);

  try {
    const parsed = JSON.parse(saved);
    return {
      batches: Array.isArray(parsed.batches) ? parsed.batches : [],
      movements: Array.isArray(parsed.movements) ? parsed.movements : [],
    };
  } catch {
    return structuredClone(demoState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function daysUntil(dateValue) {
  const today = new Date(todayISO());
  const expiry = new Date(dateValue);
  return Math.ceil((expiry - today) / DAY_MS);
}

function itemKey(batch) {
  return batch.itemName;
}

function getGroups() {
  const map = new Map();

  state.batches
    .filter(batch => batch.quantity > 0)
    .forEach(batch => {
      const key = itemKey(batch);
      const existing = map.get(key) || {
        itemName: batch.itemName,
        category: batch.category,
        quantity: 0,
        safetyStock: Number(batch.safetyStock || 0),
        earliestExpiry: batch.expiryDate,
        locations: new Set(),
        batches: [],
      };

      existing.quantity += Number(batch.quantity);
      existing.safetyStock = Math.max(existing.safetyStock, Number(batch.safetyStock || 0));
      existing.earliestExpiry = [existing.earliestExpiry, batch.expiryDate].sort()[0];
      existing.locations.add(batch.location);
      existing.batches.push(batch);
      map.set(key, existing);
    });

  return [...map.values()].sort((a, b) => a.earliestExpiry.localeCompare(b.earliestExpiry));
}

function getStatus(group) {
  const dayCount = daysUntil(group.earliestExpiry);
  if (dayCount < 0) return { label: '已過期', className: 'expired' };
  if (group.quantity <= group.safetyStock) return { label: '低庫存', className: 'low' };
  if (dayCount <= 30) return { label: '即將到期', className: 'soon' };
  return { label: '正常', className: 'ok' };
}

function formatDate(dateValue) {
  if (!dateValue) return '-';
  return dateValue.replaceAll('-', '/');
}

function renderSummary(groups) {
  const allBatches = state.batches.filter(batch => batch.quantity > 0);
  const totalQty = groups.reduce((sum, group) => sum + group.quantity, 0);
  const soon = allBatches.filter(batch => daysUntil(batch.expiryDate) >= 0 && daysUntil(batch.expiryDate) <= 30).length;
  const expired = allBatches.filter(batch => daysUntil(batch.expiryDate) < 0).length;
  const low = groups.filter(group => group.quantity <= group.safetyStock).length;

  els.totalItems.textContent = groups.length;
  els.totalUnits.textContent = `總數量 ${totalQty}`;
  els.soonCount.textContent = soon;
  els.expiredCount.textContent = expired;
  els.lowCount.textContent = low;
}

function filterGroups(groups) {
  if (activeFilter === 'soon') {
    return groups.filter(group => {
      const dayCount = daysUntil(group.earliestExpiry);
      return dayCount >= 0 && dayCount <= 30;
    });
  }
  if (activeFilter === 'expired') {
    return groups.filter(group => daysUntil(group.earliestExpiry) < 0);
  }
  if (activeFilter === 'low') {
    return groups.filter(group => group.quantity <= group.safetyStock);
  }
  return groups;
}

function renderStockTable(groups) {
  const filtered = filterGroups(groups);
  if (filtered.length === 0) {
    els.stockTable.innerHTML = `<tr><td colspan="5"><div class="empty-state">目前沒有符合條件的庫存。</div></td></tr>`;
    return;
  }

  els.stockTable.innerHTML = filtered.map(group => {
    const status = getStatus(group);
    const dayCount = daysUntil(group.earliestExpiry);
    const dueText = dayCount < 0 ? `過期 ${Math.abs(dayCount)} 天` : `${dayCount} 天後`;
    return `
      <tr>
        <td><strong>${escapeHtml(group.itemName)}</strong><small>${escapeHtml(group.category)} · ${group.batches.length} 筆效期</small></td>
        <td><strong>${group.quantity}</strong><small>安全量 ${group.safetyStock}</small></td>
        <td><strong>${formatDate(group.earliestExpiry)}</strong><small>${dueText}</small></td>
        <td>${[...group.locations].map(escapeHtml).join('、')}</td>
        <td><span class="status ${status.className}">${status.label}</span></td>
      </tr>
    `;
  }).join('');
}

function renderBatchList() {
  const batches = state.batches
    .filter(batch => batch.quantity > 0)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  els.batchCount.textContent = `${batches.length} 筆`;

  if (batches.length === 0) {
    els.batchList.innerHTML = '<div class="empty-state">尚未建立效期庫存。</div>';
    return;
  }

  els.batchList.innerHTML = batches.map(batch => {
    const dayCount = daysUntil(batch.expiryDate);
    const statusClass = dayCount < 0 ? 'expired' : dayCount <= 30 ? 'soon' : 'ok';
    const statusText = dayCount < 0 ? '過期' : dayCount <= 30 ? '即期' : '正常';
    return `
      <article class="batch-row">
        <div>
          <h3>${escapeHtml(batch.itemName)}</h3>
          <div class="batch-meta">${escapeHtml(batch.location)} · ${formatDate(batch.expiryDate)} · ${escapeHtml(batch.category)}</div>
        </div>
        <div>
          <div class="batch-qty">${batch.quantity}</div>
          <span class="status ${statusClass}">${statusText}</span>
        </div>
      </article>
    `;
  }).join('');
}

function renderMovements() {
  const movements = [...state.movements]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 12);

  if (movements.length === 0) {
    els.movementList.innerHTML = '<div class="empty-state">尚無異動紀錄。</div>';
    return;
  }

  els.movementList.innerHTML = movements.map(move => `
    <article class="movement-row">
      <h3>${escapeHtml(move.type)} · ${escapeHtml(move.itemName)}</h3>
      <p>數量 ${move.quantity}${move.reason ? ` · ${escapeHtml(move.reason)}` : ''}</p>
      <p>${new Date(move.createdAt).toLocaleString('zh-TW', { hour12: false })}</p>
    </article>
  `).join('');
}

function renderSelectors(groups) {
  els.issueItem.innerHTML = groups.length
    ? groups.map(group => `<option value="${escapeHtml(group.itemName)}">${escapeHtml(group.itemName)} · ${group.quantity}</option>`).join('')
    : '<option value="">目前沒有可領用庫存</option>';

  els.itemNames.innerHTML = groups
    .map(group => `<option value="${escapeHtml(group.itemName)}"></option>`)
    .join('');

  renderQuickItems();
}

function render() {
  const groups = getGroups();
  renderSummary(groups);
  renderStockTable(groups);
  renderBatchList();
  renderMovements();
  renderSelectors(groups);
}

function addMovement(move) {
  state.movements.push({
    id: makeId('m'),
    createdAt: new Date().toISOString(),
    ...move,
  });
}

function getCommonItems() {
  const map = new Map(commonCatalog.map(item => [item.itemName, { ...item }]));

  state.batches.forEach(batch => {
    if (!map.has(batch.itemName)) {
      map.set(batch.itemName, {
        itemName: batch.itemName,
        category: batch.category,
        safetyStock: Number(batch.safetyStock || 0),
        location: batch.location,
        barcode: '',
      });
      return;
    }

    const item = map.get(batch.itemName);
    item.category = batch.category || item.category;
    item.safetyStock = Math.max(Number(item.safetyStock || 0), Number(batch.safetyStock || 0));
    item.location = batch.location || item.location;
  });

  return [...map.values()].sort((a, b) => a.itemName.localeCompare(b.itemName, 'zh-TW'));
}

function renderQuickItems() {
  const items = getCommonItems();
  els.quickItemSelect.innerHTML = [
    '<option value="">選擇後自動帶入</option>',
    ...items.map(item => `<option value="${escapeHtml(item.itemName)}">${escapeHtml(item.itemName)} · ${escapeHtml(item.location)}</option>`),
  ].join('');
}

function setField(id, value) {
  const field = document.getElementById(id);
  if (field && value !== undefined && value !== null && value !== '') {
    field.value = value;
  }
}

function applyItemTemplate(item, options = {}) {
  if (!item) return;
  setField('itemName', item.itemName);
  setField('category', item.category);
  setField('safetyStock', Number(item.safetyStock || 0));
  setField('location', item.location);

  if (options.quantity !== undefined) setField('quantity', options.quantity);
  if (options.expiryDate) setField('expiryDate', options.expiryDate);
}

function applyQuickItem(itemName) {
  const item = getCommonItems().find(entry => entry.itemName === itemName);
  applyItemTemplate(item);
  showToast(item ? `已帶入 ${item.itemName}` : '找不到常用品項');
}

function repeatLastReceive() {
  const lastBatch = [...state.batches].reverse().find(batch => batch.itemName);
  if (!lastBatch) {
    showToast('目前沒有可重複的進貨紀錄');
    return;
  }

  applyItemTemplate(lastBatch, { quantity: lastBatch.quantity });
  document.getElementById('expiryDate').value = '';
  document.getElementById('quantity').focus();
  showToast(`已複製 ${lastBatch.itemName}，請確認數量與效期`);
}

function addDaysISO(dayCount) {
  const date = new Date(todayISO());
  date.setDate(date.getDate() + dayCount);
  return date.toISOString().slice(0, 10);
}

function monthEndISO() {
  const today = new Date(todayISO());
  const date = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

function setExpiryShortcut(shortcut) {
  const value = shortcut === 'month-end' ? monthEndISO() : addDaysISO(Number(shortcut));
  document.getElementById('expiryDate').value = value;
  showToast(`效期已設為 ${formatDate(value)}`);
}

function normalizeExpiryDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return parseDateText(text);
}

function parseDateText(text) {
  const year = new Date().getFullYear();
  const numeric = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (numeric) return toDateValue(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]));

  const monthDay = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|號)?/);
  if (monthDay) return toDateValue(year, Number(monthDay[1]), Number(monthDay[2]));

  const compact = text.match(/\b(\d{2})(\d{2})\b/);
  if (compact) return toDateValue(year, Number(compact[1]), Number(compact[2]));

  return '';
}

function toDateValue(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return Number.isNaN(new Date(value).getTime()) ? '' : value;
}

function parseBarcodePayload(payload) {
  const text = String(payload || '').trim();
  if (!text) return null;

  const byBarcode = getCommonItems().find(item => item.barcode && item.barcode === text);
  if (byBarcode) return byBarcode;

  try {
    const parsed = JSON.parse(text);
    return normalizeTemplate(parsed);
  } catch {
    // Continue with text parsing.
  }

  const pairs = Object.fromEntries(
    text
      .split(/[;,，\n]/)
      .map(part => part.split(/[:=：]/).map(value => value.trim()))
      .filter(pair => pair.length === 2 && pair[0])
  );

  if (Object.keys(pairs).length) return normalizeTemplate(pairs);

  return getCommonItems().find(item => text.includes(item.itemName)) || { itemName: text };
}

function normalizeTemplate(source) {
  if (!source || typeof source !== 'object') return null;
  return {
    itemName: source.itemName || source.name || source.item || source['品項'] || source['品名'],
    category: source.category || source['類別'],
    quantity: source.quantity || source.qty || source['數量'],
    safetyStock: source.safetyStock || source.safety || source['安全庫存'],
    expiryDate: source.expiryDate || source.expiry || source['效期'] || source['有效期限'],
    location: source.location || source.place || source['位置'],
  };
}

function applyBarcodeText(text) {
  const parsed = parseBarcodePayload(text);
  if (!parsed || !parsed.itemName) {
    showToast('無法辨識條碼內容');
    return;
  }

  const knownItem = getCommonItems().find(item => item.itemName === parsed.itemName);
  const expiryDate = normalizeExpiryDate(parsed.expiryDate) || parseDateText(String(text));
  applyItemTemplate({ ...knownItem, ...parsed }, {
    quantity: Number(parsed.quantity || 0) || undefined,
    expiryDate,
  });
  showToast(`已套用 ${parsed.itemName}`);
}

async function startScanner() {
  if (!els.barcodePanel.hidden) {
    stopScanner();
    showToast('已關閉掃碼');
    return;
  }

  els.barcodePanel.hidden = false;
  els.barcodeManual.focus();

  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    showToast('此瀏覽器不支援直接掃碼，可手動輸入條碼');
    return;
  }

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    els.barcodeVideo.srcObject = scannerStream;
    await els.barcodeVideo.play();
    const detector = new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39'] });
    scannerTimer = window.setInterval(async () => {
      if (!els.barcodeVideo.videoWidth) return;
      try {
        const codes = await detector.detect(els.barcodeVideo);
        if (!codes.length) return;
        applyBarcodeText(codes[0].rawValue);
        stopScanner();
      } catch {
        stopScanner();
        showToast('掃碼中斷，請改用手動輸入');
      }
    }, 650);
    showToast('請把條碼或 QR Code 對準鏡頭');
  } catch {
    showToast('無法開啟鏡頭，可手動輸入條碼');
  }
}

function stopScanner() {
  if (scannerTimer) window.clearInterval(scannerTimer);
  scannerTimer = null;
  if (scannerStream) {
    scannerStream.getTracks().forEach(track => track.stop());
  }
  scannerStream = null;
  els.barcodeVideo.srcObject = null;
  els.barcodePanel.hidden = true;
}

function parseVoiceInput(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return;

  const expiryDate = parseDateText(cleaned);
  const location = extractLocation(cleaned);
  const knownItem = getCommonItems().find(item => cleaned.includes(item.itemName));
  const itemName = knownItem?.itemName || cleaned.split(/\d/)[0].replace(/效期|有效期限|進貨|新增/g, '').trim();
  const quantity = extractVoiceQuantity(cleaned, itemName);

  applyItemTemplate(knownItem || { itemName });
  if (itemName) setField('itemName', itemName);
  if (quantity) setField('quantity', quantity);
  if (expiryDate) setField('expiryDate', expiryDate);
  if (location) setField('location', location);

  showToast(`語音已填入：${cleaned}`);
}

function extractVoiceQuantity(text, itemName) {
  const withoutDates = text
    .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, ' ')
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*(?:日|號)?/g, ' ')
    .replace(/\b\d{4}\b/g, ' ');

  if (itemName && withoutDates.includes(itemName)) {
    const afterItem = withoutDates.slice(withoutDates.indexOf(itemName) + itemName.length);
    const afterItemMatch = afterItem.match(/(\d+)/);
    if (afterItemMatch) return afterItemMatch[1];
  }

  const explicit = withoutDates.match(/(?:數量|進貨|新增|扣除|領用)\s*(\d+)/);
  if (explicit) return explicit[1];

  const fallback = withoutDates.match(/(\d+)/);
  return fallback ? fallback[1] : '';
}

function extractLocation(text) {
  const explicit = text.match(/(?:位置|放在|放到)\s*([A-Za-zＡ-Ｚａ-ｚ0-9一-龥 ]{1,10})/);
  if (explicit) return explicit[1].trim();

  const stockroom = text.match(/(庫房\s*[A-Za-zＡ-Ｚａ-ｚ0-9一-龥]{0,4})/);
  if (stockroom) return stockroom[1].trim();

  const station = text.match(/(護理站|辦公室|倉庫\s*[A-Za-zＡ-Ｚａ-ｚ0-9一-龥]{0,4})/);
  return station ? station[1].trim() : '';
}

function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('此瀏覽器不支援語音輸入');
    return;
  }

  if (speechRecognition) {
    speechRecognition.stop();
    speechRecognition = null;
    els.voiceInputBtn.classList.remove('active');
    showToast('已停止語音輸入');
    return;
  }

  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = 'zh-TW';
  speechRecognition.interimResults = false;
  speechRecognition.continuous = false;
  els.voiceInputBtn.classList.add('active');
  els.quickInputHint.textContent = '正在聽，請說：品項、數量、效期、位置。';

  speechRecognition.onresult = event => {
    parseVoiceInput(event.results[0][0].transcript);
  };
  speechRecognition.onerror = () => showToast('語音辨識失敗，請再試一次');
  speechRecognition.onend = () => {
    speechRecognition = null;
    els.voiceInputBtn.classList.remove('active');
    els.quickInputHint.textContent = '可選常用品項、掃條碼，或說「口罩 20 效期 5月20 庫房 B」。';
  };
  speechRecognition.start();
}

function handleReceive(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const itemName = form.get('itemName').trim();
  const quantity = Number(form.get('quantity'));

  if (!itemName || quantity <= 0) {
    showToast('請確認品項與數量');
    return;
  }

  const batch = {
    id: makeId('b'),
    itemName,
    category: form.get('category'),
    quantity,
    safetyStock: Number(form.get('safetyStock') || 0),
    expiryDate: form.get('expiryDate'),
    location: form.get('location').trim(),
    receivedAt: todayISO(),
  };

  const existingBatch = state.batches.find(item =>
    item.itemName === batch.itemName &&
    item.expiryDate === batch.expiryDate &&
    item.location === batch.location &&
    item.quantity > 0
  );

  if (existingBatch) {
    existingBatch.quantity += batch.quantity;
    existingBatch.category = batch.category;
    existingBatch.safetyStock = Math.max(Number(existingBatch.safetyStock || 0), batch.safetyStock);
    existingBatch.receivedAt = todayISO();
  } else {
    state.batches.push(batch);
  }

  addMovement({
    type: '進貨',
    itemName: batch.itemName,
    quantity: batch.quantity,
    reason: existingBatch ? `${batch.location} · 已合併` : batch.location,
  });

  saveState();
  event.currentTarget.reset();
  document.getElementById('safetyStock').value = 10;
  els.quickItemSelect.value = '';
  render();
  showToast(existingBatch ? '已合併到現有庫存' : '已新增進貨');
}

function handleIssue(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const itemName = form.get('issueItem');
  let remaining = Number(form.get('issueQty'));

  if (!itemName || remaining <= 0) {
    showToast('請確認領用品項與數量');
    return;
  }

  const batches = state.batches
    .filter(batch => batch.itemName === itemName && batch.quantity > 0)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  const available = batches.reduce((sum, batch) => sum + batch.quantity, 0);
  if (remaining > available) {
    showToast(`庫存不足，目前只有 ${available}`);
    return;
  }

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    batch.quantity -= take;
    remaining -= take;
  }

  addMovement({
    type: '領用',
    itemName,
    quantity: Number(form.get('issueQty')),
    reason: '扣除庫存',
  });

  saveState();
  event.currentTarget.reset();
  render();
  showToast('已扣除數量');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function bindEvents() {
  els.receiveForm.addEventListener('submit', handleReceive);
  els.issueForm.addEventListener('submit', handleIssue);
  els.quickItemSelect.addEventListener('change', event => applyQuickItem(event.target.value));
  els.repeatLastBtn.addEventListener('click', repeatLastReceive);
  els.scanCodeBtn.addEventListener('click', startScanner);
  els.voiceInputBtn.addEventListener('click', startVoiceInput);
  document.getElementById('closeScanBtn').addEventListener('click', stopScanner);
  document.getElementById('applyBarcodeBtn').addEventListener('click', () => applyBarcodeText(els.barcodeManual.value));

  document.querySelectorAll('[data-expiry-shortcut]').forEach(btn => {
    btn.addEventListener('click', () => setExpiryShortcut(btn.dataset.expiryShortcut));
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach(item => item.classList.remove('active'));
      btn.classList.add('active');
      render();
    });
  });

}

bindEvents();
render();
