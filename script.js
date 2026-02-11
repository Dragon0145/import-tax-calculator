function yenRound(x) {
  return Math.round(x);
}

async function fetchFxRate(base, symbol) {
  const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(symbol)}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`FX API error: ${r.status}`);
  const data = await r.json();
  const rate = data?.rates?.[symbol];
  if (!rate) throw new Error("FX rate not found");
  return { rate: Number(rate), date: data.date || null, source: "frankfurter" };
}

function calcTaxes({
  sticks,
  weight_g_per_stick,
  item_price_yen,
  shipping_yen,
  duty_rate,
  assessed_ratio = 0.6,
  duty_exempt_threshold_yen = 10000,
  tobacco_tax_per_kg = 15244,
  vat_national_rate = 0.078,
  vat_local_rate = 0.022,
  customs_fee_yen = 200,
}) {
  const purchase_total_yen = item_price_yen + shipping_yen;

  // 課税価格（送料含む）
  const assessed_value_yen = yenRound((item_price_yen + shipping_yen) * assessed_ratio);

  // 関税：課税価格が1万円以下なら免税（関税のみ）
  const duty_exempted = assessed_value_yen <= duty_exempt_threshold_yen;
  const duty_yen = duty_exempted ? 0 : yenRound(assessed_value_yen * duty_rate);

  // たばこ税：重量課税
  const total_weight_g = sticks * weight_g_per_stick;
  const tobacco_tax_yen = yenRound((total_weight_g / 1000.0) * tobacco_tax_per_kg);

  // 消費税：免税にならない（あなたの方針に合わせる）
  // ベース：課税価格 + 関税（たばこ税は含めない）
  const vat_base = assessed_value_yen + duty_yen;
  const vat_national_yen = yenRound(vat_base * vat_national_rate);
  const vat_local_yen = yenRound(vat_base * vat_local_rate);

  const taxes_and_fees_total_yen =
    duty_yen + tobacco_tax_yen + vat_national_yen + vat_local_yen + customs_fee_yen;

  const grand_total_yen = purchase_total_yen + taxes_and_fees_total_yen;
  const per_stick_yen = sticks > 0 ? yenRound(grand_total_yen / sticks) : 0;

  return {
    item_price_yen,
    shipping_yen,
    purchase_total_yen,
    assessed_value_yen,
    duty_exempted,
    duty_yen,
    total_weight_g,
    tobacco_tax_yen,
    vat_national_yen,
    vat_local_yen,
    customs_fee_yen,
    taxes_and_fees_total_yen,
    grand_total_yen,
    per_stick_yen,
  };
}

function showErrors(errors) {
  const box = document.getElementById("errors");
  if (!errors.length) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  box.style.display = "block";
  box.innerHTML = "<b>入力エラー</b><ul>" + errors.map(e => `<li>${e}</li>`).join("") + "</ul>";
}

function renderResult({ input, fx, b }) {
  const r = document.getElementById("result");
  const exemptLabel = b.duty_exempted
    ? `<span style="color:#0066cc;font-weight:700;">免税（関税のみ）</span>`
    : `<span style="color:#cc0000;font-weight:700;">課税（関税あり）</span>`;

  r.innerHTML = `
    <h2>計算結果（概算）</h2>
    <table>
      <tr><th>為替レート</th><td>${fx.rate.toFixed(4)} 円 / 1 ${input.currency}（${fx.source}${fx.date ? `, ${fx.date}` : ""}）</td></tr>
      <tr><th>商品価格（円）</th><td>${b.item_price_yen} 円</td></tr>
      <tr><th>送料（円）</th><td>${b.shipping_yen} 円</td></tr>
      <tr><th>購入金額（商品＋送料）</th><td><b>${b.purchase_total_yen}</b> 円</td></tr>
    </table>

    <h3>課税前提</h3>
    <table>
      <tr><th>課税価格（(商品＋送料)×0.6）</th><td>${b.assessed_value_yen} 円</td></tr>
      <tr><th>関税の免税判定</th><td>${exemptLabel}</td></tr>
    </table>

    <h3>内訳</h3>
    <table>
      <tr><th>関税</th><td>${b.duty_yen} 円</td></tr>
      <tr><th>たばこ税（重量課税）</th><td>${b.tobacco_tax_yen} 円（総重量 ${b.total_weight_g.toFixed(1)} g）</td></tr>
      <tr><th>消費税（国税 7.8%）</th><td>${b.vat_national_yen} 円</td></tr>
      <tr><th>地方消費税（2.2%）</th><td>${b.vat_local_yen} 円</td></tr>
      <tr><th>通関料</th><td>${b.customs_fee_yen} 円</td></tr>
      <tr><th>税金・通関料 合計</th><td>${b.taxes_and_fees_total_yen} 円</td></tr>
      <tr><th class="total">支払総額</th><td class="total">${b.grand_total_yen} 円</td></tr>
      <tr><th>1本あたり</th><td><b>${b.per_stick_yen}</b> 円 / 本</td></tr>
    </table>
  `;
}

document.getElementById("calcForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const fd = new FormData(e.target);
  const errors = [];

  const sticks = Number(fd.get("sticks"));
  const weight_g = Number(fd.get("weight_g"));
  const currency = String(fd.get("currency") || "USD");
  const item_price_foreign = Number(fd.get("item_price_foreign"));
  const shipping_foreign = Number(fd.get("shipping_foreign"));
  const duty_rate = Number(fd.get("duty_rate"));
  const fx_rate_manual_raw = String(fd.get("fx_rate_manual") || "").trim();

  if (!Number.isFinite(sticks) || sticks <= 0) errors.push("本数は1以上を入力してください。");
  if (!Number.isFinite(weight_g) || weight_g <= 0) errors.push("重量は正の値を入力してください。");
  if (!Number.isFinite(item_price_foreign) || item_price_foreign < 0) errors.push("商品価格が不正です。");
  if (!Number.isFinite(shipping_foreign) || shipping_foreign < 0) errors.push("送料が不正です。");
  if (!Number.isFinite(duty_rate) || duty_rate < 0) errors.push("関税率が不正です。");

  showErrors(errors);
  if (errors.length) return;

  let fx;
  try {
    if (fx_rate_manual_raw) {
      const manual = Number(fx_rate_manual_raw);
      if (!Number.isFinite(manual) || manual <= 0) throw new Error("手入力為替が不正です。");
      fx = { rate: manual, date: null, source: "manual" };
    } else {
      fx = await fetchFxRate(currency, "JPY");
    }
  } catch (err) {
    showErrors([`為替の取得に失敗しました。詳細設定で手入力してください。(${err.message})`]);
    return;
  }

  const item_price_yen = yenRound(item_price_foreign * fx.rate);
  const shipping_yen = yenRound(shipping_foreign * fx.rate);

  const b = calcTaxes({
    sticks,
    weight_g_per_stick: weight_g,
    item_price_yen,
    shipping_yen,
    duty_rate,
  });

  renderResult({
    input: { currency },
    fx,
    b,
  });
});
