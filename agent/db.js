// ── MongoDB Connection + Collections ──────────────────────────────────
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/lpl_copilot";
const DB_NAME = "lpl_copilot";

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

export async function closeConnection() {
  if (client) {
    await client.close();
    console.log("[DB] Connection closed");
  }
}
