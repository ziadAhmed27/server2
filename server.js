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

// Upload directory
const uploadDir = path.join(__dirname, 'uploads', 'place_recognition');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

// In-memory request tracking
const placeRequests = {};

// ✅ Modified endpoint: waits for C++ AI result before responding
app.post('/api/recognize-place', upload.single('image'), async (req, res) => {
  const userId = req.body.user_id;
  if (!req.file || !userId) {
    return res.status(400).json({ error: 'Missing image or user_id' });
  }

  const ext = path.extname(req.file.originalname) || '.jpg';
  const requestId = uuidv4();
  const filename = `${userId}_${Date.now()}_${requestId}${ext}`;
  const destPath = path.join(uploadDir, filename);
  fs.renameSync(req.file.path, destPath);

  const imageUrl = `/uploads/place_recognition/${filename}`;

  placeRequests[requestId] = {
    user_id: userId,
    image_path: destPath,
    image_url: imageUrl,
    status: 'pending',
    label: null
  };

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
});

// Called by C++ client to post back AI result
app.post('/api/recognize-place/result', (req, res) => {
  const { request_id, label } = req.body;
  if (!request_id || !label || !placeRequests[request_id]) {
    return res.status(400).json({ error: 'Invalid request_id or label' });
  }

  placeRequests[request_id].status = 'done';
  placeRequests[request_id].label = label;

  res.json({ success: true });
});

// Get list of pending recognition tasks (called by C++ app)
app.get('/api/recognize-place/pending', (req, res) => {
  const pending = Object.entries(placeRequests)
    .filter(([, request]) => request.status === 'pending')
    .map(([id, request]) => ({
      request_id: id,
      image_url: request.image_url
    }));
  res.json(pending);
});

// User checks recognition status (not strictly required anymore)
app.get('/api/recognize-place/status', (req, res) => {
  const { request_id } = req.query;
  if (!request_id || !placeRequests[request_id]) {
    return res.status(404).json({ error: 'Request not found' });
  }
  const { status, label } = placeRequests[request_id];
  res.json({ status, label });
});

// Example: vegetable price prediction
app.post('/api/vegetable-price', upload.single('image'), (req, res) => {
  const scriptPath = path.join(__dirname, 'IOT_py', 'nigger_lib', 'Price Guide System', 'Price Guide System', 'price assistant', 'price_assistant_cli.py');
  let pythonProcess;
  let arg;
  if (req.file) {
    arg = req.file.path;
    pythonProcess = spawn('python3', [scriptPath, arg]);
  } else if (req.body && req.body.name) {
    arg = req.body.name;
    pythonProcess = spawn('python3', [scriptPath, arg]);
  } else {
    return res.status(400).json({ error: 'No image or name provided.' });
  }
  let output = '';
  let errorOutput = '';
  pythonProcess.stdout.on('data', (data) => {
    output += data.toString();
  });
  pythonProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });
  pythonProcess.on('close', (code) => {
    if (req.file) fs.unlink(arg, () => {});
    if (code === 0) {
      res.json({ result: output.trim() });
    } else {
      res.status(500).json({ error: errorOutput.trim() || 'Price lookup failed.' });
    }
  });
});

// Health check
app.get('/', (req, res) => {
  res.send('Server is running.');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
