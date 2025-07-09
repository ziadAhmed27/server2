const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./database');
const customerRoutes = require('./routes/customers');
const streamRoutes = require('./routes/stream');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize DB
initDb();

// Routes
app.use('/api/customers', customerRoutes);
app.use('/api/stream', streamRoutes);

// Serve static files (for video stream viewing)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send('Server is running.');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 