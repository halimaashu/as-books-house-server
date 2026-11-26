const VALID_PAID_STATUSES = new Set(["VALID", "VALIDATED"]);
const FAILED_STATUSES = new Set(["FAILED", "CANCEL", "CANCELLED", "CANCELED", "EXPIRED"]);

export const normalizeMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
};

export function expectedOrderAmount(order) {
  if (order?.totalAmount != null) return Number(order.totalAmount);
  if (order?.totalPrice != null) return Number(order.totalPrice);
  return Number(order?.price) * Number(order?.quantity || 1);
}

export function matchesOrderPayment(order, remote, expectedTranId, expectedOrderId) {
  if (!order || !remote || !VALID_PAID_STATUSES.has(String(remote.status || "").toUpperCase())) return false;
  if (String(remote.tran_id || "") !== String(expectedTranId || "")) return false;
  if (String(order.transitionId || "") !== String(expectedTranId || "")) return false;
  if (!expectedOrderId || String(remote.value_a || "") !== String(expectedOrderId)) return false;
  if (String(order.orderId || "") !== String(expectedOrderId)) return false;
  if (normalizeMoney(remote.amount) !== normalizeMoney(expectedOrderAmount(order))) return false;
  if (String(remote.currency || "").toUpperCase() !== "BDT") return false;
  if (remote.currency_type && String(remote.currency_type).toUpperCase() !== "BDT") return false;
  return true;
}

export function matchesOrderFailure(order, remote, expectedTranId) {
  if (!order || !remote || !FAILED_STATUSES.has(String(remote.status || "").toUpperCase())) return false;
  if (String(remote.tran_id || "") !== String(expectedTranId || "")) return false;
  if (String(order.transitionId || "") !== String(expectedTranId || "")) return false;
  if (normalizeMoney(remote.amount) !== normalizeMoney(expectedOrderAmount(order))) return false;
  return String(remote.currency || "").toUpperCase() === "BDT";
}

export async function validateSslCommerzByValidationId({ valId, storeId, storePassword, isLive = false, fetchImpl = fetch }) {
  if (!valId || !storeId || !storePassword) throw new Error("Missing SSLCommerz validation credentials or validation ID");
  const origin = isLive ? "https://securepay.sslcommerz.com" : "https://sandbox.sslcommerz.com";
  const url = new URL("/validator/api/validationserverAPI.php", origin);
  url.search = new URLSearchParams({ val_id: String(valId), store_id: storeId, store_passwd: storePassword, format: "json" });
  const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`SSLCommerz validation returned HTTP ${response.status}`);
  return response.json();
}

export async function validateSslCommerzByTransactionId({ tranId, storeId, storePassword, isLive = false, fetchImpl = fetch }) {
  if (!tranId || !storeId || !storePassword) throw new Error("Missing SSLCommerz transaction validation credentials");
  const origin = isLive ? "https://securepay.sslcommerz.com" : "https://sandbox.sslcommerz.com";
  const url = new URL("/validator/api/merchantTransIDvalidationAPI.php", origin);
  url.search = new URLSearchParams({ tran_id: String(tranId), store_id: storeId, store_passwd: storePassword, format: "json" });
  const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`SSLCommerz transaction lookup returned HTTP ${response.status}`);
  return response.json();
}

export function createPaymentHandlers({ ordersCollection, validateByValId, validateByTranId, frontendUrl, storeId, onPaid = async () => {} }) {
  const frontend = String(frontendUrl || "").replace(/\/+$/, "");
  const page = (state, tranId) => `${frontend}/payment/${state}/${encodeURIComponent(tranId)}`;

  async function acceptSuccessfulPayment(tranId, valId, callbackTranId) {
    if (!tranId || !valId || callbackTranId !== tranId) return { result: "invalid" };
    const order = await ordersCollection.findOne({ transitionId: tranId });
    if (!order) return { result: "invalid" };

    // Idempotent repeat of the exact already-recorded SSLCommerz transaction.
    if (order.isPaid === true) {
      return order.paymentValidationId === valId ? { result: "already_paid" } : { result: "invalid" };
    }

    const remote = await validateByValId(valId);
    if (remote?.store_id && storeId && remote.store_id !== storeId) return { result: "invalid" };
    if (!matchesOrderPayment(order, remote, tranId, order.orderId)) return { result: "invalid" };
    if (remote.val_id && String(remote.val_id) !== String(valId)) return { result: "invalid" };

    // Compare-and-set prevents concurrent success/IPN callbacks from processing twice.
    const result = await ordersCollection.updateOne(
      { _id: order._id, transitionId: tranId, orderId: order.orderId, isPaid: { $ne: true } },
      { $set: { isPaid: true, paymentStatus: "paid", paymentValidationId: String(valId), paidAt: new Date() } },
    );
    if (result.modifiedCount === 1) {
      try {
        await onPaid(order);
      } catch (error) {
        console.error("Verified payment confirmation email failed:", error.message);
      }
      return { result: "paid" };
    }
    const latest = await ordersCollection.findOne({ transitionId: tranId });
    return latest?.isPaid === true && latest.paymentValidationId === valId
      ? { result: "already_paid" }
      : { result: "invalid" };
  }

  async function success(req, res) {
    const tranId = req.params.transitionId;
    try {
      const outcome = await acceptSuccessfulPayment(tranId, req.body?.val_id, req.body?.tran_id);
      if (outcome.result === "paid" || outcome.result === "already_paid") {
        return res.redirect(303, page("success", tranId));
      }
    } catch (error) {
      console.error("SSLCommerz payment verification failed:", error.message);
    }
    return res.redirect(303, page("fail", tranId));
  }

  async function ipn(req, res) {
    const tranId = String(req.body?.tran_id || "");
    try {
      const outcome = await acceptSuccessfulPayment(tranId, req.body?.val_id, tranId);
      return outcome.result === "paid" || outcome.result === "already_paid"
        ? res.status(200).json({ accepted: true })
        : res.status(400).json({ accepted: false });
    } catch (error) {
      console.error("SSLCommerz IPN verification failed:", error.message);
      return res.status(503).json({ accepted: false });
    }
  }

  function terminalReturn(status) {
    return async (req, res) => {
      const tranId = req.params.transitionId;
      try {
        const order = await ordersCollection.findOne({ transitionId: tranId });
        if (order && order.isPaid !== true) {
          const lookup = await validateByTranId(tranId);
          const records = Array.isArray(lookup?.element) ? lookup.element : lookup?.element ? [lookup.element] : [];
          const remote = records.find((entry) => String(entry?.tran_id || "") === tranId);
          if (lookup?.APIConnect === "DONE" && matchesOrderFailure(order, remote, tranId)) {
            await ordersCollection.updateOne(
              { _id: order._id, transitionId: tranId, isPaid: { $ne: true } },
              { $set: { paymentStatus: status } },
            );
          }
        }
      } catch (error) {
        console.error(`SSLCommerz ${status} verification failed:`, error.message);
      }
      return res.redirect(303, page("fail", tranId));
    };
  }

  return {
    success,
    ipn,
    failed: terminalReturn("failed"),
    cancelled: terminalReturn("cancelled"),
    acceptSuccessfulPayment,
  };
}

export function canReadOrdersFor(auth, requestedEmail) {
  const email = String(auth?.email || "").trim().toLowerCase();
  const target = String(requestedEmail || "").trim().toLowerCase();
  return Boolean(email && (email === target || auth?.role === "admin"));
}
