import mongoose, { Schema, Document } from "mongoose";

/* -------------------------------------------------------
 * 1️⃣ Portfolio Schema
 * ------------------------------------------------------- */

interface Holding {
  asset_id: string;
  asset_type: string;
  sector: string;
  weight: number;
  purchase_price: number;
}

export interface Portfolio extends Document {
  client_id: string;
  portfolio_value: number;
  risk_profile: string;
  investment_horizon_years: number;
  holdings: Holding[];
}

const HoldingSchema = new Schema<Holding>({
  asset_id: { type: String, required: true },
  asset_type: { type: String, required: true },
  sector: { type: String, required: true },
  weight: { type: Number, required: true },
  purchase_price: { type: Number, required: true },
});

const PortfolioSchema = new Schema<Portfolio>(
  {
    client_id: { type: String, required: true, unique: true },
    portfolio_value: { type: Number, required: true },
    risk_profile: { type: String, required: true },
    investment_horizon_years: { type: Number, required: true },
    holdings: { type: [HoldingSchema], required: true },
  },
  { timestamps: true }
);

const PortfolioModel =
  mongoose.models.Portfolio ||
  mongoose.model<Portfolio>("Portfolio", PortfolioSchema);

/* -------------------------------------------------------
 * 2️⃣ Connection Handling (Reusable)
 * ------------------------------------------------------- */

let isConnected = false;

export async function connectDB() {
  if (isConnected) {
    console.log("📡 MongoDB already connected.");
    return;
  }

  try {
    await mongoose.connect(
      "mongodb+srv://vns444555_db_user:gw3cpBkxCvqHOgqk@cluster-main.imjr9lg.mongodb.net/portfolio-db"
    );

    isConnected = true;
    console.log("✅ MongoDB Connected (Atlas)");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    throw new Error("Failed to connect to MongoDB");
  }
}

/* -------------------------------------------------------
 * 3️⃣ Create Portfolio
 * ------------------------------------------------------- */
export async function createPortfolio(data: Portfolio) {
  try {
    await connectDB();
    const newPortfolio = await PortfolioModel.create(data);
    return newPortfolio;
  } catch (err) {
    console.error("❌ Error Creating Portfolio:", err);
    throw err;
  }
}

/* -------------------------------------------------------
 * 4️⃣ Get Portfolio by Client ID
 * ------------------------------------------------------- */
export async function getPortfolioByClientId(clientId: string) {
  try {
    await connectDB();
    return await PortfolioModel.findOne({ client_id: clientId });
  } catch (err) {
    console.error("❌ Error Fetching Portfolio:", err);
    throw err;
  }
}

/* -------------------------------------------------------
 * 5️⃣ Get All Portfolios
 * ------------------------------------------------------- */
export async function getAllPortfolios() {
  try {
    await connectDB();
    return await PortfolioModel.find({});
  } catch (err) {
    console.error("❌ Error Fetching All Portfolios:", err);
    throw err;
  }
}
