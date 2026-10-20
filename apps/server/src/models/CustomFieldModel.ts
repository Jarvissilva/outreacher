import mongoose, { Schema } from 'mongoose';

const fieldSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    key: { type: String, required: true },
    label: { type: String, required: true },
  },
  { timestamps: true },
);

fieldSchema.index({ projectId: 1, key: 1 }, { unique: true });

export const FieldModel = mongoose.model('CustomField', fieldSchema);
