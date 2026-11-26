import test from "node:test";
import assert from "node:assert/strict";
import { canReadOrdersFor, createPaymentHandlers, matchesOrderPayment, validateSslCommerzByValidationId } from "./paymentSecurity.js";

function fixture(remotePayment, frontendUrl = "https://shop.example.com/") {
  const order = {
    _id: "db-order-1",
    orderId: "public-order-1",
    transitionId: "tran-1",
    email: "buyer@example.com",
    totalAmount: 250,
    currency: "BDT",
    isPaid: false,
    paymentStatus: "pending",
  };
  let updateCount = 0;
  const collection = {
    async findOne(filter) {
      if (filter.transitionId !== order.transitionId) return null;
      return { ...order };
    },
    async updateOne(filter, update) {
      updateCount += 1;
      if (filter.transitionId !== order.transitionId || order.isPaid === true) return { modifiedCount: 0 };
      Object.assign(order, update.$set);
      return { modifiedCount: 1 };
    },
  };
  let validations = 0;
  const handlers = createPaymentHandlers({
    ordersCollection: collection,
    validateByValId: async () => { validations += 1; return remotePayment; },
    validateByTranId: async () => ({ APIConnect: "DONE", element: [remotePayment] }),
    frontendUrl,
    storeId: "test-store",
  });
  return { order, handlers, collection, get updateCount() { return updateCount; }, get validations() { return validations; } };
}

function responseDouble() {
  return {
    statusCode: null,
    location: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    redirect(code, location) { this.statusCode = code; this.location = location; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

const successfulRemote = () => ({
  status: "VALID",
  tran_id: "tran-1",
  val_id: "validation-1",
  value_a: "public-order-1",
  amount: "250.00",
  currency: "BDT",
  currency_type: "BDT",
  store_id: "test-store",
});

test("valid SSLCommerz validation response marks the exact order paid (mocked gateway)", async () => {
  const f = fixture(successfulRemote());
  const res = responseDouble();
  await f.handlers.success({ params: { transitionId: "tran-1" }, body: { tran_id: "tran-1", val_id: "validation-1" } }, res);
  assert.equal(f.order.isPaid, true);
  assert.equal(f.order.paymentStatus, "paid");
  assert.equal(res.location, "https://shop.example.com/payment/success/tran-1");
  assert.equal(f.validations, 1);
});

test("verified local checkout success redirects to the local frontend success page", async () => {
  const f = fixture(successfulRemote(), "http://localhost:3000");
  const res = responseDouble();
  await f.handlers.success({ params: { transitionId: "tran-1" }, body: { tran_id: "tran-1", val_id: "validation-1" } }, res);
  assert.equal(f.order.isPaid, true);
  assert.equal(res.location, "http://localhost:3000/payment/success/tran-1");
});

test("fake success URL without an SSLCommerz validation ID cannot mark paid", async () => {
  const f = fixture(successfulRemote());
  const res = responseDouble();
  await f.handlers.success({ params: { transitionId: "tran-1" }, body: { tran_id: "tran-1" } }, res);
  assert.equal(f.order.isPaid, false);
  assert.equal(f.validations, 0);
  assert.match(res.location, /payment\/fail/);
});

test("invalid validation ID and transaction ID mismatch are rejected", async () => {
  const f = fixture({ ...successfulRemote(), status: "INVALID_TRANSACTION", tran_id: "someone-elses-tran" });
  const res = responseDouble();
  await f.handlers.success({ params: { transitionId: "tran-1" }, body: { tran_id: "tran-1", val_id: "forged" } }, res);
  assert.equal(f.order.isPaid, false);
  assert.match(res.location, /payment\/fail/);
});

test("incorrect paid amount is rejected", async () => {
  const f = fixture({ ...successfulRemote(), amount: "1.00" });
  await f.handlers.success({ params: { transitionId: "tran-1" }, body: { tran_id: "tran-1", val_id: "validation-1" } }, responseDouble());
  assert.equal(f.order.isPaid, false);
  assert.equal(f.updateCount, 0);
});

test("payment verification expects book subtotal plus server-stored delivery charge", async () => {
  const f = fixture({ ...successfulRemote(), amount: "320.00" });
  f.order.subtotalAmount = 250;
  f.order.deliveryCharge = 70;
  f.order.totalAmount = 320;
  const res = responseDouble();
  await f.handlers.success({ params: { transitionId: "tran-1" }, body: { tran_id: "tran-1", val_id: "validation-1" } }, res);
  assert.equal(f.order.isPaid, true);
  assert.match(res.location, /payment\/success/);
});

test("incorrect payment currency is rejected", async () => {
  const f = fixture({ ...successfulRemote(), currency: "USD", currency_type: "USD" });
  await f.handlers.success({ params: { transitionId: "tran-1" }, body: { tran_id: "tran-1", val_id: "validation-1" } }, responseDouble());
  assert.equal(f.order.isPaid, false);
  assert.equal(f.updateCount, 0);
});

test("SSLCommerz validation request uses the server-only validation API contract", async () => {
  let requestUrl;
  let requestOptions;
  const result = await validateSslCommerzByValidationId({
    valId: "opaque-validation-id",
    storeId: "private-store-id",
    storePassword: "private-store-password",
    isLive: false,
    fetchImpl: async (url, options) => {
      requestUrl = new URL(url);
      requestOptions = options;
      return { ok: true, json: async () => successfulRemote() };
    },
  });
  assert.equal(requestUrl.origin, "https://sandbox.sslcommerz.com");
  assert.equal(requestUrl.pathname, "/validator/api/validationserverAPI.php");
  assert.equal(requestUrl.searchParams.get("val_id"), "opaque-validation-id");
  assert.equal(requestUrl.searchParams.get("store_id"), "private-store-id");
  assert.equal(requestUrl.searchParams.get("store_passwd"), "private-store-password");
  assert.equal(requestOptions.method, "GET");
  assert.equal(result.status, "VALID");
});

test("validation for another order ID cannot pay this order", async () => {
  const f = fixture({ ...successfulRemote(), value_a: "another-order" });
  await f.handlers.success({ params: { transitionId: "tran-1" }, body: { tran_id: "tran-1", val_id: "validation-1" } }, responseDouble());
  assert.equal(f.order.isPaid, false);
});

test("duplicate callback is idempotent and does not process payment twice", async () => {
  const f = fixture(successfulRemote());
  const req = { params: { transitionId: "tran-1" }, body: { tran_id: "tran-1", val_id: "validation-1" } };
  await f.handlers.success(req, responseDouble());
  const duplicate = responseDouble();
  await f.handlers.success(req, duplicate);
  assert.equal(f.order.isPaid, true);
  assert.equal(f.updateCount, 1);
  assert.equal(f.validations, 1);
  assert.match(duplicate.location, /payment\/success/);
});

test("failed and cancelled gateway outcomes do not mark an order paid", async () => {
  const failed = fixture({ ...successfulRemote(), status: "FAILED" });
  const failedResponse = responseDouble();
  await failed.handlers.failed({ params: { transitionId: "tran-1" }, body: {} }, failedResponse);
  assert.equal(failed.order.isPaid, false);
  assert.equal(failed.order.paymentStatus, "failed");
  assert.match(failedResponse.location, /payment\/fail/);

  const cancelled = fixture({ ...successfulRemote(), status: "CANCELLED" });
  const res = responseDouble();
  await cancelled.handlers.cancelled({ params: { transitionId: "tran-1" }, body: {} }, res);
  assert.equal(cancelled.order.isPaid, false);
  assert.equal(cancelled.order.paymentStatus, "cancelled");
  assert.match(res.location, /payment\/fail/);
});

test("users cannot read another user's order history", () => {
  assert.equal(canReadOrdersFor({ sub: "user-1", email: "buyer@example.com", role: "user" }, "buyer@example.com"), true);
  assert.equal(canReadOrdersFor({ sub: "user-1", email: "buyer@example.com", role: "user" }, "other@example.com"), false);
  assert.equal(canReadOrdersFor({ sub: "admin-1", email: "admin@example.com", role: "admin" }, "other@example.com"), true);
  assert.equal(matchesOrderPayment({ transitionId: "tran-1", orderId: "public-order-1", totalAmount: 250 }, successfulRemote(), "tran-1", "public-order-1"), true);
});
