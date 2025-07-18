const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { initDb } = require('./database');
const customerRoutes = require('./routes/customers');
const multer = require('multer');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const Stream = require('node-rtsp-stream');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Create WebSocket server
const wss = new WebSocket.Server({ port: 9999 });

// Store active streams
const activeStreams = new Map();
const streamSessions = new Map();

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
  const pythonProcess = spawn('python', ['IOT_py/arabic_to_english_cli.py', imagePath]);
  let output = '';
  let errorOutput = '';
  pythonProcess.stdout.on('data', (data) => {
    output += data.toString();
  });
  pythonProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });
  pythonProcess.on('close', (code) => {
    // Delete the uploaded file after processing
    fs.unlink(imagePath, () => {});
    if (code === 0) {
      res.json({ translation: output.trim() });
    } else {
      res.status(500).json({ error: errorOutput.trim() || 'Translation failed.' });
    }
  });
});

// RTSP Stream Management Endpoints

// Start a new RTSP stream
app.post('/api/streams/start', (req, res) => {
  const { rtspUrl, streamName } = req.body;
  
  if (!rtspUrl) {
    return res.status(400).json({ error: 'RTSP URL is required' });
  }

  const streamId = streamName || uuidv4();
  
  // Check if stream already exists
  if (activeStreams.has(streamId)) {
    return res.status(400).json({ error: 'Stream already exists', streamId });
  }

  try {
    // Create new stream with better error handling
    const stream = new Stream({
      name: streamId,
      streamUrl: rtspUrl,
      wsPort: 9999,
      ffmpegOptions: {
        '-stats': '', // Enable stats
        '-r': 30, // Frame rate
        '-q:v': 3, // Video quality
        '-reconnect': '1', // Reconnect on connection loss
        '-reconnect_at_eof': '1',
        '-reconnect_streamed': '1',
        '-reconnect_delay_max': '2', // Max 2 seconds delay
      }
    });

    // Handle stream errors
    stream.on('error', (error) => {
      console.error(`Stream error for ${streamId}:`, error);
      if (activeStreams.has(streamId)) {
        const streamData = activeStreams.get(streamId);
        streamData.status = 'error';
        streamData.lastError = error.message;
      }
    });

    // Handle stream start
    stream.on('start', () => {
      console.log(`Stream started successfully: ${streamId}`);
      if (activeStreams.has(streamId)) {
        const streamData = activeStreams.get(streamId);
        streamData.status = 'active';
        streamData.lastError = null;
      }
    });

    activeStreams.set(streamId, {
      stream,
      rtspUrl,
      createdAt: new Date(),
      status: 'connecting',
      lastError: null,
      clientInfo: req.headers['user-agent'] || 'Unknown'
    });

    console.log(`Starting RTSP stream: ${streamId} from ${rtspUrl}`);
    res.json({ 
      success: true, 
      streamId, 
      message: 'Stream started successfully',
      wsUrl: `ws://${req.get('host').replace(/:\d+$/, '')}:9999/${streamId}`,
      status: 'connecting'
    });

  } catch (error) {
    console.error('Error starting stream:', error);
    res.status(500).json({ error: 'Failed to start stream', details: error.message });
  }
});

// Stop a stream
app.post('/api/streams/stop/:streamId', (req, res) => {
  const { streamId } = req.params;
  
  if (!activeStreams.has(streamId)) {
    return res.status(404).json({ error: 'Stream not found' });
  }

  try {
    const streamData = activeStreams.get(streamId);
    streamData.stream.stop();
    activeStreams.delete(streamId);
    
    console.log(`Stopped RTSP stream: ${streamId}`);
    res.json({ success: true, message: 'Stream stopped successfully' });

  } catch (error) {
    console.error('Error stopping stream:', error);
    res.status(500).json({ error: 'Failed to stop stream', details: error.message });
  }
});

// List all active streams
app.get('/api/streams', (req, res) => {
  const streams = Array.from(activeStreams.entries()).map(([streamId, data]) => ({
    streamId,
    rtspUrl: data.rtspUrl,
    status: data.status,
    createdAt: data.createdAt,
    wsUrl: `ws://localhost:9999/${streamId}`
  }));
  
  res.json({ streams });
});

// Get stream status
app.get('/api/streams/:streamId', (req, res) => {
  const { streamId } = req.params;
  
  if (!activeStreams.has(streamId)) {
    return res.status(404).json({ error: 'Stream not found' });
  }

  const streamData = activeStreams.get(streamId);
  res.json({
    streamId,
    rtspUrl: streamData.rtspUrl,
    status: streamData.status,
    createdAt: streamData.createdAt,
    lastError: streamData.lastError,
    clientInfo: streamData.clientInfo,
    wsUrl: `ws://${req.get('host').replace(/:\d+$/, '')}:9999/${streamId}`,
    uptime: Date.now() - streamData.createdAt.getTime()
  });
});

// Health check endpoint for Flutter apps
app.get('/api/streams/:streamId/health', (req, res) => {
  const { streamId } = req.params;
  
  if (!activeStreams.has(streamId)) {
    return res.status(404).json({ 
      healthy: false, 
      error: 'Stream not found',
      timestamp: new Date().toISOString()
    });
  }

  const streamData = activeStreams.get(streamId);
  const isHealthy = streamData.status === 'active' && !streamData.lastError;
  
  res.json({
    healthy: isHealthy,
    status: streamData.status,
    lastError: streamData.lastError,
    uptime: Date.now() - streamData.createdAt.getTime(),
    timestamp: new Date().toISOString()
  });
});

// Record stream to file
app.post('/api/streams/:streamId/record', (req, res) => {
  const { streamId } = req.params;
  const { duration = 60, outputPath } = req.body; // duration in seconds
  
  if (!activeStreams.has(streamId)) {
    return res.status(404).json({ error: 'Stream not found' });
  }

  const streamData = activeStreams.get(streamId);
  const fileName = outputPath || `recording_${streamId}_${Date.now()}.mp4`;
  const filePath = path.join(__dirname, 'recordings', fileName);

  // Create recordings directory if it doesn't exist
  if (!fs.existsSync(path.join(__dirname, 'recordings'))) {
    fs.mkdirSync(path.join(__dirname, 'recordings'));
  }

  try {
    const command = ffmpeg(streamData.rtspUrl)
      .outputOptions([
        '-c:v copy',
        '-c:a copy',
        '-t', duration.toString()
      ])
      .output(filePath)
      .on('end', () => {
        console.log(`Recording completed: ${fileName}`);
      })
      .on('error', (err) => {
        console.error('Recording error:', err);
      });

    command.run();
    
    res.json({ 
      success: true, 
      message: 'Recording started',
      fileName,
      duration: `${duration} seconds`
    });

  } catch (error) {
    console.error('Error starting recording:', error);
    res.status(500).json({ error: 'Failed to start recording', details: error.message });
  }
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const streamId = req.url.substring(1); // Remove leading slash
  
  if (!activeStreams.has(streamId)) {
    ws.close();
    return;
  }

  // Store WebSocket connection
  if (!streamSessions.has(streamId)) {
    streamSessions.set(streamId, new Set());
  }
  streamSessions.get(streamId).add(ws);

  console.log(`WebSocket client connected to stream: ${streamId}`);

  ws.on('close', () => {
    if (streamSessions.has(streamId)) {
      streamSessions.get(streamId).delete(ws);
      if (streamSessions.get(streamId).size === 0) {
        streamSessions.delete(streamId);
      }
    }
    console.log(`WebSocket client disconnected from stream: ${streamId}`);
  });
});

app.get('/', (req, res) => {
  res.send('Server is running.');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server running on port 9999`);
}); 