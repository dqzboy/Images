// Surge response capture script for Surge Ad Inspector.
// Replace COLLECTOR with the Mac's LAN IP and port.
const COLLECTOR = "http://192.168.31.67:8787/api/capture";
const TOKEN = "xia-local-dev";
const MAX_BODY = 256 * 1024;
const headers = $response.headers || {};
const contentType = headers["Content-Type"] || headers["content-type"] || "";
let body = $response.body || "";
if (body.length > MAX_BODY) body = body.slice(0, MAX_BODY);
$httpClient.post({
  url: COLLECTOR,
  headers: { "Content-Type": "application/json", "X-Capture-Token": TOKEN },
  body: JSON.stringify({
    time: new Date().toISOString(),
    url: $request.url,
    method: $request.method,
    requestHeaders: $request.headers,
    status: $response.status,
    responseHeaders: headers,
    contentType,
    responseSize: body.length,
    body
  })
}, function () { $done({}); });
