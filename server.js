const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const config = {
    uploadDir: path.join(__dirname, 'uploads'),
    requestTimeout: 60000, // 30 seconds
    cleanupInterval: 3600000, // 1 hour
    maxFileSize: 5 * 1024 * 1024, // 5MB
    allowedFileTypes: ['image/jpeg', 'image/png', 'image/webp']
};

// Ensure upload directory exists
if (!fs.existsSync(config.uploadDir)) {
    fs.mkdirSync(config.uploadDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static(config.uploadDir));

// Configure upload storage with file validation
const storage = multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${uuidv4()}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    if (config.allowedFileTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: config.maxFileSize
    }
});

// Request tracking
const placeRequests = {};
const priceRequests = {};
const translationRequests = {};

// Helper functions
const validateRequest = (req, res, requiredFields = []) => {
    for (const field of requiredFields) {
        if (!req.body[field]) {
            return res.status(400).json({ error: `Missing required field: ${field}` });
        }
    }
    return null;
};

const cleanupOldRequests = () => {
    const now = Date.now();
    
    const cleanup = (requests) => {
        for (const [id, req] of Object.entries(requests)) {
            if (now - req.timestamp > config.cleanupInterval) {
                try {
                    if (req.image_path && fs.existsSync(req.image_path)) {
                        fs.unlinkSync(req.image_path);
                    }
                    delete requests[id];
                } catch (err) {
                    console.error('Cleanup error:', err);
                }
            }
        }
    };

    cleanup(placeRequests);
    cleanup(priceRequests);
    cleanup(translationRequests);
};

// ========== Place Recognition Endpoints ==========
app.post('/api/recognize-place', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image provided or invalid image format' });
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

        // Wait for processing with timeout
        const startTime = Date.now();
        
        while (placeRequests[requestId].status === 'processing' && 
               Date.now() - startTime < config.requestTimeout) {
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
            placeRequests[requestId].status = 'timeout';
            res.status(504).json({
                status: 'timeout',
                request_id: requestId,
                message: 'Processing took too long'
            });
        }
    } catch (error) {
        console.error('Error processing place recognition:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

app.get('/api/recognize-place/pending', (req, res) => {
    try {
        const pending = Object.entries(placeRequests)
            .filter(([, req]) => req.status === 'processing')
            .map(([id, req]) => ({
                request_id: id,
                image_url: req.image_url,
                timestamp: req.timestamp
            }));
        res.json(pending);
    } catch (error) {
        console.error('Error getting pending place requests:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/recognize-place/result', (req, res) => {
    try {
        const { request_id, label } = req.body;
        
        if (!request_id || !label || !placeRequests[request_id]) {
            return res.status(400).json({ error: 'Invalid request_id or label' });
        }

        placeRequests[request_id].status = 'done';
        placeRequests[request_id].label = label;
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating place recognition result:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========== Price Check Endpoints ==========
app.post('/api/check-price', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image provided or invalid image format' });
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
               Date.now() - startTime < config.requestTimeout) {
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
            priceRequests[requestId].status = 'timeout';
            res.status(504).json({
                status: 'timeout',
                request_id: requestId,
                message: 'Processing took too long'
            });
        }
    } catch (error) {
        console.error('Error processing price check:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

app.get('/api/check-price/pending', (req, res) => {
    try {
        const pending = Object.entries(priceRequests)
            .filter(([, req]) => req.status === 'processing')
            .map(([id, req]) => ({
                request_id: id,
                image_url: req.image_url,
                timestamp: req.timestamp
            }));
        res.json(pending);
    } catch (error) {
        console.error('Error getting pending price requests:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/check-price/result', (req, res) => {
    try {
        const { request_id, result } = req.body;
        
        if (!request_id || !result || !priceRequests[request_id]) {
            return res.status(400).json({ error: 'Invalid request_id or result' });
        }

        priceRequests[request_id].status = 'done';
        priceRequests[request_id].result = result;
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating price check result:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========== Translation Endpoints ==========
app.post('/api/translate', async (req, res) => {
    try {
        const requestId = uuidv4();
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'No text provided' });
        }

        translationRequests[requestId] = {
            text_input: text,
            status: 'processing',
            result: null,
            timestamp: Date.now()
        };

        const startTime = Date.now();
        const checkInterval = 500; // ms
        
        while (true) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            
            const request = translationRequests[requestId];
            
            if (request.status === 'done') {
                return res.json({
                    status: 'success',
                    request_id: requestId,
                    ...request.result
                });
            }
            
            if (Date.now() - startTime > config.requestTimeout) {
                request.status = 'timeout';
                return res.status(504).json({
                    status: 'timeout',
                    request_id: requestId,
                    message: 'Processing took too long'
                });
            }
        }
    } catch (error) {
        console.error('Translation error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

app.get('/api/translate/pending', (req, res) => {
    try {
        const pending = Object.entries(translationRequests)
            .filter(([, req]) => req.status === 'processing')
            .map(([id, req]) => ({
                request_id: id,
                text_input: req.text_input,
                timestamp: req.timestamp
            }));
        res.json(pending);
    } catch (error) {
        console.error('Error getting pending translation requests:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/translate/result', (req, res) => {
    try {
        const { request_id, arabic_text, english_translation } = req.body;
        
        if (!request_id || !arabic_text || !translationRequests[request_id]) {
            return res.status(400).json({ error: 'Invalid request' });
        }

        translationRequests[request_id].status = 'done';
        translationRequests[request_id].result = {
            arabic_text: arabic_text,
            english_translation: english_translation || ''
        };
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating translation result:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Cleanup old requests
setInterval(cleanupOldRequests, config.cleanupInterval);

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Upload directory: ${config.uploadDir}`);
});