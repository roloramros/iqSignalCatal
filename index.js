require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return res.render('login', { error: error?.message || 'Error al iniciar sesión' });
  }

  req.session.user = data.user;
  res.redirect('/panel');
});

// Registro modificado
app.post('/register', async (req, res) => {
  const { email, password, telegram_username } = req.body;

  try {
    // Registrar usuario en Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { telegram_username }
      }
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

    // Si el registro fue exitoso y tenemos el user_id
    if (data.user && data.user.id) {
      try {
        // Insertar en la tabla telegram_chat_ids
        const { error: insertError } = await supabase
          .from('telegram_chat_ids')
          .insert({
            user_id: data.user.id,
            telegram_alias: telegram_username,
            chat_id: null // Se actualizará después por el bot de Telegram
          });

        if (insertError) {
          console.error('Error al insertar en telegram_chat_ids:', insertError);
          // Opcional: podrías decidir si mostrar este error al usuario o solo loggearlo
        }
      } catch (telegramError) {
        console.error('Error al procesar datos de Telegram:', telegramError);
        // Continuar con el registro aunque falle la inserción en telegram_chat_ids
      }
    }

    res.render('register', {
      error: null,
      success: `Usuario ${email} registrado correctamente.`
    });

  } catch (error) {
    res.render('register', {
      error: error.message,
      success: null
    });
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
  const proceso = spawn('python', [scriptPath, par, fechaInicio, fechaFin]);
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

app.use(express.json());

// Dentro de index.js
app.post('/analizar-alerta', requireLogin, (req, res) => {
  const { par, fechaHora, cantidad } = req.body;
  const scriptPath = path.join(__dirname, 'scripts', 'signals_results.py');
  const proceso = spawn('python', [scriptPath, par, fechaHora, cantidad]);
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
