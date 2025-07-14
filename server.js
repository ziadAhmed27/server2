const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { initDb } = require('./database');
const customerRoutes = require('./routes/customers');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize DB
initDb();

// Routes
app.use('/api/customers', customerRoutes);

app.get('/', (req, res) => {
  res.send('Server is running.');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 