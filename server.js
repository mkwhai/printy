const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

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
  // Options we support: copies, sides (two-sided-long-edge, etc.), fit-to-page
  const { copies = 1, duplex = false, color = false } = options;
  
  let command = `lp -n ${copies}`;
  
  // If printerAddress is provided and contains an IP, we might assume it's a temp queue or CUPS knows it.
  // We will assume printerAddress is the destination name in CUPS
  if (printerAddress && printerAddress.trim() !== '') {
    command += ` -d "${printerAddress}"`;
  }
  
  if (duplex) {
    command += ` -o sides=two-sided-long-edge`;
  } else {
    command += ` -o sides=one-sided`;
  }
  
  if (!color) {
    command += ` -o print-color-mode=monochrome`;
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
    duplex: req.body.duplex === 'true',
    color: req.body.color === 'true',
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
        duplex: duplex === true || duplex === 'true',
        color: color === true || color === 'true',
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
