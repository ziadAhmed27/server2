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
    tempDir: path.join(__dirname, 'temp'),
    requestTimeout: 60000, // 60 seconds
    cleanupInterval: 3600000, // 1 hour
    maxFileSize: 5 * 1024 * 1024, // 5MB
    allowedFileTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxRequests: 1000
};

// Ensure directories exist
[config.uploadDir, config.tempDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Middleware
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use('/uploads', express.static(config.uploadDir));

// Configure upload storage
const storage = multer.diskStorage({
    destination: config.uploadDir,
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

// Request tracking
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
                    if (req.temp_file_path && fs.existsSync(req.temp_file_path)) {
                        fs.unlinkSync(req.temp_file_path);
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

    // Cleanup old temp files
    fs.readdir(config.tempDir, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(config.tempDir, file);
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > config.cleanupInterval) {
                fs.unlinkSync(filePath);
            }
        });
    });
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

app.get('/api/recognize-place/pending', (req, res) => {
    try {
        const pending = [];
        requestStores.place.forEach((req, id) => {
            if (req.status === 'processing') {
                pending.push({
                    request_id: id,
                    image_url: req.image_url,
                    timestamp: req.timestamp
                });
            }
        });
        res.json(pending);
    } catch (error) {
        console.error('Pending requests error:', error);
        res.status(500).json({ error: 'Failed to get pending requests' });
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

app.get('/api/check-price/pending', (req, res) => {
    try {
        const pending = [];
        requestStores.price.forEach((req, id) => {
            if (req.status === 'processing') {
                pending.push({
                    request_id: id,
                    image_url: req.image_url,
                    timestamp: req.timestamp
                });
            }
        });
        res.json(pending);
    } catch (error) {
        console.error('Pending requests error:', error);
        res.status(500).json({ error: 'Failed to get pending requests' });
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
        const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
        
        if (!text || typeof text !== 'string' || !arabicRegex.test(text)) {
            return res.status(400).json({ 
                error: 'Invalid Arabic text input',
                details: 'Text must contain valid Arabic characters'
            });
        }

        const requestId = uuidv4();
        const tempFilePath = path.join(config.tempDir, `${requestId}.txt`);
        fs.writeFileSync(tempFilePath, text.trim(), 'utf8');

        requestStores.translation.set(requestId, {
            text_input: text.trim(),
            temp_file_path: tempFilePath,
            status: 'processing',
            result: null,
            timestamp: Date.now(),
            attempts: 0
        });

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

app.get('/api/translate/pending', (req, res) => {
    try {
        const pending = [];
        requestStores.translation.forEach((req, id) => {
            if (req.status === 'processing' && req.attempts < 3) {
                pending.push({
                    request_id: id,
                    temp_file_path: req.temp_file_path,
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
            request.attempts = (request.attempts || 0) + 1;
            if (request.attempts >= 3) {
                request.status = 'failed';
                request.result = { error: 'Max retries exceeded' };
                
                // Cleanup temp file
                if (request.temp_file_path && fs.existsSync(request.temp_file_path)) {
                    fs.unlinkSync(request.temp_file_path);
                }
            }
            return res.json({ success: false, attempts: request.attempts });
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
        
        // Cleanup temp file
        if (request.temp_file_path && fs.existsSync(request.temp_file_path)) {
            fs.unlinkSync(request.temp_file_path);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Result update error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

app.get('/api/translate/status/:requestId', (req, res) => {
    try {
        const requestId = req.params.requestId;
        const request = requestStores.translation.get(requestId);

        if (!request) {
            return res.status(404).json({ 
                error: 'Request not found',
                details: 'Invalid request ID or request expired' 
            });
        }

        res.json({
            status: request.status,
            request_id: requestId,
            ...(request.status === 'done' ? {
                arabic_text: request.result.arabic_text,
                english_translation: request.result.english_translation
            } : {
                message: request.status === 'failed' ? 
                    'Translation failed after maximum attempts' : 
                    'Translation in progress'
            })
        });
    } catch (error) {
        console.error('Status check error:', error);
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
    console.log(`Temp directory: ${config.tempDir}`);
    console.log('Available endpoints:');
    console.log('- POST   /api/recognize-place');
    console.log('- GET    /api/recognize-place/pending');
    console.log('- POST   /api/recognize-place/result');
    console.log('- POST   /api/check-price');
    console.log('- GET    /api/check-price/pending');
    console.log('- POST   /api/check-price/result');
    console.log('- POST   /api/translate');
    console.log('- GET    /api/translate/pending');
    console.log('- POST   /api/translate/result');
    console.log('- GET    /api/translate/status/:requestId');
});