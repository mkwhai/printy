require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const app = express();
const PORT = process.env.PORT || 3030;

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
    } catch (e) { /* Column already exists or other error */ }

    // Init default settings
    await db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('retention_hours', '6')`);
})();

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
    callback(null, stdout, targetPrinter || 'default');
  });
};


// Auth Middleware
const checkAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!process.env.ADMIN_PASSWORD || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
        return res.status(401).json({ error: 'Brak dostępu lub błędne hasło administratora.'});
    }
    next();
};

const checkUserCode = async (req, res, next) => {
    const userCode = req.body.userCode || req.headers['x-user-code'];
    if (!userCode) return res.status(401).json({ error: 'Wymagany jest ważny PIN użytkownika, by drukować.'});
    
    const user = await db.get('SELECT * FROM users WHERE code = ?', [userCode]);
    if (!user) return res.status(403).json({ error: 'Nieprawidłowy PIN użytkownika.'});
    
    req.user = user;
    next();
};

const scheduleFileRetention = async (filePath) => {
    try {
        const setting = await db.get("SELECT value FROM settings WHERE key = 'retention_hours'");
        const hours = parseInt(setting?.value || '6', 10);
        await db.run("INSERT INTO retained_files (file_path, expires_at) VALUES (?, datetime('now', '+' || ? || ' hours'))", [filePath, hours]);
    } catch (e) {
        console.error('Błąd dodawania pliku do retencji:', e.message);
    }
};

const sendWebhookNotification = async (userName, fileName) => {
    try {
        const messageText = `🖨️ *Nowy dokument do druku (printy)!*\n👤 Użytkownik: ${userName}\n📄 Plik: ${fileName}`;
        
        // 1. WhatsApp poprzez darmowe API CallMeBot
        if (process.env.WHATSAPP_PHONE && process.env.WHATSAPP_APIKEY) {
            const phone = process.env.WHATSAPP_PHONE;
            const apiKey = process.env.WHATSAPP_APIKEY;
            const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(messageText)}&apikey=${encodeURIComponent(apiKey)}`;
            await axios.get(url);
            return; // Zakończ, jeśli pomyślnie wysłano na WhatsApp
        }

        // 2. Alternatywnie standardowy Webhook (np. Discord)
        const webhookUrl = process.env.WEBHOOK_URL;
        if (webhookUrl) {
            await axios.post(webhookUrl, {
                content: `🖨️ **Nowy dokument do druku oczekuje na moderację!**\n👤 Użytkownik: \`${userName}\`\n📄 Plik: \`${fileName}\``
            });
        }
    } catch (err) {
        console.error('Błąd powiadomienia (WhatsApp/Webhook):', err.message);
    }
};

app.post('/api/verify-pin', async (req, res) => {
    const userCode = req.body.userCode;
    if (!userCode) return res.status(400).json({ error: 'Brak PINu' });
    const user = await db.get('SELECT * FROM users WHERE code = ?', [userCode]);
    if (!user) return res.status(403).json({ error: 'Nieprawidłowy PIN' });
    res.json({ success: true, name: user.name });
});

// API: Admin endpoints
app.get('/api/admin/users', checkAdmin, async (req, res) => {
    const users = await db.all('SELECT * FROM users ORDER BY created_at DESC');
    res.json(users);
});

app.post('/api/admin/users', checkAdmin, async (req, res) => {
    const name = req.body.name || 'Gość';
    const requiresModeration = req.body.requiresModeration ? 1 : 0;
    // 6-digit PIN string
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await db.run('INSERT INTO users (name, code, requires_moderation) VALUES (?, ?, ?)', [name, code, requiresModeration]);
    res.json({ success: true, name, code, requiresModeration });
});

app.delete('/api/admin/users/:id', checkAdmin, async (req, res) => {
    await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
});

app.get('/api/admin/logs', checkAdmin, async (req, res) => {
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
app.get('/api/admin/queue', checkAdmin, async (req, res) => {
    const queue = await db.all(`
      SELECT q.*, u.name as user_name, u.code as user_code 
      FROM print_queue q
      LEFT JOIN users u ON q.user_id = u.id
      WHERE q.status = 'pending'
      ORDER BY q.created_at ASC
    `);
    res.json(queue);
});

app.get('/api/admin/settings', checkAdmin, async (req, res) => {
    const setting = await db.get("SELECT value FROM settings WHERE key = 'retention_hours'");
    res.json({ retention_hours: parseInt(setting?.value || '6', 10) });
});

app.post('/api/admin/settings', checkAdmin, async (req, res) => {
    const hours = parseInt(req.body.retention_hours, 10);
    if (!isNaN(hours) && hours > 0) {
        await db.run("UPDATE settings SET value = ? WHERE key = 'retention_hours'", [hours.toString()]);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Nieprawidlowa wartosc godzin (musi byc > 0).' });
    }
});

app.post('/api/admin/queue/:id/approve', checkAdmin, async (req, res) => {
    const job = await db.get('SELECT * FROM print_queue WHERE id = ?', [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Nie znaleziono zadania w kolejce' });

    const options = JSON.parse(job.options);
    printFile(job.file_path, job.printer, options, async (err, output, usedPrinter) => {
        // Zamiast od razu usuwać, zachowujemy do czasu retencji ustawionego w adminie
        scheduleFileRetention(job.file_path);
        
        if (err) return res.status(500).json({ error: 'Błąd drukowania', details: err.message });

        await db.run('UPDATE print_queue SET status = ? WHERE id = ?', ['approved', job.id]);
        await db.run('INSERT INTO logs (user_id, filename, printer) VALUES (?, ?, ?)', [job.user_id, job.filename, usedPrinter]);
        
        res.json({ success: true, message: 'Wydruk zatwierdzony i wykonany.' });
    });
});

app.post('/api/admin/queue/:id/reject', checkAdmin, async (req, res) => {
    const job = await db.get('SELECT * FROM print_queue WHERE id = ?', [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Nie znaleziono zadania w kolejce' });

    fs.unlink(job.file_path, () => {});
    await db.run('UPDATE print_queue SET status = ? WHERE id = ?', ['rejected', job.id]);
    
    res.json({ success: true, message: 'Zadanie odrzucone.' });
});


// API: Print uploaded file
app.post('/api/print', upload.single('file'), checkUserCode, (req, res) => {
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
  const originalName = req.file.originalname;

  if (req.user.requires_moderation) {
    // Add to Queue
    db.run(`INSERT INTO print_queue (user_id, filename, file_path, original_url, printer, options) VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, originalName, filePath, '', printerAddress, JSON.stringify(options)]
    ).then(() => {
        sendWebhookNotification(req.user.name, originalName);
        res.json({ success: true, queued: true, message: 'Plik przesłany do kolejki! Oczekuje na zatwierdzenie.' });
    }).catch(err => {
        res.status(500).json({ error: 'Błąd bazy danych.', details: err.message });
    });
  } else {
    // Direct Print
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

// API: Print from URL
app.post('/api/print-url', checkUserCode, async (req, res) => {
  const { url, printer, copies, duplex, color, layout, paperSize, pagesPerSheet, margins, pageRanges, scale, fitToPage } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'Brak adresu URL' });
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
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(filePath);
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

      if (req.user.requires_moderation) {
        db.run(`INSERT INTO print_queue (user_id, filename, file_path, original_url, printer, options) VALUES (?, ?, ?, ?, ?, ?)`,
          [req.user.id, url, filePath, url, printer, JSON.stringify(options)]
        ).then(() => {
            sendWebhookNotification(req.user.name, url);
            res.json({ success: true, queued: true, message: 'Plik z URL przesłany do kolejki! Oczekuje na zatwierdzenie.' });
        }).catch(err => res.status(500).json({ error: 'Błąd bazy danych.', details: err.message }));
      } else {
        printFile(filePath, printer, options, async (err, output, usedPrinter) => {
          scheduleFileRetention(filePath);
          
          if (err) return res.status(500).json({ error: 'Błąd podczas drukowania', details: err.message });
          
          try {
              await db.run('INSERT INTO logs (user_id, filename, printer) VALUES (?, ?, ?)', 
                  [req.user.id, url, usedPrinter]
              );
          } catch(e) { console.error('Failed to log job', e); }

          res.json({ success: true, message: 'Plik z URL wysłany do druku', output });
        });
      }
    });

    writer.on('error', (err) => {
      fs.unlink(filePath, () => {});
      res.status(500).json({ error: 'Błąd podczas pobierania pliku', details: err.message });
    });

  } catch (error) {
    res.status(500).json({ error: 'Błąd pobierania z podanego URL', details: error.message });
  }
});

// API: Get List of Printers
app.get('/api/printers', (req, res) => {
  exec('lpstat -e', (error, stdout, stderr) => {
    if (error) {
      // Jeśli brak drukarek lub błąd lpstat, zwracamy pustą listę
      return res.json({ printers: [], defaultPrinter: null });
    }
    
    const printers = stdout.trim().split('\n').filter(p => p.trim() !== '');
    
    exec('lpstat -d', (dError, dStdout) => {
      let defaultPrinter = null;
      if (!dError && dStdout.includes(': ')) {
        defaultPrinter = dStdout.split(': ')[1].trim();
      }
      res.json({ printers, defaultPrinter });
    });
  });
});

// API: Setup Local Network Printer
app.post('/api/setup-printer', checkAdmin, (req, res) => {
  const { printerName, ipAddress } = req.body;
  if (!printerName || !ipAddress) {
    return res.status(400).json({ error: 'Wymagane parametry: printerName, ipAddress' });
  }
  const command = `lpadmin -p "${printerName}" -E -v "socket://${ipAddress}:9100" -m everywhere`;
  exec(command, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: 'Nie udało się dodać drukarki', details: err.message });
    }
    res.json({ success: true, stdout, stderr });
  });
});

// Periodic Cleanup Job (every 5 minutes)
setInterval(async () => {
    if (!db) return;
    try {
        const expired = await db.all("SELECT * FROM retained_files WHERE expires_at <= datetime('now')");
        for (const file of expired) {
            fs.unlink(file.file_path, () => {});
            await db.run("DELETE FROM retained_files WHERE id = ?", [file.id]);
        }
    } catch (e) {
        console.error('Błąd podczas czyszczenia zatrzymanych plików:', e.message);
    }
}, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`printy server running on port ${PORT}`);
});
