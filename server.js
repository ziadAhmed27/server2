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
  // Path to the CLI script and model files
  const scriptPath = path.join('IOT_py', 'nigger_lib', 'New folder', 'New folder', 'place_recognizer_cli.py');
  const pythonProcess = spawn('python3', [scriptPath, imagePath], { cwd: path.dirname(scriptPath) });
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

app.get('/', (req, res) => {
  res.send('Server is running.');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 