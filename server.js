const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { initDb } = require('./database');
const customerRoutes = require('./routes/customers');
const multer = require('multer');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

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
  const pythonProcess = spawn('python', ['IOT_py/Arabic_to_Engish_talking.py', imagePath]);
  let output = '';
  pythonProcess.stdout.on('data', (data) => {
    output += data.toString();
  });
  pythonProcess.stderr.on('data', (data) => {
    console.error('Python error:', data.toString());
  });
  pythonProcess.on('close', (code) => {
    // Optionally delete the uploaded file after processing
    // fs.unlinkSync(imagePath);
    res.json({ translation: output.trim() });
  });
});

app.get('/', (req, res) => {
  res.send('Server is running.');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 