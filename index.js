require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const axios = require('axios');
const https = require("https");
const agent = new https.Agent({ family: 4 }); // 👈 Forzar IPv4

const TELEGRAM_TOKEN = "7971141664:AAFNFXWpHePHVkaedf1F75GKUk4bHwcJ_HE";
const TELEGRAM_TOKEN_LOG = "8403266609:AAEBEnN1i72-7kYbd2dsZtEjSuhsrxkjQ7c";
const TELEGRAM_CHAT_ID = "1589398506";

const app = express();
const port = 3000;

// Conexión a Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Configuración EJS y middlewares
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'mi_clave_secreta_segura',
  resave: false,
  saveUninitialized: false
}));
app.use(express.json());

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return res.render('login', { error: error?.message || 'Error al iniciar sesión' });
  }

  req.session.user = data.user;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  try {
    // Consulta a la tabla telegram_chat_ids
    const { data: telegramData, error: telegramError } = await supabase
      .from('telegram_chat_ids')
      .select('telegram_alias')
      .eq('user_id', data.user.id)
      .single();

    let telegramAlias = "No definido";

    if (!telegramError && telegramData) {
      telegramAlias = telegramData.telegram_alias || "No definido";
    }

    // 🔔 Enviar mensaje a Telegram
    await sendTelegramMessage(`🔐 Login exitoso:\nEmail: ${email}\nTelegram: ${telegramAlias}`);
  } catch (telegramError) {
    console.error("Error enviando login a Telegram:", telegramError);
  }

  res.redirect('/panel');
});

// Función para renderizar con layout
function renderWithLayout(viewPath, options, res) {
  const view = fs.readFileSync(path.join(__dirname, 'views', viewPath), 'utf8');
  const html = ejs.render(view, options);
  const layout = fs.readFileSync(path.join(__dirname, 'views', 'layout.ejs'), 'utf8');
  const full = ejs.render(layout, { ...options, body: html });
  res.send(full);
}

// Middleware para proteger rutas
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/');
  }
  next();
}

app.use(express.static('public'));

// Rutas públicas
app.get('/', (req, res) => {
  res.render('login', { error: null });
});

app.get('/register', (req, res) => {
  res.render('register', {
    error: null,
    success: null // Añadir la variable success
  });
});



// Registro modificado
app.post('/register', async (req, res) => {
  const { email, password, telegram_username } = req.body;

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { telegram_username } }
    });

    if (error) {
      if (error.message.includes('email rate limit exceeded')) {
        return res.render('register', {
          error: 'Hemos enviado muchos emails recientemente. Por favor intenta de nuevo en 1 hora.',
          success: null
        });
      }
      throw error;
    }

    if (data.user && data.user.id) {
      try {
        await supabase.from('telegram_chat_ids').insert({
          user_id: data.user.id,
          telegram_alias: telegram_username,
          chat_id: null
        });

        // 🔔 Enviar mensaje a Telegram cuando se registre un usuario
        await sendTelegramMessage(`✅ Nuevo registro:\nEmail: ${email}\nTelegram: ${telegram_username}`);
      } catch (telegramError) {
        console.error('Error en registro de Telegram:', telegramError);
      }
    }

    res.render('register', {
      error: null,
      success: `Usuario ${email} registrado correctamente.`,
      telegramUrl: "https://t.me/iq_signalcatal_bot"
    });

  } catch (error) {
    res.render('register', {
      error: error.message,
      success: null
    });
  }
});






async function sendTelegramMessage(message) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN_LOG}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "HTML"
    });
  } catch (err) {
    console.error("❌ Error enviando mensaje a Telegram:", err.response?.data || err.message);
  }
}

app.post('/sendMessage', requireLogin, async (req, res) => {
  const { message, chatId } = req.body;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML"
    });

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error en backend al enviar mensaje:", error);
    res.status(500).json({ success: false, error: "Error enviando mensaje" });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Rutas privadas con layout
app.get('/panel', requireLogin, (req, res) => {
  renderWithLayout('panel.ejs', { user: req.session.user, title: 'Home', activePage: 'panel' }, res);
});

app.get('/patrones', requireLogin, (req, res) => {
  renderWithLayout('patrones.ejs', { user: req.session.user, title: 'Patrones', activePage: 'patrones' }, res);
});

app.get('/catalogacion', requireLogin, (req, res) => {
  renderWithLayout('catalogacion.ejs', { user: req.session.user, title: 'Catalogación', activePage: 'catalogacion' }, res);
});

app.get('/signals', requireLogin, (req, res) => {
  renderWithLayout('signals.ejs', { user: req.session.user, title: 'Panel de Señales', activePage: 'signals' }, res);
});

app.get('/backtesting', requireLogin, (req, res) => {
  renderWithLayout('backtesting.ejs', { user: req.session.user, title: 'Backtesting', activePage: 'backtesting' }, res);
});

app.post('/cargar-velas', requireLogin, (req, res) => {
  const { par, fechaInicio, fechaFin } = req.body;

  console.log(fechaInicio);



  const scriptPath = path.join(__dirname, 'scripts', 'descargar_velas.py');
  const proceso = spawn('python3', [scriptPath, par, fechaInicio, fechaFin]);
  let salida = '';
  let error = '';
  proceso.stdout.on('data', (data) => {
    salida += data.toString();
  });
  proceso.stderr.on('data', (data) => {
    error += data.toString();
  });
  proceso.on('close', (code) => {
    if (code === 0) {
      console.log('✅ Script finalizado:', salida);
      res.send("Velas cargadas correctamente.");
    } else {
      console.error('❌ Error al ejecutar script:', error);
      res.status(500).send("Error al cargar velas.");
    }
  });
});

app.post('/analizar-alerta', requireLogin, (req, res) => {
  const { par, fechaHora, cantidad } = req.body;
  const scriptPath = path.join(__dirname, 'scripts', 'signals_results.py');
  const proceso = spawn('python3', [scriptPath, par, fechaHora, cantidad]);
  let salida = '';
  let error = '';
  proceso.stdout.on('data', (data) => {
    salida += data.toString();
  });
  proceso.stderr.on('data', (data) => {
    error += data.toString();
  });
  proceso.on('close', (code) => {
    if (code === 0) {
      try {
        const velas = JSON.parse(salida);
        res.json({ success: true, velas });
      } catch (err) {
        res.status(500).json({ success: false, error: 'Error parseando salida de Python' });
      }
    } else {
      res.status(500).json({ success: false, error: error || 'Error al ejecutar script' });
    }
  });
});

app.get('/eurusd_otc', requireLogin, (req, res) => {
  renderWithLayout('otc/eurusd_otc.ejs', {
    user: req.session.user,
    title: 'Catalogacion EUR/USD OTC',
    activePage: 'eurusd_otc',
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY
  }, res);
});

app.get('/eurgbp_otc', requireLogin, (req, res) => {
  renderWithLayout('otc/eurgbp_otc.ejs', {
    user: req.session.user,
    title: 'Catalogacion EUR/GBP OTC',
    activePage: 'eurgbp_otc',
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY
  }, res);
});

app.get('/usdchf_otc', requireLogin, (req, res) => {
  renderWithLayout('otc/usdchf_otc.ejs', {
    user: req.session.user,
    title: 'Catalogacion USD/CHF OTC',
    activePage: 'usdchf_otc',
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY
  }, res);
});

app.get('/audcad_otc', requireLogin, (req, res) => {
  renderWithLayout('otc/audcad_otc.ejs', {
    user: req.session.user,
    title: 'Catalogacion AUD/CAD OTC',
    activePage: 'audcad_otc',
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY
  }, res);
});

app.get('/gbpusd_otc', requireLogin, (req, res) => {
  renderWithLayout('otc/gbpusd_otc.ejs', {
    user: req.session.user,
    title: 'Catalogacion GBP/USD OTC',
    activePage: 'gbpusd_otc',
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY
  }, res);
});

app.get('/eurusd', requireLogin, (req, res) => {
  renderWithLayout('real/eurusd.ejs', {
    user: req.session.user,
    title: 'Catalogacion EUR/USD',
    activePage: 'eurusd',
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY
  }, res);
});









// Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});