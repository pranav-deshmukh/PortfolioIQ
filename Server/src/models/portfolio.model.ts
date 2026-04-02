// models/portfolio.model.ts

import mongoose, { Schema, Document } from "mongoose";

// Holding Interface
export interface Holding {
  asset_id: string;
  asset_type: string;
  sector: string;
  weight: number;
  purchase_price: number;
}

// Portfolio Interface
export interface Portfolio extends Document {
  client_id: string;
  portfolio_value: number;
  risk_profile: string;
  investment_horizon_years: number;
  holdings: Holding[];
}

// Holding Schema
const HoldingSchema: Schema = new Schema(
  {
    asset_id: { type: String, required: true },
    asset_type: { type: String, required: true },
    sector: { type: String, required: true },
    weight: { type: Number, required: true },
    purchase_price: { type: Number, required: true },
  },
  { _id: false } // prevents extra _id inside holdings array
);

// Portfolio Schema
const PortfolioSchema: Schema = new Schema(
  {
    client_id: { type: String, required: true },
    portfolio_value: { type: Number, required: true },
    risk_profile: { type: String, required: true },
    investment_horizon_years: { type: Number, required: true },
    holdings: {
      type: [HoldingSchema],
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model<Portfolio>("Portfolio", PortfolioSchema);