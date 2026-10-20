import { mongo } from 'mongoose';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isDuplicate(error: unknown) {
  return error instanceof mongo.MongoServerError && error.code === 11000;
}
