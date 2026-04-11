import mongoose, { Schema, Document } from "mongoose";

export interface INewsEvent extends Document {
  event_id: string;
  batch_id: string;
  timestamp: string;
  headline: string;
  body: string;
  category: string;
  source: string;
  raw_sentiment_hint: string;
  regions: string[];
  keywords: string[];
  _live: boolean;
  _article_id?: string;
  _link?: string;
  _source_url?: string;
  fetched_at: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const NewsEventSchema = new Schema<INewsEvent>(
  {
    event_id: { type: String, required: true, unique: true, index: true },
    batch_id: { type: String, required: true, index: true },
    timestamp: { type: String, required: true },
    headline: { type: String, required: true },
    body: { type: String, default: "" },
    category: { type: String, required: true },
    source: { type: String, default: "Unknown" },
    raw_sentiment_hint: { type: String, default: "neutral" },
    regions: { type: [String], default: [] },
    keywords: { type: [String], default: [] },
    _live: { type: Boolean, default: true },
    _article_id: { type: String, index: true },
    _link: { type: String },
    _source_url: { type: String },
    fetched_at: { type: Date, default: Date.now, index: true },
  },
  {
    collection: "news_events",
    timestamps: true, // adds createdAt, updatedAt
  }
);

const NewsEventModel = mongoose.model<INewsEvent>("NewsEvent", NewsEventSchema);

export default NewsEventModel;
