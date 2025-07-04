import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import cors from 'cors';
dotenv.config();

const app = express();
const upload = multer({ dest: 'uploads/' });

// Enable CORS for the React app
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true
}));

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'R2 uploader is running' });
});

// Serve HTML form (from your original code)
app.get('/', (req, res) => {
  res.send(`
    <html>
      <body style="font-family: sans-serif; padding: 40px;">
        <h2>Upload Video to Cloudflare R2</h2>
        <form action="/upload" method="post" enctype="multipart/form-data">
          <input type="file" name="file" accept="video/*" required />
          <button type="submit">Upload</button>
        </form>
      </body>
    </html>
  `);
});

// Handle video upload
app.post('/upload', upload.single('file'), async (req, res) => {
  const file = req.file;
  
  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // Check if file exists and is readable
    if (!fs.existsSync(file.path)) {
      throw new Error('Uploaded file not found on disk');
    }

    // Read file into buffer
    const fileBuffer = fs.readFileSync(file.path);

    const uploadParams = {
      Bucket: process.env.R2_BUCKET,
      Key: file.originalname,
      Body: fileBuffer,
      ContentType: file.mimetype,
    };

    const result = await s3.send(new PutObjectCommand(uploadParams));

    // Cleanup temp file
    fs.unlinkSync(file.path);

    // Return the public URL using your custom domain
    const baseUrl = process.env.R2_PUBLIC_URL || 'https://cdn.atulyaayurveda.shop';
    const encodedFilename = encodeURIComponent(file.originalname);
    const publicUrl = `${baseUrl}/${encodedFilename}`;
    
    res.json({
      success: true,
      video_url: publicUrl,
      thumbnail_url: '',
      duration: '',
      message: 'Video uploaded successfully'
    });
  } catch (err) {
    console.error('Upload error:', err);
    
    // Cleanup temp file on error
    if (file.path && fs.existsSync(file.path)) {
      try {
        fs.unlinkSync(file.path);
      } catch (cleanupErr) {
        console.error('Error cleaning up temp file:', cleanupErr);
      }
    }
    
    res.status(500).json({
      success: false,
      error: err.message || 'Upload failed'
    });
  }
});

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`R2 uploader server running at http://localhost:${PORT}`);
  console.log('Environment variables status:');
  console.log('- R2_ENDPOINT:', process.env.R2_ENDPOINT ? '✓ Set' : '✗ Missing');
  console.log('- AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID ? '✓ Set' : '✗ Missing');
  console.log('- AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY ? '✓ Set' : '✗ Missing');
  console.log('- R2_BUCKET:', process.env.R2_BUCKET ? '✓ Set' : '✗ Missing');
  console.log('- R2_PUBLIC_URL:', process.env.R2_PUBLIC_URL || 'Using fallback: https://cdn.atulyaayurveda.shop');
}); 