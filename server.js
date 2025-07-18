const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { initDb } = require('./database');
const customerRoutes = require('./routes/customers');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Initialize DB
initDb();

// Routes
app.use('/api/customers', customerRoutes);

const upload = multer({ dest: 'uploads/' });

app.post('/api/translate-image', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded.' });
  }
  const imagePath = req.file.path;
  const pythonProcess = spawn('python3', ['IOT_py/arabic_to_english_cli.py', imagePath]);
  let output = '';
  let errorOutput = '';
  pythonProcess.stdout.on('data', (data) => {
    output += data.toString();
  });
  pythonProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });
  pythonProcess.on('close', (code) => {
    fs.unlink(imagePath, () => {});
    if (code === 0) {
      res.json({ translation: output.trim() });
    } else {
      res.status(500).json({ error: errorOutput.trim() || 'Translation failed.' });
    }
  });
});

app.post('/api/recognize-place', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded.' });
  }
  const imagePath = req.file.path;
  // Use absolute path to the CLI script
  const scriptPath = path.join(__dirname, 'IOT_py', 'nigger_lib', 'New folder', 'New folder', 'place_recognizer_cli.py');
  const pythonProcess = spawn('python3', [scriptPath, imagePath]);
  let output = '';
  let errorOutput = '';
  pythonProcess.stdout.on('data', (data) => {
    output += data.toString();
  });
  pythonProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });
  pythonProcess.on('close', (code) => {
    fs.unlink(imagePath, () => {});
    if (code === 0) {
      // Output: first line is label, rest is description
      const [label, ...descLines] = output.trim().split('\n');
      res.json({ label: label.trim(), description: descLines.join('\n').trim() });
    } else {
      res.status(500).json({ error: errorOutput.trim() || 'Recognition failed.' });
    }
  });
});

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

app.get('/', (req, res) => {
  res.send('Server is running.');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 