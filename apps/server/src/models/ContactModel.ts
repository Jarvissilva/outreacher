import mongoose, { Schema } from 'mongoose';

const contactSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    company: { type: String, default: '' },
    phone: { type: String, default: '' },
    website: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    country: { type: String, default: '' },
    source: { type: String, default: '' },
    notes: { type: String, default: '' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    customFields: {
      type: Map,
      of: String,
      default: () => new Map<string, string>(),
    },
    suppressed: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
contactSchema.index({ projectId: 1, email: 1 }, { unique: true });
contactSchema.index({ projectId: 1, deletedAt: 1, createdAt: -1, _id: -1 });

export const ContactModel = mongoose.model('Contact', contactSchema);
export type ContactDocument = InstanceType<typeof ContactModel>;

export function serializeContact(contact: ContactDocument) {
  return {
    id: contact._id.toString(),
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    company: contact.company,
    phone: contact.phone,
    website: contact.website,
    city: contact.city,
    state: contact.state,
    country: contact.country,
    source: contact.source,
    notes: contact.notes,
    projectId: String(contact.projectId),
    customFields: Object.fromEntries(contact.customFields),
    suppressed: contact.suppressed,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}
