const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
const port = 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB file size limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only PDFs and Word documents
    if (
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimetype === 'application/msword'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Only PDF and DOCX files are allowed.'), false);
    }
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Test endpoint to check if server is running
app.get('/test', (req, res) => {
  res.status(200).json({
    status: 'Server is running correctly',
    message: 'You can use POST /parse-document to upload and parse documents'
  });
});

// Helper function to parse PDF
async function parsePdf(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('Error parsing PDF:', error);
    throw error;
  }
}

// Helper function to parse DOCX
async function parseDocx(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch (error) {
    console.error('Error parsing DOCX:', error);
    throw error;
  }
}

// Helper function to delete file
function deleteFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error(`Error deleting file ${filePath}:`, err);
        reject(err);
      } else {
        console.log(`Successfully deleted ${filePath}`);
        resolve();
      }
    });
  });
}

// Route to handle document uploads and parsing
app.post('/parse-document', (req, res) => {
  const uploadSingle = upload.single('document');
  
  uploadSingle(req, res, async (err) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(400).json({ error: err.message });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const filePath = req.file.path;
      const fileExt = path.extname(req.file.originalname).toLowerCase();
      
      let text;
      if (fileExt === '.pdf') {
        text = await parsePdf(filePath);
      } else if (fileExt === '.docx' || fileExt === '.doc') {
        text = await parseDocx(filePath);
      } else {
        throw new Error('Unsupported file format');
      }

      // Log the extracted text (temporary solution)
      console.log('Extracted text:', text);
      
      // Create a temporary file with the extracted text
      const tempFilePath = path.join(__dirname, 'temp', `${path.basename(req.file.originalname, fileExt)}-extracted.txt`);
      
      // Make sure temp directory exists
      const tempDir = path.join(__dirname, 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
      }
      
      // Write the extracted text to a file
      fs.writeFileSync(tempFilePath, text);
      
      // Delete the original uploaded file to save space
      await deleteFile(filePath);
      
      res.status(200).json({ 
        success: true, 
        message: 'Document parsed successfully',
        originalFilename: req.file.originalname,
        extractedTextPath: tempFilePath,
        textPreview: text.substring(0, 200) + '...' // Preview first 200 chars
      });
    } catch (error) {
      console.error('Error processing document:', error);
      
      // Clean up the uploaded file even if processing failed
      if (req.file && req.file.path) {
        try {
          await deleteFile(req.file.path);
        } catch (deleteError) {
          console.error('Error deleting file after processing failure:', deleteError);
        }
      }
      
      res.status(500).json({ error: error.message });
    }
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Document parser server running at http://localhost:${port}`);
  
  // Create required directories if they don't exist
  const dirs = ['uploads', 'temp'];
  dirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath);
      console.log(`Created ${dir} directory`);
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: err.message || 'Something went wrong!'
  });
});

module.exports = app;