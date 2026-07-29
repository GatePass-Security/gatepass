import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://localhost:27017');
const db = client.db('helpdesk');

export const collections = {
  tickets: db.collection('tickets'),
  users: db.collection('users'),
};
