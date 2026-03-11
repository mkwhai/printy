require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3030;

// Setup multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uuid = crypto.randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `${uuid}${ext}`);
  }
});
const upload = multer({ storage });

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Print logic using CUPS 'lp' command
const printFile = (filePath, printerAddress, options, callback) => {
  // printerAddress can be a CUPS queue name or an IP address (if configured in CUPS)
  // Options we support: copies, sides, color, pageRanges, scale, fitToPage
  const { 
    copies = 1, 
    layout = 'portrait',
    color = 'color',
    duplex = 'one-sided',
    paperSize = 'A4',
    pagesPerSheet = '1',
    margins = 'default',
    pageRanges = '',
    scale = '',
    fitToPage = false
  } = options;
  
  let command = `lp -n ${copies}`;
  
  const targetPrinter = printerAddress && printerAddress.trim() !== '' ? printerAddress : process.env.DEFAULT_PRINTER;
  if (targetPrinter && targetPrinter.trim() !== '') {
    command += ` -d "${targetPrinter}"`;
  }
  
  if (['one-sided', 'two-sided-long-edge', 'two-sided-short-edge'].includes(duplex)) {
    command += ` -o sides=${duplex}`;
  }
  
  if (color === 'bw') {
    command += ` -o print-color-mode=monochrome`;
  }

  if (layout === 'landscape') {
    command += ` -o orientation-requested=4`;
  }

  if (paperSize && paperSize.trim() !== '') {
    command += ` -o media=${paperSize}`;
  }

  if (pagesPerSheet && !isNaN(parseInt(pagesPerSheet)) && parseInt(pagesPerSheet) > 1) {
    command += ` -o number-up=${parseInt(pagesPerSheet)}`;
  }

  if (margins === 'none') {
    command += ` -o page-bottom=0 -o page-top=0 -o page-left=0 -o page-right=0`;
  }

  if (pageRanges && pageRanges.trim() !== '') {
    // Escape ranges just in case to prevent injection (simple cleanup)
    const cleanRanges = pageRanges.replace(/[^0-9,-]/g, '');
    if (cleanRanges) {
        command += ` -o page-ranges=${cleanRanges}`;
    }
  }

  if (fitToPage) {
    command += ` -o fit-to-page`;
  }

  if (scale && !isNaN(parseInt(scale))) {
    command += ` -o scaling=${parseInt(scale)}`;
  }
  
  command += ` "${filePath}"`;

  console.log(`Executing print command: ${command}`);
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Print error: ${error.message}`);
      return callback(error);
    }
    console.log(`Print output: ${stdout}`);
    callback(null, stdout);
  });
};

// API: Print uploaded file
app.post('/api/print', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Brak pliku' });
  }

  const printerAddress = req.body.printer;
  const options = {
    copies: parseInt(req.body.copies) || 1,
    duplex: req.body.duplex || 'one-sided',
    color: req.body.color || 'color',
    layout: req.body.layout || 'portrait',
    paperSize: req.body.paperSize || 'A4',
    pagesPerSheet: req.body.pagesPerSheet || '1',
    margins: req.body.margins || 'default',
    pageRanges: req.body.pageRanges || '',
    scale: req.body.scale || '',
    fitToPage: req.body.fitToPage === 'true'
  };

  const filePath = req.file.path;

  printFile(filePath, printerAddress, options, (err, output) => {
    // Optionally remove file after printing
    setTimeout(() => {
      fs.unlink(filePath, () => {});
    }, 60000); // clear after 1 minute

    if (err) {
      return res.status(500).json({ error: 'Błąd podczas drukowania', details: err.message });
    }
    
    res.json({ success: true, message: 'Plik wysłany do druku', output });
  });
});

// API: Print from URL
app.post('/api/print-url', async (req, res) => {
  const { url, printer, copies, duplex, color } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Brak adresu URL' });
  }

  const uploadDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const fileName = `${crypto.randomUUID()}.pdf`; // Assuming PDF for URL prints
  const filePath = path.join(uploadDir, fileName);

  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    writer.on('finish', () => {
      const options = {
        copies: parseInt(copies) || 1,
        duplex: req.body.duplex || 'one-sided',
        color: req.body.color || 'color',
        layout: req.body.layout || 'portrait',
        paperSize: req.body.paperSize || 'A4',
        pagesPerSheet: req.body.pagesPerSheet || '1',
        margins: req.body.margins || 'default',
        pageRanges: req.body.pageRanges || '',
        scale: req.body.scale || '',
        fitToPage: req.body.fitToPage === true || req.body.fitToPage === 'true'
      };

      printFile(filePath, printer, options, (err, output) => {
        setTimeout(() => fs.unlink(filePath, () => {}), 60000);
        
        if (err) {
          return res.status(500).json({ error: 'Błąd podczas drukowania', details: err.message });
        }
        res.json({ success: true, message: 'Plik z URL wysłany do druku', output });
      });
    });

    writer.on('error', (err) => {
      fs.unlink(filePath, () => {});
      res.status(500).json({ error: 'Błąd podczas pobierania pliku', details: err.message });
    });

  } catch (error) {
    res.status(500).json({ error: 'Błąd pobierania', details: error.message });
  }
});

// API: Setup Local Network Printer
// For a Docker container, often we need to configure a local printer queue
app.post('/api/setup-printer', (req, res) => {
  const { printerName, ipAddress } = req.body;
  
  if (!printerName || !ipAddress) {
    return res.status(400).json({ error: 'Wymagane parametry: printerName, ipAddress' });
  }

  // Use lpadmin to add printer (socket:// for JetDirect, ipp:// for IPP)
  // This assumes the container has CUPS running and user has lpadmin rights
  const command = `lpadmin -p "${printerName}" -E -v "socket://${ipAddress}:9100" -m everywhere`;
  
  console.log(`Setting up printer: ${command}`);
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Printer setup error: ${error.message}`);
      return res.status(500).json({ error: 'Nie udało się dodać drukarki', details: err.message });
    }
    res.json({ success: true, message: `Drukarka ${printerName} (${ipAddress}) skonfigurowana.` });
  });
});

app.listen(PORT, () => {
  console.log(`Printy server running on port ${PORT}`);
});
