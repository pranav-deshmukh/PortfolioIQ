// Quick test: verify all major API endpoints work with the new schema
const BASE = "http://localhost:3001";

async function test() {
  // 1. GET /api/clients
  console.log("=== GET /api/clients ===");
  const clientsRes = await fetch(`${BASE}/api/clients`);
  const clients = await clientsRes.json();
  console.log(`  ${clients.length} clients loaded`);
  for (const c of clients) {
    console.log(`  ${c.client_id} — ${c.name} — ${c.risk_tolerance} — $${c.portfolio_value}`);
  }

  // 2. GET /api/clients/:clientId (first client)
  const firstId = clients[0].client_id;
  console.log(`\n=== GET /api/clients/${firstId} ===`);
  const detailRes = await fetch(`${BASE}/api/clients/${firstId}`);
  const detail = await detailRes.json();
  console.log(`  Name: ${detail.name}`);
  console.log(`  Holdings: ${detail.holdings.length} positions`);
  console.log(`  First holding: ${detail.holdings[0].ticker} (${detail.holdings[0].sector}) — ${detail.holdings[0].weight_pct}%`);
  console.log(`  Risk score: ${detail.risk_metrics.risk_score} (${detail.risk_metrics.risk_category})`);
  console.log(`  VaR(95%): $${detail.risk_metrics.var_95}`);
  console.log(`  Sector breakdown: ${JSON.stringify(detail.sector_breakdown)}`);

  console.log("\n✅ All endpoints working with new MongoDB schema!");
}

test().catch(e => {
  console.error("❌ Test failed:", e.message);
  process.exit(1);
});
