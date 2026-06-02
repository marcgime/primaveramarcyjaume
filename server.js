const express = require('express');
const path = require('path');
const fs = require('fs');
const { scrapeLineup } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ruta explícita para la raíz para evitar errores de tipo 'Cannot GET /'
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Crear carpeta de datos si no existe
const dataDir = path.join(__dirname, 'public', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const lineupFilePath = path.join(dataDir, 'lineup.json');

// Endpoint para obtener la lineup guardada
app.get('/api/lineup', (req, res) => {
  if (fs.existsSync(lineupFilePath)) {
    try {
      const data = fs.readFileSync(lineupFilePath, 'utf8');
      return res.json(JSON.parse(data));
    } catch (err) {
      return res.status(500).json({ error: 'Error al leer los datos de horarios.' });
    }
  } else {
    return res.json({ message: 'No hay datos guardados. Ejecuta el scraper para extraer la información.', lineup: [] });
  }
});

// Endpoint SSE (Server-Sent Events) para ejecutar el scraper y mandar logs en tiempo real
app.get('/api/scrape-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // Enviar cabeceras inmediatamente

  const sendLog = (message, status = 'info') => {
    res.write(`data: ${JSON.stringify({ message, status })}\n\n`);
  };

  sendLog('Iniciando proceso de web scraping de Primavera Sound...', 'start');

  // Redirigir console.log para capturar la salida del scraper
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (msg) => {
    originalLog(msg);
    sendLog(String(msg), 'info');
  };

  console.error = (msg) => {
    originalError(msg);
    sendLog(String(msg), 'error');
  };

  try {
    // Ejecutar el scraper
    await scrapeLineup();
    
    // Validar si se guardó el archivo
    if (fs.existsSync(lineupFilePath)) {
      const bytes = fs.statSync(lineupFilePath).size;
      sendLog(`Scraping completado con éxito. Archivo lineup.json guardado (${(bytes / 1024).toFixed(2)} KB).`, 'success');
    } else {
      sendLog('El scraper finalizó pero no se generó el archivo lineup.json de resultados.', 'warning');
    }
  } catch (err) {
    sendLog(`Error catastrófico en el scraper: ${err.message}`, 'error');
  } finally {
    // Restaurar consolas
    console.log = originalLog;
    console.error = originalError;
    
    sendLog('Proceso de scraping finalizado.', 'end');
    res.end();
  }
});

// Endpoint POST estándar por si se prefiere una llamada AJAX normal
app.post('/api/scrape', async (req, res) => {
  try {
    await scrapeLineup();
    if (fs.existsSync(lineupFilePath)) {
      const data = JSON.parse(fs.readFileSync(lineupFilePath, 'utf8'));
      return res.json({ success: true, message: 'Scraping completado con éxito.', data });
    } else {
      return res.status(500).json({ success: false, message: 'No se generó el archivo de resultados.' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Función auxiliar para generar el contenido de un archivo .ics
function generateICSContent(concerts) {
  let icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Primavera Sound Scheduler//NONSGML v1.0//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    let totalMinutes = hours * 60 + minutes;
    if (hours >= 0 && hours < 6) {
      totalMinutes += 24 * 60;
    }
    return totalMinutes;
  };

  concerts.forEach(c => {
    const parts = c.id.split('-');
    const tReal = Number(parts[parts.length - 1]);
    
    let startTimeReal = tReal;
    let durationMs = 60 * 60 * 1000; // 1 hora por defecto
    
    if (!isNaN(tReal)) {
      const startMin = parseTimeToMinutes(c.startTime);
      let endMin = parseTimeToMinutes(c.endTime);
      if (endMin < startMin) {
        endMin += 1440;
      }
      durationMs = (endMin - startMin) * 60 * 1000;
    } else {
      return;
    }

    const tEnd = startTimeReal + durationMs;
    const startDate = new Date(startTimeReal);
    const endDate = new Date(tEnd);
    
    const formatDateToICS = (date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };
    
    const startStr = formatDateToICS(startDate);
    const endStr = formatDateToICS(endDate);
    const stampStr = formatDateToICS(new Date());
    
    const uid = `event-${c.id}@primaverasound2026.com`;
    
    const escapeText = (text) => {
      if (!text) return '';
      return text
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
    };
    
    const cleanName = escapeText(c.name);
    const cleanStage = escapeText(c.stage);
    
    icsContent.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stampStr}`,
      `DTSTART:${startStr}`,
      `DTEND:${endStr}`,
      `SUMMARY:Concierto: ${cleanName}`,
      `DESCRIPTION:Concierto de ${cleanName} en Primavera Sound Barcelona 2026\\nEscenario: ${cleanStage}\\nHora: ${c.startTime} - ${c.endTime}`,
      `LOCATION:${cleanStage}\\, Parc del Fòrum\\, Barcelona`,
      'STATUS:CONFIRMED',
      'SEQUENCE:0',
      'END:VEVENT'
    );
  });

  icsContent.push('END:VCALENDAR');
  return icsContent.join('\r\n');
}

// Endpoint para descargar un evento .ics de un concierto individual
app.get('/api/calendar/event.ics', (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.status(400).send('Falta el ID del concierto');
  }

  if (fs.existsSync(lineupFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(lineupFilePath, 'utf8'));
      const concert = data.lineup.find(c => c.id === id);

      if (!concert) {
        return res.status(404).send('Concierto no encontrado');
      }

      const icsString = generateICSContent([concert]);

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${concert.name.replace(/[^a-zA-Z0-9]/g, '_')}.ics"`);
      return res.send(icsString);
    } catch (err) {
      return res.status(500).send('Error al generar el archivo de calendario');
    }
  } else {
    return res.status(404).send('Lineup no disponible. Ejecuta el scraper primero.');
  }
});

// Endpoint para descargar toda la agenda en un archivo .ics agrupado
app.get('/api/calendar/agenda.ics', (req, res) => {
  const { ids } = req.query;
  if (!ids) {
    return res.status(400).send('Falta los IDs de la agenda');
  }

  if (fs.existsSync(lineupFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(lineupFilePath, 'utf8'));
      const idList = ids.split(',');
      const concerts = data.lineup.filter(c => idList.includes(c.id));

      if (concerts.length === 0) {
        return res.status(404).send('No se encontraron conciertos de la agenda');
      }

      const icsString = generateICSContent(concerts);

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="agenda_primavera_sound_2026.ics"');
      return res.send(icsString);
    } catch (err) {
      return res.status(500).send('Error al generar el archivo de calendario global');
    }
  } else {
    return res.status(404).send('Lineup no disponible. Ejecuta el scraper primero.');
  }
});

app.listen(PORT, () => {
  console.log(`Servidor de Primavera Sound Scraper corriendo en http://localhost:${PORT}`);
});
