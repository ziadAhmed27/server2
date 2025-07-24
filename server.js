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
    processingDir: path.join(__dirname, 'processing'),
    requestTimeout: 60000, // 60 seconds
    cleanupInterval: 3600000, // 1 hour
    maxFileSize: 5 * 1024 * 1024, // 5MB
    allowedFileTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/json'],
    maxRequests: 1000
};

// Ensure directories exist
[config.uploadDir, config.tempDir, config.processingDir].forEach(dir => {
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
app.use('/processing', express.static(config.processingDir));

// Configure upload storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, config.uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || 
                   (file.mimetype === 'application/json' ? '.json' : '.jpg');
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
                    if (req.file_path && fs.existsSync(req.file_path)) {
                        fs.unlinkSync(req.file_path);
                    }
                    if (req.processing_path && fs.existsSync(req.processing_path)) {
                        fs.unlinkSync(req.processing_path);
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

    // Cleanup old files in all directories
    [config.uploadDir, config.tempDir, config.processingDir].forEach(dir => {
        fs.readdir(dir, (err, files) => {
            if (err) return;
            files.forEach(file => {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                if (now - stat.mtimeMs > config.cleanupInterval) {
                    fs.unlinkSync(filePath);
                }
            });
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
app.post('/api/translate', async (req, res) => {
    try {
        // Check if request has file (multipart/form-data) or raw JSON (application/json)
        if (req.headers['content-type']?.startsWith('multipart/form-data')) {
            // Handle file upload
            upload.single('file')(req, res, async (err) => {
                if (err) {
                    return res.status(400).json({ 
                        error: 'File upload error',
                        details: err.message 
                    });
                }

                if (!req.file) {
                    return res.status(400).json({ 
                        error: 'No file provided',
                        details: 'Please upload a valid image or JSON file'
                    });
                }

                const requestId = uuidv4();
                const fileUrl = `/uploads/${req.file.filename}`;
                const processingPath = path.join(config.processingDir, `${requestId}${path.extname(req.file.filename)}`);
                
                // Move file to processing directory
                fs.renameSync(req.file.path, processingPath);

                requestStores.translation.set(requestId, {
                    file_path: req.file.path,
                    processing_path: processingPath,
                    file_url: fileUrl,
                    status: 'pending',
                    result: null,
                    timestamp: Date.now(),
                    input_type: req.file.mimetype === 'application/json' ? 'json_file' : 'image_file',
                    response: res // Store the response object
                });

                // Don't respond yet - we'll respond when processing is complete
            });
        } else {
            // Handle raw JSON input
            const { arabic_text } = req.body;
            
            if (!arabic_text) {
                return res.status(400).json({ 
                    error: 'No Arabic text provided',
                    details: 'Please provide arabic_text in the request body'
                });
            }

            const requestId = uuidv4();
            
            requestStores.translation.set(requestId, {
                file_path: null,
                processing_path: null,
                file_url: null,
                status: 'pending',
                result: null,
                timestamp: Date.now(),
                input_type: 'raw_text',
                arabic_text: arabic_text,
                response: res // Store the response object
            });

            // Don't respond yet - we'll respond when processing is complete
        }
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
            if (req.status === 'pending' && !req.response_sent) {
                pending.push({
                    request_id: id,
                    file_url: req.file_url,
                    processing_path: req.processing_path,
                    timestamp: req.timestamp,
                    input_type: req.input_type,
                    arabic_text: req.arabic_text
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

app.post('/api/translate/complete', express.json(), (req, res) => {
    try {
        const { request_id, arabic_text, english_translation } = req.body;
        
        if (!request_id || !requestStores.translation.get(request_id)) {
            return res.status(404).json({ 
                error: 'Invalid request',
                details: 'Request not found' 
            });
        }

        const request = requestStores.translation.get(request_id);
        request.status = 'completed';
        request.result = {
            arabic_text: arabic_text || request.arabic_text || '',
            english_translation: english_translation || ''
        };

        // Send the response to the original request
        request.response.json({
            status: 'completed',
            request_id: request_id,
            arabic_text: request.result.arabic_text,
            english_translation: request.result.english_translation,
            input_type: request.input_type
        });

        // Cleanup files if they exist
        if (request.file_path && fs.existsSync(request.file_path)) {
            fs.unlinkSync(request.file_path);
        }
        if (request.processing_path && fs.existsSync(request.processing_path)) {
            fs.unlinkSync(request.processing_path);
        }

        // Remove from store
        requestStores.translation.delete(request_id);
    } catch (error) {
        console.error('Translation complete error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

app.get('/api/translate/result/:requestId', (req, res) => {
    try {
        const requestId = req.params.requestId;
        const request = requestStores.translation.get(requestId);

        if (!request) {
            return res.status(404).json({ 
                error: 'Request not found',
                details: 'Invalid request ID or request expired' 
            });
        }

        if (request.status !== 'completed') {
            return res.json({
                status: request.status,
                request_id: requestId,
                message: 'Translation still in progress'
            });
        }

        res.json({
            status: 'completed',
            request_id: requestId,
            arabic_text: request.result.arabic_text,
            english_translation: request.result.english_translation,
            input_type: request.input_type
        });
    } catch (error) {
        console.error('Result check error:', error);
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
    console.log(`Processing directory: ${config.processingDir}`);
    console.log('Available endpoints:');
    console.log('- POST   /api/recognize-place');
    console.log('- GET    /api/recognize-place/pending');
    console.log('- POST   /api/recognize-place/result');
    console.log('- POST   /api/check-price');
    console.log('- GET    /api/check-price/pending');
    console.log('- POST   /api/check-price/result');
    console.log('- POST   /api/translate');
    console.log('- GET    /api/translate/pending');
    console.log('- POST   /api/translate/complete');
    console.log('- GET    /api/translate/result/:requestId');
});