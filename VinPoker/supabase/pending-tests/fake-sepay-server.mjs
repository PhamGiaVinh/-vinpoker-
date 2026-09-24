import http from "node:http";

const referenceCode = process.env.REFERENCE_CODE;
if (!referenceCode) throw new Error("missing REFERENCE_CODE");

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://fake-sepay");
  if (url.pathname !== "/v2/transactions" || url.searchParams.get("account_number") !== "999100001") {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== "Bearer cashier-edge-fake-token") {
    response.writeHead(401).end();
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({
    data: [{
      id: "cashier-edge-bank-1",
      account_number: "999100001",
      bank_brand_name: "TEST BANK",
      amount_in: 6600000,
      amount_out: 0,
      transfer_type: "in",
      transaction_content: referenceCode,
      reference_number: "EDGE-TEST-REF-1",
      transaction_date: "2026-09-24 14:00:00",
    }],
    meta: { pagination: { current_page: 1, last_page: 1, has_more: false } },
  }));
});

server.listen(8787, "0.0.0.0");
