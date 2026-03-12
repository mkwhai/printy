require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { URL } = require('url');
const net = require('net');

const app = express();
const PORT = process.env.PORT || 3030;

// --- Security Middleware ---

// Helmet: security headers (CSP, X-Frame-Options, HSTS, etc.)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdnjs.cloudflare.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "https://unpkg.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            workerSrc: ["'self'", "blob:", "https://cdnjs.cloudflare.com"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            upgradeInsecureRequests: null, // Don't force upgrade HTTP to HTTPS
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    hsts: {
        maxAge: 0, // Tell browser to clear any previous HSTS instructions for this domain/IP
    },
}));

// CORS: only same-origin by default
app.use(cors({
    origin: false, // disallow cross-origin; set to specific domain if needed
    methods: ['GET', 'POST', 'DELETE'],
}));

// Rate limiters
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zbyt wiele żądań. Spróbuj ponownie za chwilę.' },
});
app.use(globalLimiter);

const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zbyt wiele prób logowania. Spróbuj ponownie za minutę.' },
});

const printLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zbyt wiele żądań druku. Spróbuj ponownie za chwilę.' },
});

// Init SQLite DB
let db;
(async () => {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    db = await open({
      filename: path.join(dataDir, 'database.sqlite'),
      driver: sqlite3.Database
    });

    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        requires_moderation INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        filename TEXT,
        printer TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS print_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        filename TEXT,
        file_path TEXT,
        original_url TEXT,
        printer TEXT,
        options TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS retained_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT,
        expires_at DATETIME
      );
    `);

    // Add backwards compatible column
    try {
        await db.exec('ALTER TABLE users ADD COLUMN requires_moderation INTEGER DEFAULT 0;');
    } catch (e) { /* Column already exists */ }

    // Init default settings
    await db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('retention_hours', '6')`);
})();

// --- Input Validation Helpers ---

const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
];

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.txt', '.docx', '.doc', '.xlsx', '.xls'];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const validatePrinterName = (name) => {
    if (!name || typeof name !== 'string') return false;
    // Only allow alphanumeric, hyphens, underscores, dots
    return /^[a-zA-Z0-9_\-\.]{1,64}$/.test(name.trim());
};

const validateIpAddress = (ip) => {
    if (!ip || typeof ip !== 'string') return false;
    return net.isIPv4(ip.trim());
};

const isPrivateIP = (hostname) => {
    try {
        // Block private/internal IP ranges
        const parts = hostname.split('.').map(Number);
        if (parts.length !== 4 || parts.some(p => isNaN(p))) return true; // if not valid IPv4, block

        if (parts[0] === 127) return true;                          // loopback
        if (parts[0] === 10) return true;                           // 10.0.0.0/8
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
        if (parts[0] === 192 && parts[1] === 168) return true;     // 192.168.0.0/16
        if (parts[0] === 0) return true;                            // 0.0.0.0/8
        if (parts[0] === 169 && parts[1] === 254) return true;     // link-local

        return false;
    } catch {
        return true; // block on error
    }
};

const validateUrl = (urlString) => {
    try {
        const parsed = new URL(urlString);
        // Only allow http and https
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { valid: false, error: 'Dozwolone tylko protokoły HTTP i HTTPS.' };
        }
        // Block private IPs
        if (net.isIPv4(parsed.hostname) && isPrivateIP(parsed.hostname)) {
            return { valid: false, error: 'Niedozwolony adres docelowy.' };
        }
        // Block localhost variants
        if (['localhost', '0.0.0.0', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
            return { valid: false, error: 'Niedozwolony adres docelowy.' };
        }
        return { valid: true, parsed };
    } catch {
        return { valid: false, error: 'Nieprawidłowy adres URL.' };
    }
};

const sanitizeString = (str, maxLength = 100) => {
    if (!str || typeof str !== 'string') return '';
    return str.slice(0, maxLength).trim();
};

// --- Multer with security ---
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
    let ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      ext = '.pdf'; // fallback to safe extension
    }
    cb(null, `${uuid}${ext}`);
  }
});

const upload = multer({
    storage,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1,
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            return cb(new Error('Niedozwolony typ pliku.'));
        }
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            return cb(new Error('Niedozwolony typ MIME.'));
        }
        cb(null, true);
    }
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));

// --- Print logic using CUPS 'lp' command (safe: execFile) ---
const printFile = (filePath, printerAddress, options, callback) => {
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

  const args = [];

  // Copies (validate as positive integer)
  const safeCopies = Math.max(1, Math.min(100, parseInt(copies, 10) || 1));
  args.push('-n', String(safeCopies));

  // We will resolve the actual printer name right before execution to handle fallbacks
  const targetPrinter = printerAddress && printerAddress.trim() !== '' ? printerAddress : process.env.DEFAULT_PRINTER;

  // Duplex
  if (['one-sided', 'two-sided-long-edge', 'two-sided-short-edge'].includes(duplex)) {
    args.push('-o', `sides=${duplex}`);
  }

  // Color
  if (color === 'bw') {
    args.push('-o', 'print-color-mode=monochrome');
  }

  // Layout
  if (layout === 'landscape') {
    args.push('-o', 'orientation-requested=4');
  }

  // Paper size (validate: only alphanumeric)
  if (paperSize && /^[a-zA-Z0-9]{1,10}$/.test(paperSize.trim())) {
    args.push('-o', `media=${paperSize.trim()}`);
  }

  // Pages per sheet
  const safePagesPerSheet = parseInt(pagesPerSheet, 10);
  if (!isNaN(safePagesPerSheet) && safePagesPerSheet > 1 && safePagesPerSheet <= 16) {
    args.push('-o', `number-up=${safePagesPerSheet}`);
  }

  // Margins
  if (margins === 'none') {
    args.push('-o', 'page-bottom=0', '-o', 'page-top=0', '-o', 'page-left=0', '-o', 'page-right=0');
  }

  // Page ranges (strict validation)
  if (pageRanges && pageRanges.trim() !== '') {
    const cleanRanges = pageRanges.replace(/[^0-9,\-]/g, '');
    if (cleanRanges && /^[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$/.test(cleanRanges)) {
        args.push('-o', `page-ranges=${cleanRanges}`);
    }
  }

  // Fit to page
  if (fitToPage) {
    args.push('-o', 'fit-to-page');
  }

  // Scale (validate: 1-200)
  const safeScale = parseInt(scale, 10);
  if (!isNaN(safeScale) && safeScale >= 1 && safeScale <= 200) {
    args.push('-o', `scaling=${safeScale}`);
  }

  // File path (already controlled by server, but validate it's within uploads)
  const resolvedPath = path.resolve(filePath);
  const uploadsDir = path.resolve(path.join(__dirname, 'uploads'));
  if (!resolvedPath.startsWith(uploadsDir)) {
    return callback(new Error('Nieprawidłowa ścieżka pliku.'));
  }
  args.push('--', resolvedPath);
  
  // Final Printer Resolution
  execFile('lpstat', ['-e'], (err, stdout) => {
    let systemsPrinters = [];
    if (!err && stdout) {
        systemsPrinters = stdout.trim().split('\n').filter(p => p.trim() !== '');
    } else {
        console.warn(`lpstat -e failed: ${err ? err.message : 'no output'}. Proceeding without printer list.`);
    }

    let finalPrinter = targetPrinter;

    if (finalPrinter && systemsPrinters.length > 0 && !systemsPrinters.includes(finalPrinter)) {
        console.log(`Printer "${finalPrinter}" not found in CUPS. Available: [${systemsPrinters.join(', ')}]`);
        finalPrinter = systemsPrinters[0];
        console.log(`Falling back to: ${finalPrinter}`);
    }

    const finalArgs = [...args];
    if (finalPrinter && validatePrinterName(finalPrinter)) {
        const dashIndex = finalArgs.indexOf('--');
        if (dashIndex !== -1) {
            finalArgs.splice(dashIndex, 0, '-d', finalPrinter.trim());
        } else {
            finalArgs.push('-d', finalPrinter.trim());
        }
    }

    console.log(`Executing print: lp ${finalArgs.join(' ')}`);

    execFile('lp', finalArgs, (error, lpStdout, stderr) => {
        if (error) {
            console.error(`Print error: ${error.message}`);
            if (stderr) console.error(`Print stderr: ${stderr}`);
            return callback(error);
        }
        console.log(`Print output: ${lpStdout}`);
        callback(null, lpStdout, finalPrinter || 'default');
    });
  });
};


// --- Auth Middleware ---
const checkAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!process.env.ADMIN_PASSWORD || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
        return res.status(401).json({ error: 'Brak dostępu lub błędne hasło administratora.'});
    }
    next();
};

const checkUserCode = async (req, res, next) => {
    const userCode = req.body.userCode || req.headers['x-user-code'];
    if (!userCode || typeof userCode !== 'string' || !/^\d{6}$/.test(userCode)) {
        return res.status(401).json({ error: 'Wymagany jest ważny 6-cyfrowy PIN użytkownika.'});
    }

    const user = await db.get('SELECT * FROM users WHERE code = ?', [userCode]);
    if (!user) return res.status(403).json({ error: 'Nieprawidłowy PIN użytkownika.'});

    req.user = user;
    next();
};

const scheduleFileRetention = async (filePath) => {
    try {
        const setting = await db.get("SELECT value FROM settings WHERE key = 'retention_hours'");
        const hours = Math.max(1, Math.min(720, parseInt(setting?.value || '6', 10)));
        await db.run("INSERT INTO retained_files (file_path, expires_at) VALUES (?, datetime('now', '+' || ? || ' hours'))", [filePath, hours]);
    } catch (e) {
        console.error('Błąd dodawania pliku do retencji:', e.message);
    }
};

const sendWebhookNotification = async (userName, fileName) => {
    try {
        const safeName = sanitizeString(userName, 50);
        const safeFile = sanitizeString(fileName, 200);
        const messageText = `🖨️ *Nowy dokument do druku (printy)!*\n👤 Użytkownik: ${safeName}\n📄 Plik: ${safeFile}`;

        // 1. WhatsApp via CallMeBot
        if (process.env.WHATSAPP_PHONE && process.env.WHATSAPP_APIKEY) {
            const phone = process.env.WHATSAPP_PHONE;
            const apiKey = process.env.WHATSAPP_APIKEY;
            const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(messageText)}&apikey=${encodeURIComponent(apiKey)}`;
            await axios.get(url, { timeout: 10000 });
            return;
        }

        // 2. Discord webhook
        const webhookUrl = process.env.WEBHOOK_URL;
        if (webhookUrl) {
            const { valid } = validateUrl(webhookUrl);
            if (!valid) return;
            await axios.post(webhookUrl, {
                content: `🖨️ **Nowy dokument do druku oczekuje na moderację!**\n👤 Użytkownik: \`${safeName}\`\n📄 Plik: \`${safeFile}\``
            }, { timeout: 10000 });
        }
    } catch (err) {
        console.error('Błąd powiadomienia (WhatsApp/Webhook):', err.message);
    }
};

// --- API Routes ---

app.post('/api/verify-pin', authLimiter, async (req, res) => {
    const userCode = req.body.userCode;
    if (!userCode || typeof userCode !== 'string' || !/^\d{6}$/.test(userCode)) {
        return res.status(400).json({ error: 'Brak lub nieprawidłowy PIN' });
    }
    const user = await db.get('SELECT * FROM users WHERE code = ?', [userCode]);
    if (!user) return res.status(403).json({ error: 'Nieprawidłowy PIN' });
    res.json({ success: true, name: user.name });
});

// Admin endpoints
app.get('/api/admin/users', authLimiter, checkAdmin, async (req, res) => {
    const users = await db.all('SELECT * FROM users ORDER BY created_at DESC');
    res.json(users);
});

app.post('/api/admin/users', authLimiter, checkAdmin, async (req, res) => {
    const name = sanitizeString(req.body.name, 100) || 'Gość';
    const requiresModeration = req.body.requiresModeration ? 1 : 0;
    // 6-digit PIN using cryptographically secure random
    const code = crypto.randomInt(100000, 999999).toString();
    await db.run('INSERT INTO users (name, code, requires_moderation) VALUES (?, ?, ?)', [name, code, requiresModeration]);
    res.json({ success: true, name, code, requiresModeration });
});

app.delete('/api/admin/users/:id', authLimiter, checkAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) return res.status(400).json({ error: 'Nieprawidłowe ID.' });
    await db.run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true });
});

app.get('/api/admin/logs', authLimiter, checkAdmin, async (req, res) => {
    const logs = await db.all(`
      SELECT logs.*, users.name as user_name, users.code as user_code
      FROM logs
      LEFT JOIN users ON logs.user_id = users.id
      ORDER BY logs.created_at DESC
      LIMIT 100
    `);
    res.json(logs);
});

// Admin Queue endpoints
app.get('/api/admin/queue', authLimiter, checkAdmin, async (req, res) => {
    const queue = await db.all(`
      SELECT q.*, u.name as user_name, u.code as user_code
      FROM print_queue q
      LEFT JOIN users u ON q.user_id = u.id
      WHERE q.status = 'pending'
      ORDER BY q.created_at ASC
    `);
    res.json(queue);
});

app.get('/api/admin/settings', authLimiter, checkAdmin, async (req, res) => {
    const setting = await db.get("SELECT value FROM settings WHERE key = 'retention_hours'");
    res.json({ retention_hours: parseInt(setting?.value || '6', 10) });
});

app.post('/api/admin/settings', authLimiter, checkAdmin, async (req, res) => {
    const hours = parseInt(req.body.retention_hours, 10);
    if (!isNaN(hours) && hours > 0 && hours <= 720) {
        await db.run("UPDATE settings SET value = ? WHERE key = 'retention_hours'", [hours.toString()]);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Nieprawidłowa wartość godzin (musi być 1-720).' });
    }
});

app.post('/api/admin/queue/:id/approve', authLimiter, checkAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) return res.status(400).json({ error: 'Nieprawidłowe ID.' });

    const job = await db.get('SELECT * FROM print_queue WHERE id = ? AND status = ?', [id, 'pending']);
    if (!job) return res.status(404).json({ error: 'Nie znaleziono zadania w kolejce' });

    let options;
    try {
        options = JSON.parse(job.options);
    } catch {
        return res.status(400).json({ error: 'Uszkodzone opcje drukowania.' });
    }

    printFile(job.file_path, job.printer, options, async (err, output, usedPrinter) => {
        scheduleFileRetention(job.file_path);

        if (err) return res.status(500).json({ error: 'Błąd drukowania', details: err.message });

        await db.run('UPDATE print_queue SET status = ? WHERE id = ?', ['approved', job.id]);
        await db.run('INSERT INTO logs (user_id, filename, printer) VALUES (?, ?, ?)', [job.user_id, job.filename, usedPrinter]);

        res.json({ success: true, message: 'Wydruk zatwierdzony i wykonany.' });
    });
});

app.post('/api/admin/queue/:id/reject', authLimiter, checkAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) return res.status(400).json({ error: 'Nieprawidłowe ID.' });

    const job = await db.get('SELECT * FROM print_queue WHERE id = ? AND status = ?', [id, 'pending']);
    if (!job) return res.status(404).json({ error: 'Nie znaleziono zadania w kolejce' });

    fs.unlink(job.file_path, () => {});
    await db.run('UPDATE print_queue SET status = ? WHERE id = ?', ['rejected', job.id]);

    res.json({ success: true, message: 'Zadanie odrzucone.' });
});


// API: Print uploaded file
app.post('/api/print', printLimiter, upload.single('file'), checkUserCode, (req, res) => {
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
  const originalName = sanitizeString(req.file.originalname, 255);

  if (req.user.requires_moderation) {
    db.run(`INSERT INTO print_queue (user_id, filename, file_path, original_url, printer, options) VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, originalName, filePath, '', printerAddress, JSON.stringify(options)]
    ).then(() => {
        sendWebhookNotification(req.user.name, originalName);
        res.json({ success: true, queued: true, message: 'Plik przesłany do kolejki! Oczekuje na zatwierdzenie.' });
    }).catch(err => {
        res.status(500).json({ error: 'Błąd bazy danych.' });
    });
  } else {
    printFile(filePath, printerAddress, options, async (err, output, usedPrinter) => {
      scheduleFileRetention(filePath);

      if (err) return res.status(500).json({ error: 'Błąd podczas drukowania', details: err.message });

      try {
          await db.run('INSERT INTO logs (user_id, filename, printer) VALUES (?, ?, ?)',
              [req.user.id, originalName, usedPrinter]
          );
      } catch(e) { console.error('Failed to log job', e); }

      res.json({ success: true, message: 'Plik wysłany do druku', output });
    });
  }
});

// API: Print from URL (with SSRF protection)
app.post('/api/print-url', printLimiter, checkUserCode, async (req, res) => {
  const { url, printer, copies, duplex, color, layout, paperSize, pagesPerSheet, margins, pageRanges, scale, fitToPage } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Brak adresu URL' });
  }

  // Validate URL (SSRF protection)
  const urlCheck = validateUrl(url);
  if (!urlCheck.valid) {
    return res.status(400).json({ error: urlCheck.error });
  }

  const uploadDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const fileName = `${crypto.randomUUID()}.pdf`;
  const filePath = path.join(uploadDir, fileName);

  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000,
      maxContentLength: MAX_FILE_SIZE,
      maxRedirects: 3,
      // Block redirects to private IPs
      beforeRedirect: (options) => {
          try {
              const redirectUrl = new URL(options.href);
              if (net.isIPv4(redirectUrl.hostname) && isPrivateIP(redirectUrl.hostname)) {
                  throw new Error('Przekierowanie do niedozwolonego adresu.');
              }
              if (['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(redirectUrl.hostname)) {
                  throw new Error('Przekierowanie do niedozwolonego adresu.');
              }
          } catch (e) {
              throw e;
          }
      }
    });

    const writer = fs.createWriteStream(filePath);
    let downloadedBytes = 0;

    response.data.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (downloadedBytes > MAX_FILE_SIZE) {
            writer.destroy();
            response.data.destroy();
            fs.unlink(filePath, () => {});
            return res.status(400).json({ error: `Plik przekracza maksymalny rozmiar (${MAX_FILE_SIZE / 1024 / 1024} MB).` });
        }
    });

    response.data.pipe(writer);

    writer.on('finish', () => {
      const options = {
        copies: parseInt(copies) || 1,
        duplex: duplex || 'one-sided',
        color: color || 'color',
        layout: layout || 'portrait',
        paperSize: paperSize || 'A4',
        pagesPerSheet: pagesPerSheet || '1',
        margins: margins || 'default',
        pageRanges: pageRanges || '',
        scale: scale || '',
        fitToPage: fitToPage === true || fitToPage === 'true'
      };

      const safeUrl = sanitizeString(url, 500);

      if (req.user.requires_moderation) {
        db.run(`INSERT INTO print_queue (user_id, filename, file_path, original_url, printer, options) VALUES (?, ?, ?, ?, ?, ?)`,
          [req.user.id, safeUrl, filePath, safeUrl, printer, JSON.stringify(options)]
        ).then(() => {
            sendWebhookNotification(req.user.name, safeUrl);
            res.json({ success: true, queued: true, message: 'Plik z URL przesłany do kolejki! Oczekuje na zatwierdzenie.' });
        }).catch(err => res.status(500).json({ error: 'Błąd bazy danych.' }));
      } else {
        printFile(filePath, printer, options, async (err, output, usedPrinter) => {
          scheduleFileRetention(filePath);

          if (err) return res.status(500).json({ error: 'Błąd podczas drukowania', details: err.message });

          try {
              await db.run('INSERT INTO logs (user_id, filename, printer) VALUES (?, ?, ?)',
                  [req.user.id, safeUrl, usedPrinter]
              );
          } catch(e) { console.error('Failed to log job', e); }

          res.json({ success: true, message: 'Plik z URL wysłany do druku', output });
        });
      }
    });

    writer.on('error', (err) => {
      fs.unlink(filePath, () => {});
      res.status(500).json({ error: 'Błąd podczas pobierania pliku' });
    });

  } catch (error) {
    fs.unlink(filePath, () => {});
    res.status(500).json({ error: 'Błąd pobierania z podanego URL' });
  }
});

// API: Get List of Printers (safe: execFile, no user input)
app.get('/api/printers', (req, res) => {
  execFile('lpstat', ['-e'], (error, stdout, stderr) => {
    if (error) {
      return res.json({ printers: [], defaultPrinter: null });
    }

    const printers = stdout.trim().split('\n').filter(p => p.trim() !== '');

    execFile('lpstat', ['-d'], (dError, dStdout) => {
      let defaultPrinter = null;
      if (!dError && dStdout.includes(': ')) {
        defaultPrinter = dStdout.split(': ')[1].trim();
      }
      res.json({ printers, defaultPrinter });
    });
  });
});

// API: Setup Local Network Printer (safe: execFile with validated input)
app.post('/api/setup-printer', authLimiter, checkAdmin, (req, res) => {
  const { printerName, ipAddress } = req.body;

  if (!printerName || !validatePrinterName(printerName)) {
    return res.status(400).json({ error: 'Nieprawidłowa nazwa drukarki (dozwolone: litery, cyfry, myślniki, podkreślenia, max 64 znaki).' });
  }
  if (!ipAddress || !validateIpAddress(ipAddress)) {
    return res.status(400).json({ error: 'Nieprawidłowy adres IP drukarki.' });
  }

  // Use IPP protocol with driverless setup - compatible with most modern printers (inkjet & laser)
  const args = [
    '-p', printerName.trim(),
    '-E',
    '-v', `ipp://${ipAddress.trim()}/ipp/print`,
    '-m', 'everywhere'
  ];

  try {
    execFile('lpadmin', args, (error, stdout, stderr) => {
      if (error) {
        console.error(`lpadmin error: ${error.message}`);
        console.error(`lpadmin stderr: ${stderr}`);
        return res.status(500).json({ error: 'Nie udało się dodać drukarki', details: error.message, stderr });
      }
      console.log(`Printer added successfully via Socket/PXL: ${printerName}`);
      res.json({ success: true, stdout, stderr });
    });
  } catch (err) {
    console.error(`Exec error: ${err.message}`);
    res.status(500).json({ error: 'Błąd systemowy podczas wywoływania lpadmin', details: err.message });
  }
});

// Multer error handler
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: `Plik przekracza maksymalny rozmiar (${MAX_FILE_SIZE / 1024 / 1024} MB).` });
        }
        return res.status(400).json({ error: 'Błąd przesyłania pliku.' });
    }
    if (err && err.message === 'Niedozwolony typ pliku.') {
        return res.status(400).json({ error: err.message });
    }
    if (err && err.message === 'Niedozwolony typ MIME.') {
        return res.status(400).json({ error: err.message });
    }
    next(err);
});

// Periodic Cleanup Job (every 5 minutes)
setInterval(async () => {
    if (!db) return;
    try {
        const expired = await db.all("SELECT * FROM retained_files WHERE expires_at <= datetime('now')");
        for (const file of expired) {
            try {
                fs.unlinkSync(file.file_path);
            } catch (e) {
                console.error(`Nie udało się usunąć pliku ${file.file_path}:`, e.message);
            }
            await db.run("DELETE FROM retained_files WHERE id = ?", [file.id]);
        }
    } catch (e) {
        console.error('Błąd podczas czyszczenia zatrzymanych plików:', e.message);
    }
}, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`printy server running on port ${PORT}`);
});
