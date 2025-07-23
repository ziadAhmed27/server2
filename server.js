const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { initDb } = require('./database');
const customerRoutes = require('./routes/customers');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Initialize DB
initDb();

// Routes
app.use('/api/customers', customerRoutes);

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  }
});

const upload = multer({ storage: storage });

// In-memory request tracking
const placeRequests = {};
const priceRequests = {};

// ---------------------------
// Place Recognition Endpoints
// ---------------------------
app.post('/api/recognize-place', upload.single('image'), (req, res) => {
  const userId = req.body.user_id;
  if (!req.file || !userId) {
    return res.status(400).json({ error: 'Missing image or user_id' });
  }

  const requestId = uuidv4();
  const imageUrl = `/uploads/${req.file.filename}`;

  placeRequests[requestId] = {
    user_id: userId,
    image_path: req.file.path,
    image_url: imageUrl,
    status: 'pending',
    label: null
  };

<<<<<<< HEAD
  res.json({ 
    request_id: requestId, 
    status: 'pending',
    image_url: imageUrl
  });
=======
  // Wait up to 15 seconds for result from the C++ app
  const maxWaitTimeMs = 50000;
  const pollIntervalMs = 500;

  const waitForResult = () => {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const elapsed = Date.now() - start;
        const current = placeRequests[requestId];
        if (current && current.status === 'done' && current.label) {
          resolve({ status: 'done', label: current.label });
        } else if (elapsed >= maxWaitTimeMs) {
          resolve({ status: 'pending', message: 'Timed out waiting for result.' });
        } else {
          setTimeout(check, pollIntervalMs);
        }
      };
      check();
    });
  };

  const result = await waitForResult();
  res.json({ request_id: requestId, ...result });
>>>>>>> 317415444ab64308b542c6a0ac409f2d313ad0e4
});

app.get('/api/recognize-place/pending', (req, res) => {
  const pending = Object.entries(placeRequests)
    .filter(([, request]) => request.status === 'pending')
    .map(([id, request]) => ({
      request_id: id,
      image_url: request.image_url,
      image_path: request.image_path
    }));
  res.json(pending);
});

app.post('/api/recognize-place/result', (req, res) => {
  const { request_id, label } = req.body;
  if (!request_id || !label || !placeRequests[request_id]) {
    return res.status(400).json({ error: 'Invalid request_id or label' });
  }
  
  placeRequests[request_id].status = 'done';
  placeRequests[request_id].label = label;
  
  res.json({ success: true });
});

app.get('/api/recognize-place/status', (req, res) => {
  const { request_id } = req.query;
  if (!request_id || !placeRequests[request_id]) {
    return res.status(404).json({ error: 'Request not found' });
  }
  
  const { status, label, image_url } = placeRequests[request_id];
  res.json({ status, label, image_url });
});

// ---------------------------
// Price Check Endpoints
// ---------------------------
app.post('/api/check-price', upload.single('image'), (req, res) => {
  const userId = req.body.user_id;
  if (!req.file || !userId) {
    return res.status(400).json({ error: 'Missing image or user_id' });
  }

  const requestId = uuidv4();
  const imageUrl = `/uploads/${req.file.filename}`;

  priceRequests[requestId] = {
    user_id: userId,
    image_path: req.file.path,
    image_url: imageUrl,
    status: 'pending',
    result: null
  };

  res.json({ 
    request_id: requestId, 
    status: 'pending',
    image_url: imageUrl
  });
});

app.get('/api/check-price/pending', (req, res) => {
  const pending = Object.entries(priceRequests)
    .filter(([, request]) => request.status === 'pending')
    .map(([id, request]) => ({
      request_id: id,
      image_url: request.image_url,
      image_path: request.image_path
    }));
  res.json(pending);
});

app.post('/api/check-price/result', (req, res) => {
  const { request_id, result } = req.body;
  if (!request_id || !result || !priceRequests[request_id]) {
    return res.status(400).json({ error: 'Invalid request_id or result' });
  }
  
  priceRequests[request_id].status = 'done';
  priceRequests[request_id].result = result;
  
  res.json({ success: true });
});

app.get('/api/check-price/status', (req, res) => {
  const { request_id } = req.query;
  if (!request_id || !priceRequests[request_id]) {
    return res.status(404).json({ error: 'Request not found' });
  }
  
  const { status, result, image_url } = priceRequests[request_id];
  res.json({ status, result, image_url });
});

// ---------------------------
// Server Status Endpoint
// ---------------------------
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    services: {
      place_recognition: true,
      price_check: true
    },
    uptime: process.uptime()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Upload directory: ${uploadDir}`);
});