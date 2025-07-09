const express = require('express');
const router = express.Router();
const { db } = require('../database');
const bcrypt = require('bcrypt');

// Helper: hash password
const hashPassword = async (password) => {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
};

// Helper: compare password
const comparePassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

// SIGN UP
router.post('/signup', async (req, res) => {
  const { name, email, password, nationality, currently_in_egypt, date_of_arrival, date_of_leaving } = req.body;
  if (!name || !email || !password || !nationality || currently_in_egypt === undefined) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  try {
    const hashedPassword = await hashPassword(password);
    let in_risk = null;
    let arrival = null;
    let leaving = null;
    let history = JSON.stringify([]);
    if (currently_in_egypt) {
      arrival = date_of_arrival || null;
      leaving = date_of_leaving || null;
      in_risk = 0;
    }
    db.run(
      `INSERT INTO customers (email, name, password, nationality, currently_in_egypt, in_risk, date_of_arrival, date_of_leaving, customer_history) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [email, name, hashedPassword, nationality, currently_in_egypt ? 1 : 0, in_risk, arrival, leaving, history],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'Email already exists.' });
          }
          return res.status(500).json({ error: 'Database error.' });
        }
        res.status(201).json({ message: 'Customer created.', id: this.lastID });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// SIGN IN
router.post('/signin', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password.' });
  }
  db.get('SELECT * FROM customers WHERE email = ?', [email], async (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (!row) return res.status(404).json({ error: 'Customer not found.' });
    const match = await comparePassword(password, row.password);
    if (!match) return res.status(401).json({ error: 'Wrong password.' });
    res.json({ message: 'Sign in successful.', customer: {
      id: row.id,
      email: row.email,
      name: row.name,
      nationality: row.nationality,
      currently_in_egypt: !!row.currently_in_egypt,
      in_risk: !!row.in_risk,
      date_of_arrival: row.date_of_arrival,
      date_of_leaving: row.date_of_leaving,
      customer_history: JSON.parse(row.customer_history || '[]')
    }});
  });
});

module.exports = router; 