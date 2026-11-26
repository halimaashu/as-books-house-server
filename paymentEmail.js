const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

const formatMoney = (amount) => `৳${Number(amount || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
const addressDistrict = (order) => order.district || /district:([^\s]+)/i.exec(order.properAddress || "")?.[1] || "";
const formatAddress = (order) => {
  const match = /district:(.*?)\s+thana:(.*?)\s+address:(.*)/i.exec(order.properAddress || "");
  const parts = match ? [match[3], match[2], match[1], order.division] : [order.properAddress, order.division];
  return parts.map((part) => String(part || "").trim()).filter(Boolean).join(", ");
};

export async function sendPaymentConfirmationEmail(order, {
  apiKey = process.env.RESEND_API_KEY,
  from = process.env.MAIL_FROM,
  frontendUrl = process.env.FRONTEND_URL,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey || !from) {
    console.warn("Payment confirmation email skipped: configure backend RESEND_API_KEY and MAIL_FROM.");
    return { sent: false, reason: "mail_not_configured" };
  }
  const recipient = String(order?.email || "").trim();
  if (!recipient) {
    console.error("Payment confirmation email skipped: order has no customer email.");
    return { sent: false, reason: "missing_recipient" };
  }

  const district = addressDistrict(order);
  const daysUntilDelivery = district.trim().toLocaleLowerCase("en") === "dhaka" ? 1 : 3;
  const estimatedDelivery = new Date();
  estimatedDelivery.setDate(estimatedDelivery.getDate() + daysUntilDelivery);
  const dateText = new Intl.DateTimeFormat("en-BD", {
    dateStyle: "long",
    timeZone: "Asia/Dhaka",
  }).format(estimatedDelivery);
  const orderId = order.orderId || order.transitionId || "—";
  const title = order.bookTitle || "Book";
  const author = order.author ? ` by ${order.author}` : "";
  const quantity = Number(order.quantity || 1);
  const unitPrice = Number(order.price || 0);
  const subtotal = Number(order.subtotalAmount ?? unitPrice * quantity);
  const deliveryCharge = Number(order.deliveryCharge || 0);
  const total = Number(order.totalAmount ?? subtotal + deliveryCharge);
  const deliveryAddress = formatAddress(order);
  const ordersUrl = frontendUrl ? `${String(frontendUrl).replace(/\/+$/, "")}/dashboard/orders` : "";
  const safe = (value) => escapeHtml(value);
  const rows = [
    ["Order number", orderId],
    ["Book", `${title}${author}`],
    ["Quantity", quantity],
    ["Price per book", formatMoney(unitPrice)],
    ["Subtotal", formatMoney(subtotal)],
    ["Delivery charge", formatMoney(deliveryCharge)],
    ["Paid total", formatMoney(total)],
    ["Delivery address", deliveryAddress || district || "As provided at checkout"],
    ["Estimated delivery", `${dateText} (within ${daysUntilDelivery} ${daysUntilDelivery === 1 ? "day" : "days"})`],
  ];
  const tableRows = rows.map(([label, value]) => `<tr><td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#64748b">${safe(label)}</td><td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-weight:600">${safe(value)}</td></tr>`).join("");
  const action = ordersUrl ? `<p style="margin:24px 0"><a href="${safe(ordersUrl)}" style="background:#cf6410;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600">View my orders</a></p>` : "";
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0f172a"><div style="background:#10233f;padding:24px;border-radius:14px 14px 0 0;color:white"><p style="margin:0;color:#fdba74;font-weight:700">AS BOOKS HOUSE</p><h1 style="font-size:24px;margin:12px 0 0">Payment confirmed</h1></div><div style="padding:24px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 14px 14px"><p>Hi ${safe(order.name || "there")}, thank you for your order. Your payment has been verified and your book order is being prepared.</p><table style="width:100%;border-collapse:collapse;margin:18px 0">${tableRows}</table><p style="font-size:13px;color:#64748b">Delivery estimate: about 1 day for Dhaka District and about 3 days for other districts. These are estimates from the payment date.</p>${action}<p style="font-size:13px;color:#64748b">Thank you for choosing AS Books House.</p></div></div>`;
  const text = [
    `Hi ${order.name || "there"}, your payment was confirmed by AS Books House.`,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    `Estimated delivery: about ${daysUntilDelivery} ${daysUntilDelivery === 1 ? "day" : "days"} after payment (${dateText}).`,
    ordersUrl ? `View your orders: ${ordersUrl}` : "",
    "Thank you for choosing AS Books House.",
  ].filter(Boolean).join("\n");

  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [recipient], subject: `Payment confirmed · Order ${orderId}`, html, text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Email provider returned HTTP ${response.status}${errorBody ? `: ${errorBody.slice(0, 300)}` : ""}`);
  }
  const result = await response.json().catch(() => ({}));
  console.info("Payment confirmation email accepted by provider", { orderId, emailId: result?.id || null });
  return { sent: true, emailId: result?.id || null };
}
