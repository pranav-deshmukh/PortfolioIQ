import mongoose, { Schema, Document } from "mongoose";

export interface IMacroData extends Document {
  macro_insights: Record<string, unknown>;
  fetched_at: Date;
}

const MacroDataSchema = new Schema<IMacroData>(
  {
    macro_insights: {
      type: Schema.Types.Mixed,
      required: true,
    },
    fetched_at: { type: Date, default: Date.now, index: true },
  },
  {
    collection: "macro_data",
    timestamps: true,
  }
);

const MacroDataModel = mongoose.model<IMacroData>("MacroData", MacroDataSchema);

export default MacroDataModel;
