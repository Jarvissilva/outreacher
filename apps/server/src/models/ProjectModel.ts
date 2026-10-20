import mongoose, { Schema } from 'mongoose';

const projectSchema = new Schema(
  {
    name: { type: String, required: true },
    normalizedName: { type: String, required: true, unique: true },
    hourlyLimit: { type: Number, default: 60 },
    timeZone: { type: String, default: 'UTC' },
    nextSendAt: { type: Date, default: () => new Date(0) },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);
projectSchema.index(
  { isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);

export const ProjectModel = mongoose.model('Project', projectSchema);
