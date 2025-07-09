import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
import cors from 'cors';
dotenv.config();

const app = express();
const upload = multer({ dest: 'uploads/' });

// Enable CORS for the React app
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173','https://edtechh-dashboard-main-e76s.vercel.app','https://edtechh-dashboard-main-qf79.vercel.app'],
  credentials: true
}));

// Parse JSON bodies
app.use(express.json());

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

// Generate presigned URL for upload
app.post('/generate-upload-url', async (req, res) => {
  try {
    const { filename, contentType } = req.body;
    
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: filename,
      ContentType: contentType || 'application/octet-stream',
    });

    // Generate presigned URL that expires in 1 hour
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    // Return the presigned URL and the final public URL
    const baseUrl = process.env.R2_PUBLIC_URL || 'https://cdn.atulyaayurveda.shop';
    const encodedFilename = encodeURIComponent(filename);
    const publicUrl = `${baseUrl}/${encodedFilename}`;

    res.json({
      success: true,
      presignedUrl,
      publicUrl,
      filename,
      message: 'Presigned URL generated successfully'
    });
  } catch (err) {
    console.error('Error generating presigned URL:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to generate presigned URL'
    });
  }
});

// Generate presigned URL for download (if needed)
app.post('/generate-download-url', async (req, res) => {
  try {
    const { filename } = req.body;
    
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: filename,
    });

    // Generate presigned URL that expires in 1 hour
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    res.json({
      success: true,
      presignedUrl,
      filename,
      message: 'Download URL generated successfully'
    });
  } catch (err) {
    console.error('Error generating download URL:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to generate download URL'
    });
  }
});

// Serve HTML form with client-side upload
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Upload Files to Cloudflare R2</title>
        <style>
          body { font-family: sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; }
          .form-group { margin-bottom: 20px; }
          .progress { width: 100%; height: 20px; background-color: #f0f0f0; border-radius: 10px; overflow: hidden; margin: 10px 0; }
          .progress-bar { height: 100%; background-color: #4CAF50; width: 0%; transition: width 0.3s; }
          .status { margin-top: 10px; padding: 10px; border-radius: 5px; }
          .success { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
          .error { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
          .info { background-color: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
        </style>
      </head>
      <body>
        <h2>Upload Files to Cloudflare R2</h2>
        <div class="form-group">
          <input type="file" id="fileInput" required />
        </div>
        <div class="form-group">
          <button onclick="uploadFile()" id="uploadBtn">Upload</button>
        </div>
        <div class="progress" id="progressContainer" style="display: none;">
          <div class="progress-bar" id="progressBar"></div>
        </div>
        <div id="status"></div>

        <script>
          async function uploadFile() {
            const fileInput = document.getElementById('fileInput');
            const uploadBtn = document.getElementById('uploadBtn');
            const progressContainer = document.getElementById('progressContainer');
            const progressBar = document.getElementById('progressBar');
            const status = document.getElementById('status');

            const file = fileInput.files[0];
            if (!file) {
              showStatus('Please select a file', 'error');
              return;
            }

            try {
              uploadBtn.disabled = true;
              showStatus('Generating upload URL...', 'info');

              // Step 1: Get presigned URL
              const urlResponse = await fetch('/generate-upload-url', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  filename: file.name,
                  contentType: file.type
                })
              });

              const urlData = await urlResponse.json();
              if (!urlData.success) {
                throw new Error(urlData.error);
              }

              showStatus('Uploading file...', 'info');
              progressContainer.style.display = 'block';

              // Step 2: Upload directly to R2 using presigned URL
              const xhr = new XMLHttpRequest();
              
              xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                  const percentComplete = (e.loaded / e.total) * 100;
                  progressBar.style.width = percentComplete + '%';
                }
              });

              xhr.addEventListener('load', () => {
                if (xhr.status === 200) {
                                     showStatus(\`Upload successful! File URL: <a href="\${urlData.publicUrl}" target="_blank">\${urlData.publicUrl}</a>\`, 'success');
                  progressContainer.style.display = 'none';
                } else {
                  throw new Error(\`Upload failed with status: \${xhr.status}\`);
                }
              });

              xhr.addEventListener('error', () => {
                throw new Error('Upload failed');
              });

              xhr.open('PUT', urlData.presignedUrl);
              xhr.setRequestHeader('Content-Type', file.type);
              xhr.send(file);

            } catch (error) {
              console.error('Upload error:', error);
              showStatus(\`Upload failed: \${error.message}\`, 'error');
              progressContainer.style.display = 'none';
            } finally {
              uploadBtn.disabled = false;
            }
          }

          function showStatus(message, type) {
            const status = document.getElementById('status');
            status.innerHTML = message;
            status.className = 'status ' + type;
          }
        </script>
      </body>
    </html>
  `);
});

// Keep the old upload endpoint for backward compatibility
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