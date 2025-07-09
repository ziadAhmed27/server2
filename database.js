const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'customers.db');
const db = new sqlite3.Database(dbPath);

function initDb() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password TEXT NOT NULL,
      nationality TEXT NOT NULL,
      currently_in_egypt INTEGER NOT NULL,
      in_risk INTEGER,
      date_of_arrival TEXT,
      date_of_leaving TEXT,
      customer_history TEXT
    )`);
  });
}

module.exports = { db, initDb }; 