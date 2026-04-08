import mongoose, { Schema, Document } from "mongoose";

export interface INewsEvent extends Document {
  article_id?: string;
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string;
  source_id?: string;
  source_name?: string;
  language?: string;
  country?: string[];
  category?: string[];
  keywords?: string[];
  ai_tag?: string;
  raw: Record<string, unknown>;
  fetched_at: Date;
}

const NewsEventSchema = new Schema<INewsEvent>(
  {
    article_id: { type: String, index: true },
    title: { type: String },
    description: { type: String },
    link: { type: String },
    pubDate: { type: String },
    source_id: { type: String },
    source_name: { type: String },
    language: { type: String },
    country: { type: [String], default: [] },
    category: { type: [String], default: [] },
    keywords: { type: [String], default: [] },
    ai_tag: { type: String },
    raw: { type: Schema.Types.Mixed, required: true },
    fetched_at: { type: Date, default: Date.now, index: true },
  },
  {
    collection: "news_events",
    timestamps: true,
  }
);

NewsEventSchema.index(
  { article_id: 1, source_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      article_id: { $exists: true },
      source_id: { $exists: true },
    },
  }
);

const NewsEventModel = mongoose.model<INewsEvent>("NewsEvent", NewsEventSchema);

export default NewsEventModel;
