// ── MongoDB Connection + Collections ──────────────────────────────────
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://vns444555_db_user:gw3cpBkxCvqHOgqk@cluster-main.imjr9lg.mongodb.net/portfolio-db?appName=Cluster-main";
const DB_NAME = process.env.MONGO_DB_NAME || "portfolio-db";

let client;
let db;

export async function connectDB() {
  if (db) return db;
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`[DB] Connected to MongoDB: ${DB_NAME}`);

  // Ensure indexes
  await db.collection("insights").createIndex({ client_id: 1, created_at: -1 });
  await db.collection("alerts").createIndex({ client_id: 1, created_at: -1 });
  await db.collection("alerts").createIndex({ status: 1 });
  await db.collection("pipeline_runs").createIndex({ started_at: -1 });
  await db.collection("news_events").createIndex({ batch_id: 1 });
  await db.collection("analytics_snapshots").createIndex({ client_id: 1, created_at: -1 });

  return db;
}

export async function getDB() {
  if (!db) await connectDB();
  return db;
}

// ── Collection helpers ────────────────────────────────────────────────

export async function saveInsight(insight) {
  const col = (await getDB()).collection("insights");
  insight.created_at = new Date();
  const result = await col.insertOne(insight);
  console.log(`[DB] Saved insight for client ${insight.client_id}: ${result.insertedId}`);
  return result;
}

export async function saveAlert(alert) {
  const col = (await getDB()).collection("alerts");
  alert.created_at = new Date();
  alert.status = alert.status || "active";
  const result = await col.insertOne(alert);
  console.log(`[DB] Saved alert for client ${alert.client_id}: ${alert.severity} — ${alert.title}`);
  return result;
}

export async function savePipelineRun(run) {
  const col = (await getDB()).collection("pipeline_runs");
  const result = await col.insertOne(run);
  return result;
}

export async function saveNewsEvents(events) {
  const col = (await getDB()).collection("news_events");
  if (events.length > 0) {
    const result = await col.insertMany(events);
    console.log(`[DB] Saved ${events.length} news events`);
    return result;
  }
}

export async function getLatestInsights(clientId = null, limit = 20) {
  const col = (await getDB()).collection("insights");
  const query = clientId ? { client_id: clientId } : {};
  return col.find(query).sort({ created_at: -1 }).limit(limit).toArray();
}

export async function getActiveAlerts(clientId = null) {
  const col = (await getDB()).collection("alerts");
  const query = { status: "active" };
  if (clientId) query.client_id = clientId;
  return col.find(query).sort({ created_at: -1 }).toArray();
}

export async function getAllAlerts(limit = 50) {
  const col = (await getDB()).collection("alerts");
  return col.find({}).sort({ created_at: -1 }).limit(limit).toArray();
}

export async function getPipelineRuns(limit = 10) {
  const col = (await getDB()).collection("pipeline_runs");
  return col.find({}).sort({ started_at: -1 }).limit(limit).toArray();
}

export async function dismissAlert(alertId) {
  const col = (await getDB()).collection("alerts");
  const { ObjectId } = await import("mongodb");
  return col.updateOne({ _id: new ObjectId(alertId) }, { $set: { status: "dismissed" } });
}

// ── Analytics Snapshots (per-client, rolling window of 5 each) ───────

/**
 * Save one analytics snapshot per client.
 * Each client keeps only its last 5 snapshots — when a 6th arrives the oldest is deleted.
 */
export async function saveAnalyticsSnapshots(clientSnapshots) {
  const col = (await getDB()).collection("analytics_snapshots");
  const now = new Date();
  let saved = 0;

  for (const snap of clientSnapshots) {
    snap.created_at = now;
    await col.insertOne(snap);
    saved++;

    // Keep only last 20 per client
    const count = await col.countDocuments({ client_id: snap.client_id });
    if (count > 20) {
      const oldest = await col.find({ client_id: snap.client_id })
        .sort({ created_at: 1 })
        .limit(count - 20)
        .toArray();
      await col.deleteMany({ _id: { $in: oldest.map(d => d._id) } });
    }
  }

  console.log(`[DB] Saved ${saved} client analytics snapshots (20 max per client)`);
}

/** Get last N snapshots for a specific client (newest first) */
export async function getClientSnapshots(clientId, limit = 20) {
  const col = (await getDB()).collection("analytics_snapshots");
  return col.find({ client_id: clientId }).sort({ created_at: -1 }).limit(limit).toArray();
}

/** Get the latest snapshot for every client (one per client) */
export async function getLatestSnapshots() {
  const col = (await getDB()).collection("analytics_snapshots");
  return col.aggregate([
    { $sort: { created_at: -1 } },
    { $group: { _id: "$client_id", doc: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$doc" } },
    { $sort: { client_id: 1 } }
  ]).toArray();
}

export async function closeConnection() {
  if (client) {
    await client.close();
    console.log("[DB] Connection closed");
  }
}

// ── Load client portfolios from MongoDB ──────────────────────────────

// Map DB sector names → internal lowercase keys used by analytics engine
const SECTOR_NORMALIZE = {
  "technology": "tech",
  "finance": "financials",
  "energy": "energy",
  "healthcare": "healthcare",
  "fixed income": "bonds",
  "international": "international",
  "cash": "cash",
  "consumer staples": "consumer_staples",
  "real estate": "real_estate",
  "commodities": "commodities",
};

// Map DB risk_tolerance → internal risk tolerance keys used by RISK_THRESHOLDS
const RISK_TOLERANCE_MAP = {
  low: "conservative",
  medium: "moderate",
  high: "aggressive",
};

function normalizeSector(sector) {
  return SECTOR_NORMALIZE[sector.toLowerCase()] || sector.toLowerCase();
}

let clientsCache = null;

/**
 * Load client portfolios from the MongoDB `portfolios` collection.
 * Normalizes sector names and risk tolerance to match internal conventions.
 * Caches the result so subsequent calls are instant.
 */
export async function loadClients() {
  const database = await getDB();
  const portfolios = await database.collection("portfolios").find({}).toArray();

  clientsCache = portfolios.map(p => ({
    client_id: p.client_id,
    name: p.client_name,
    age: null,
    portfolio_value: p.portfolio_value,
    risk_tolerance: RISK_TOLERANCE_MAP[p.risk_tolerance] || p.risk_tolerance,
    time_horizon_years: p.time_horizon_years,
    holdings: (p.holdings || []).map(h => ({
      symbol: h.symbol,
      name: h.name,
      sector: normalizeSector(h.sector),
      weight: h.weight,
      purchase_price: h.purchase_price,
      current_price: h.current_price,
      quantity: h.quantity,
    })),
  }));

  console.log(`[DB] Loaded ${clientsCache.length} client portfolios from MongoDB`);
  return clientsCache;
}

/**
 * Get cached clients (must call loadClients() first at startup).
 */
export function getClients() {
  if (!clientsCache) throw new Error("Clients not loaded yet. Call loadClients() after connectDB().");
  return clientsCache;
}

/**
 * Force-refresh the clients cache from DB.
 */
export async function refreshClients() {
  return loadClients();
}
