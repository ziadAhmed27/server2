const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure upload storage
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${uuidv4()}${ext}`);
    }
});
const upload = multer({ storage });

// Request tracking
const placeRequests = {};
const priceRequests = {};

// Place Recognition Endpoints
app.post('/api/recognize-place', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image provided' });
        }

        const requestId = uuidv4();
        const imageUrl = `/uploads/${req.file.filename}`;

        placeRequests[requestId] = {
            image_path: req.file.path,
            image_url: imageUrl,
            status: 'processing',
            label: null,
            timestamp: Date.now()
        };

        // Wait for processing with timeout (30 seconds)
        const startTime = Date.now();
        const timeout = 30000;
        
        while (placeRequests[requestId].status === 'processing' && 
               Date.now() - startTime < timeout) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (placeRequests[requestId].status === 'done') {
            res.json({
                status: 'success',
                request_id: requestId,
                label: placeRequests[requestId].label,
                image_url: imageUrl
            });
        } else {
            res.status(504).json({
                status: 'timeout',
                request_id: requestId,
                message: 'Processing took too long'
            });
        }
    } catch (error) {
        console.error('Error processing place recognition:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/recognize-place/pending', (req, res) => {
    const pending = Object.entries(placeRequests)
        .filter(([, req]) => req.status === 'processing')
        .map(([id, req]) => ({
            request_id: id,
            image_url: req.image_url,
            timestamp: req.timestamp
        }));
    res.json(pending);
});

app.post('/api/recognize-place/result', (req, res) => {
    const { request_id, label } = req.body;
    
    if (!request_id || !label || !placeRequests[request_id]) {
        return res.status(400).json({ error: 'Invalid request' });
    }

    placeRequests[requestId].status = 'done';
    placeRequests[requestId].label = label;
    
    res.json({ success: true });
});

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

        // Wait for processing with timeout (30 seconds)
        const startTime = Date.now();
        const timeout = 30000;
        
        while (priceRequests[requestId].status === 'processing' && 
               Date.now() - startTime < timeout) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (priceRequests[requestId].status === 'done') {
            res.json({
                status: 'success',
                request_id: requestId,
                result: priceRequests[requestId].result,
                image_url: imageUrl
            });
        } else {
            res.status(504).json({
                status: 'timeout',
                request_id: requestId,
                message: 'Processing took too long'
            });
        }
    } catch (error) {
        console.error('Error processing price check:', error);
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

    priceRequests[requestId].status = 'done';
    priceRequests[requestId].result = result;
    
    res.json({ success: true });
});

// Cleanup old requests
setInterval(() => {
    const now = Date.now();
    for (const [id, req] of Object.entries(placeRequests)) {
        if (now - req.timestamp > 3600000) { // 1 hour
            try {
                fs.unlinkSync(req.image_path);
                delete placeRequests[id];
            } catch (err) {
                console.error('Error cleaning up place request:', err);
            }
        }
    }
    for (const [id, req] of Object.entries(priceRequests)) {
        if (now - req.timestamp > 3600000) { // 1 hour
            try {
                fs.unlinkSync(req.image_path);
                delete priceRequests[id];
            } catch (err) {
                console.error('Error cleaning up price request:', err);
            }
        }
    }
}, 3600000);

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Upload directory: ${uploadDir}`);
});