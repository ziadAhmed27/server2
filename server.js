const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced Configuration
const config = {
    uploadDir: path.join(__dirname, 'uploads'),
    requestTimeout: 60000, // 60 seconds
    cleanupInterval: 3600000, // 1 hour
    maxFileSize: 5 * 1024 * 1024, // 5MB
    allowedFileTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxRequests: 1000 // Maximum requests to keep in memory
};

// Ensure upload directory exists
if (!fs.existsSync(config.uploadDir)) {
    fs.mkdirSync(config.uploadDir, { recursive: true });
}

// Middleware with enhanced security
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use('/uploads', express.static(config.uploadDir));

// Configure upload storage with enhanced validation
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, config.uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        cb(null, `${uuidv4()}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    if (config.allowedFileTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`Invalid file type. Only ${config.allowedFileTypes.join(', ')} are allowed`), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: config.maxFileSize,
        files: 1
    }
});

// Request tracking with size limits
const requestStores = {
    place: new Map(),
    price: new Map(),
    translation: new Map()
};

// Helper functions
const cleanupOldRequests = () => {
    const now = Date.now();
    const cleanup = (store) => {
        for (const [id, req] of store) {
            if (now - req.timestamp > config.cleanupInterval || store.size > config.maxRequests) {
                try {
                    if (req.image_path && fs.existsSync(req.image_path)) {
                        fs.unlinkSync(req.image_path);
                    }
                    store.delete(id);
                } catch (err) {
                    console.error('Cleanup error:', err);
                }
            }
        }
    };

    cleanup(requestStores.place);
    cleanup(requestStores.price);
    cleanup(requestStores.translation);
};

// ========== Place Recognition Endpoints ==========
app.post('/api/recognize-place', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                error: 'No image provided',
                details: 'Please upload a valid image file'
            });
        }

        const requestId = uuidv4();
        const imageUrl = `/uploads/${req.file.filename}`;

        requestStores.place.set(requestId, {
            image_path: req.file.path,
            image_url: imageUrl,
            status: 'processing',
            label: null,
            timestamp: Date.now()
        });

        // Immediate response with request details
        res.json({
            status: 'processing',
            request_id: requestId,
            image_url: imageUrl
        });

    } catch (error) {
        console.error('Place recognition error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

app.post('/api/recognize-place/result', express.json(), (req, res) => {
    try {
        const { request_id, label } = req.body;
        
        if (!request_id || !label || !requestStores.place.get(request_id)) {
            return res.status(400).json({ error: 'Invalid request data' });
        }

        const request = requestStores.place.get(request_id);
        request.status = 'done';
        request.label = label;
        
        res.json({ success: true });
    } catch (error) {
        console.error('Result update error:', error);
        res.status(500).json({ error: 'Failed to update result' });
    }
});

// ========== Price Check Endpoints ==========
app.post('/api/check-price', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                error: 'No image provided',
                details: 'Please upload a valid image file'
            });
        }

        const requestId = uuidv4();
        const imageUrl = `/uploads/${req.file.filename}`;

        requestStores.price.set(requestId, {
            image_path: req.file.path,
            image_url: imageUrl,
            status: 'processing',
            result: null,
            timestamp: Date.now()
        });

        // Immediate response with request details
        res.json({
            status: 'processing',
            request_id: requestId,
            image_url: imageUrl
        });

    } catch (error) {
        console.error('Price check error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

app.post('/api/check-price/result', express.json(), (req, res) => {
    try {
        const { request_id, result } = req.body;
        
        if (!request_id || !result || !requestStores.price.get(request_id)) {
            return res.status(400).json({ error: 'Invalid request data' });
        }

        const request = requestStores.price.get(request_id);
        request.status = 'done';
        request.result = result;
        
        res.json({ success: true });
    } catch (error) {
        console.error('Result update error:', error);
        res.status(500).json({ error: 'Failed to update result' });
    }
});

// ========== Translation Endpoints ==========
app.post('/api/translate', express.json(), (req, res) => {
    try {
        if (!req.is('application/json')) {
            return res.status(400).json({ 
                error: 'Invalid content type',
                details: 'Content-Type must be application/json' 
            });
        }

        const { text } = req.body;
        
        // Enhanced Arabic text validation
        const arabicRegex = /[\u0600-\u06FF]/;
        if (!text || typeof text !== 'string' || !arabicRegex.test(text)) {
            return res.status(400).json({ 
                error: 'Invalid Arabic text input',
                details: 'Text must contain valid Arabic characters'
            });
        }

        const requestId = uuidv4();
        requestStores.translation.set(requestId, {
            text_input: text.trim(),
            status: 'processing',
            result: null,
            timestamp: Date.now(),
            attempts: 0
        });

        // Immediate response with request details
        res.json({
            status: 'processing',
            request_id: requestId,
            message: 'Translation request accepted'
        });

    } catch (error) {
        console.error('Translation request error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

app.post('/api/translate/result', express.json(), (req, res) => {
    try {
        const { request_id, arabic_text, english_translation, error } = req.body;
        
        if (!requestStores.translation.get(request_id)) {
            return res.status(404).json({ 
                error: 'Invalid request',
                details: 'Request not found' 
            });
        }

        const request = requestStores.translation.get(request_id);
        
        if (error) {
            // Handle translation errors
            request.attempts = (request.attempts || 0) + 1;
            request.status = 'failed';
            request.result = { error };
            
            return res.json({ 
                success: false,
                attempts: request.attempts 
            });
        }

        if (!arabic_text) {
            return res.status(400).json({ 
                error: 'Invalid result',
                details: 'Missing arabic_text in result' 
            });
        }

        request.status = 'done';
        request.result = {
            arabic_text: arabic_text,
            english_translation: english_translation || ''
        };
        
        res.json({ success: true });

    } catch (error) {
        console.error('Result update error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

// Worker endpoint to get pending translations
app.get('/api/translate/pending', (req, res) => {
    try {
        const pending = [];
        requestStores.translation.forEach((req, id) => {
            if (req.status === 'processing' && req.attempts < 3) {
                pending.push({
                    request_id: id,
                    text_input: req.text_input,
                    timestamp: req.timestamp,
                    attempts: req.attempts || 0
                });
            }
        });
        res.json(pending);
    } catch (error) {
        console.error('Pending translations error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

// Cleanup old requests
setInterval(cleanupOldRequests, config.cleanupInterval);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { details: err.message })
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Upload directory: ${config.uploadDir}`);
    console.log('Available endpoints:');
    console.log('- POST   /api/recognize-place');
    console.log('- POST   /api/recognize-place/result');
    console.log('- POST   /api/check-price');
    console.log('- POST   /api/check-price/result');
    console.log('- POST   /api/translate');
    console.log('- GET    /api/translate/pending (worker only)');
    console.log('- POST   /api/translate/result (worker only)');
});