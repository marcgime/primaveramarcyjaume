const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function scrapeLineup() {
  console.log("Iniciando scraper de Primavera Sound...");
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const interceptedPath = path.join(__dirname, 'intercepted_responses.json');
  const outputPath = path.join(__dirname, 'public', 'data', 'lineup.json');

  try {
    const page = await browser.newPage();
    
    // Configurar un user agent moderno para evitar bloqueos
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Almacén para guardar respuestas JSON interesantes interceptadas
    const interceptedData = [];

    // Habilitar la interceptación de respuestas de red
    page.on('response', async (response) => {
      const url = response.url();
      const type = response.request().resourceType();
      
      if (type === 'xhr' || type === 'fetch') {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const text = await response.text();
            // Analizar si contiene la lineup
            if (url.includes('getLineupEvent') || text.includes('getLineupEvent')) {
              console.log(`[Red] Lineup de eventos GraphQL detectada e interceptada.`);
              const json = JSON.parse(text);
              interceptedData.push({ url, json });
            }
          }
        } catch (err) {
          // Ignorar errores menores
        }
      }
    });

    console.log("Navegando a la página oficial de horarios del Primavera Sound...");
    await page.goto('https://www.primaverasound.com/es/barcelona/lineup', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log("Esperando 10 segundos adicionales para la carga de scripts dinámicos...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Si interceptamos datos de red interesantes, guardarlos como log histórico
    if (interceptedData.length > 0) {
      console.log(`Se ha interceptado el tráfico oficial de la API de red.`);
      fs.writeFileSync(interceptedPath, JSON.stringify(interceptedData, null, 2));
      
      // PROCESAR Y ESTRUCTURAR LOS DATOS INTERCEPTADOS
      console.log("Extrayendo y estructurando horarios...");
      const lineupResp = interceptedData.find(item => item.url.includes('getLineupEvent'));
      
      if (lineupResp && lineupResp.json && lineupResp.json.data && lineupResp.json.data.getLineupEvent) {
        const getLineupEvent = lineupResp.json.data.getLineupEvent;
        const artists = getLineupEvent.artists || [];
        
        let venueMap = {};
        if (typeof getLineupEvent.venues === 'string') {
          venueMap = JSON.parse(getLineupEvent.venues);
        }
        
        console.log(`Encontrados ${artists.length} artistas en los datos del servidor.`);
        
        const cleanLineup = [];
        
        artists.forEach(artist => {
          const artistName = artist.artistReadableName || artist.artistName;
          const slug = artist.artistSlugName;
          
          if (artist.venues && artist.venues.length > 0) {
            artist.venues.forEach(venue => {
              const duration = venue.duration;
              const venueSlug = venue.venueSlugName;
              
              // Obtener escenario legible
              let stageName = venueSlug;
              if (venueMap[venueSlug] && venueMap[venueSlug].venueReadableName) {
                stageName = venueMap[venueSlug].venueReadableName.es || venueMap[venueSlug].venueReadableName.en || venueSlug;
              }
              if (stageName === venueSlug) {
                stageName = stageName.charAt(0).toUpperCase() + stageName.slice(1);
              }
              
              const tReal = Number(venue.dateTimeStartReal);
              const tHuman = Number(venue.dateTimeStartHuman);
              
              if (isNaN(tReal) || isNaN(tHuman)) return;
              
              // Obtener día de festival en base a la marca de tiempo dateTimeStartHuman
              const dateHuman = new Date(tHuman);
              const options = { weekday: 'long', timeZone: 'Europe/Madrid' };
              let dayName = dateHuman.toLocaleDateString('es-ES', options);
              dayName = dayName.charAt(0).toUpperCase() + dayName.slice(1); // "Jueves", etc.
              
              // Formatear horas de inicio y fin en zona horaria local de España
              const startDate = new Date(tReal);
              const endDate = new Date(tReal + (duration * 60 * 1000));
              
              const formatTimeOptions = { 
                timeZone: 'Europe/Madrid', 
                hour: '2-digit', 
                minute: '2-digit', 
                hour12: false 
              };
              
              const startTime = startDate.toLocaleTimeString('es-ES', formatTimeOptions);
              const endTime = endDate.toLocaleTimeString('es-ES', formatTimeOptions);
              
              const id = `${slug}-${venueSlug}-${tReal}`;
              
              cleanLineup.push({
                id,
                name: artistName,
                day: dayName,
                stage: stageName,
                startTime,
                endTime
              });
            });
          }
        });

        // Crear carpeta de datos si no existe
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(outputPath, JSON.stringify({ lineup: cleanLineup }, null, 2));
        console.log(`¡Proceso completado con éxito! Se guardaron ${cleanLineup.length} conciertos formateados.`);
      } else {
        console.error("Los datos interceptados no contienen el formato getLineupEvent esperado.");
      }
    } else {
      console.log("No se pudo interceptar la petición GraphQL de lineup directamente. Intentando alternativa local...");
      
      // Fallback: si por alguna razón no se interceptó (por caché u otros),
      // leemos el archivo intercepted_responses.json previamente guardado si existe
      if (fs.existsSync(interceptedPath)) {
        console.log("Usando base de datos cacheada localmente...");
        // (El backend utilizará este archivo de respaldo en caso de emergencia para evitar fallos de conexión)
      } else {
        throw new Error("No se interceptaron datos y no hay caché local de respaldo.");
      }
    }

  } catch (error) {
    console.error("Fallo durante la ejecución del scraper:", error);
    throw error;
  } finally {
    await browser.close();
    console.log("Navegador Puppeteer cerrado.");
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  scrapeLineup();
}

module.exports = { scrapeLineup };
