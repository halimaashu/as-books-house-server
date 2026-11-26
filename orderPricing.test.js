import test from "node:test";
import assert from "node:assert/strict";
import { calculateOrderTotals, getDeliveryCharge } from "./orderPricing.js";

test("delivery is 70 taka for Dhaka and 130 taka outside Dhaka", () => {
  assert.equal(getDeliveryCharge("Dhaka"), 70);
  assert.equal(getDeliveryCharge(" dhaka "), 70);
  assert.equal(getDeliveryCharge("Chattogram"), 130);
  assert.equal(getDeliveryCharge(""), null);
});

test("order total includes the server-calculated delivery charge", () => {
  assert.deepEqual(calculateOrderTotals(250, 2, "Dhaka"), {
    subtotalAmount: 500,
    deliveryCharge: 70,
    totalAmount: 570,
  });
  assert.deepEqual(calculateOrderTotals(250, 2, "Rangpur"), {
    subtotalAmount: 500,
    deliveryCharge: 130,
    totalAmount: 630,
  });
  assert.equal(calculateOrderTotals(250, 1, ""), null);
});
