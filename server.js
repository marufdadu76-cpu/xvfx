const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080; // 3000 থেকে 8080

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

app.use(cors());
app.use(express.json());

// /tmp use করুন — Railway-তে /app write protected হতে পারে
const uploadDir = '/tmp/uploads';
const outputDir = '/tmp/output';

[uploadDir, outputDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const sanitizeFilename = (filename) => {
  return filename
    .replace(/\s+/g, '_')
    .replace(/[()[\]{}]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
};

const safeUnlink = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn('Could not delete file:', filePath, err.message);
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const sanitized = sanitizeFilename(file.originalname);
    cb(null, Date.now() + '-' + sanitized);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.eps' || ext === '.ai') {
      cb(null, true);
    } else {
      cb(new Error('Only EPS and AI files allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.get('/', (req, res) => {
  res.json({
    message: 'EPS to PNG Converter API',
    version: '2.1.0',
    endpoints: {
      convert: 'POST /convert',
      health: 'GET /health'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/convert', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const inputPath = req.file.path;
  const baseName = path.basename(req.file.filename, path.extname(req.file.filename));
  const outputPath = path.join(outputDir, baseName + '.png');

  // DPI max 200 — memory বাঁচাতে
  const dpi = Math.min(parseInt(req.body.quality) || 150, 200);

  const escapedInput = inputPath.replace(/"/g, '\\"');
  const escapedOutput = outputPath.replace(/"/g, '\\"');

  // memory limit যোগ করা হয়েছে
  const cmd = `gs -dSAFER -dBATCH -dNOPAUSE -dEPSCrop -sDEVICE=png16m -dMaxBitmap=50000000 -r${dpi} -sOutputFile="${escapedOutput}" "${escapedInput}"`;

  console.log('Converting:', req.file.originalname, 'DPI:', dpi);

  exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => { // 30s timeout
    safeUnlink(inputPath);

    if (err) {
      console.error('Conversion error:', stderr || err.message);
      return res.status(500).json({ error: stderr || err.message });
    }

    if (!fs.existsSync(outputPath)) {
      return res.status(500).json({ error: 'Conversion failed - no output generated' });
    }

    console.log('Conversion successful:', outputPath);
    res.download(outputPath, (downloadErr) => {
      if (downloadErr) {
        console.warn('Download error:', downloadErr.message);
      }
      setTimeout(() => safeUnlink(outputPath), 2000);
    });
  });
});

app.use((err, req, res, next) => {
  console.error('Middleware error:', err.message);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
