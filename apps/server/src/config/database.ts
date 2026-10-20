import mongoose from 'mongoose';

mongoose.set('bufferCommands', false);
// The startup migration creates scoped indexes before removing legacy indexes.
mongoose.set('autoIndex', false);

export async function connectDatabase(
  uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/outreachit',
) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
