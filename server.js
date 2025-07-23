const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const placeRequests = {};

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_WAIT_TIME = 30000; // 30 seconds

// Setup
app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static(UPLOAD_DIR));

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${uuidv4()}${ext}`);
    }
});
const upload = multer({ storage });

// Request tracking
const priceRequests = {};

// Price Check Endpoints
app.post('/api/check-price', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image provided' });
        }

        const requestId = uuidv4();
        const imageUrl = `/uploads/${req.file.filename}`;

        priceRequests[requestId] = {
            image_path: req.file.path,
            image_url: imageUrl,
            status: 'processing',
            result: null,
            timestamp: Date.now()
        };

        // Wait for processing with timeout
        const startTime = Date.now();
        while (priceRequests[requestId].status === 'processing' && 
               Date.now() - startTime < MAX_WAIT_TIME) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (priceRequests[requestId].status === 'done') {
            res.json({
                status: 'success',
                request_id: requestId,
                ...priceRequests[requestId].result
            });
        } else {
            res.status(504).json({
                status: 'timeout',
                request_id: requestId,
                message: 'Processing took too long'
            });
        }
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/check-price/pending', (req, res) => {
    const pending = Object.entries(priceRequests)
        .filter(([, req]) => req.status === 'processing')
        .map(([id, req]) => ({
            request_id: id,
            image_url: req.image_url,
            timestamp: req.timestamp
        }));
    res.json(pending);
});

app.post('/api/check-price/result', (req, res) => {
    const { request_id, result } = req.body;
    
    if (!request_id || !result || !priceRequests[request_id]) {
        return res.status(400).json({ error: 'Invalid request' });
    }

    priceRequests[request_id].status = 'done';
    priceRequests[request_id].result = result;
    
    res.json({ success: true });
});

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

    res.json({ 
        request_id: requestId, 
        status: 'pending',
        image_url: imageUrl
    });
});

app.get('/api/recognize-place/pending', (req, res) => {
    const pending = Object.entries(placeRequests)
        .filter(([, request]) => request.status === 'pending')
        .map(([id, request]) => ({
            request_id: id,
            image_url: request.image_url
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
    const { status, label } = placeRequests[request_id];
    res.json({ status, label });
});
// Cleanup old requests
setInterval(() => {
    const now = Date.now();
    for (const [id, req] of Object.entries(priceRequests)) {
        if (now - req.timestamp > 3600000) { // 1 hour
            delete priceRequests[id];
        }
    }
}, 3600000);

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Upload directory: ${UPLOAD_DIR}`);
});