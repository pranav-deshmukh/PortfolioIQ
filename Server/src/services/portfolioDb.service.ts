import mongoose from "mongoose";
import PortfolioModel, { IPortfolio } from "../models/portfolio.model";

let isConnected = false;
const TARGET_DB = process.env.MONGO_DB_NAME || "portfolio-db";

export async function connectDB() {
  if (isConnected) {
    console.log("📡 MongoDB already connected.");
    return;
  }

  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_ACCESS_URI || "";

    await mongoose.connect(mongoUri, {
      dbName: TARGET_DB,
    });

    isConnected = true;
    console.log(`✅ MongoDB Connected (${mongoose.connection.db?.databaseName ?? TARGET_DB})`);
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    throw new Error("Failed to connect to MongoDB");
  }
}

export async function createPortfolio(data: Partial<IPortfolio>) {
  try {
    await connectDB();
    const newPortfolio = await PortfolioModel.create(data);
    return newPortfolio;
  } catch (err) {
    console.error("❌ Error Creating Portfolio:", err);
    throw err;
  }
}

export async function getPortfolioByClientId(clientId: string) {
  try {
    await connectDB();
    return await PortfolioModel.findOne({ client_id: clientId });
  } catch (err) {
    console.error("❌ Error Fetching Portfolio:", err);
    throw err;
  }
}

export async function getAllPortfolios() {
  try {
    await connectDB();
    return await PortfolioModel.find({});
  } catch (err) {
    console.error("❌ Error Fetching All Portfolios:", err);
    throw err;
  }
}
