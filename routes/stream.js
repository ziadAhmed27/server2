const express = require('express');
const router = express.Router();
const multer = require('multer');
const streamBuffers = {};

// Multer setup for receiving multipart/form-data (JPEG frames)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// POST endpoint for ESP32 to upload JPEG frames
router.post('/:customerId/frame', upload.single('frame'), (req, res) => {
  const { customerId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'No frame uploaded.' });
  // Store the latest frame in memory
  streamBuffers[customerId] = req.file.buffer;
  res.json({ status: 'Frame received.' });
});

// GET endpoint for browser to view MJPEG stream
router.get('/:customerId', (req, res) => {
  const { customerId } = req.params;
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache',
    'Connection': 'close',
    'Pragma': 'no-cache',
  });

  const interval = setInterval(() => {
    const frame = streamBuffers[customerId];
    if (frame) {
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      res.write(frame);
      res.write('\r\n');
    }
  }, 100);

  req.on('close', () => {
    clearInterval(interval);
  });
});

module.exports = router; 