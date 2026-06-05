// --- PRIMAVERA SOUND PLANNER - LÓGICA DEL CLIENTE ---

document.addEventListener('DOMContentLoaded', () => {
  // Inicializar Iconos Lucide
  lucide.createIcons();

  // --- ELEMENTOS DEL DOM ---
  const runScraperBtn = document.getElementById('run-scraper-btn');
  const consoleSection = document.getElementById('console-section');
  const closeConsoleBtn = document.getElementById('close-console-btn');
  const consoleLogs = document.getElementById('console-logs');
  const scraperProgress = document.getElementById('scraper-progress');
  const progressText = document.getElementById('progress-text');

  const statTotalBands = document.getElementById('stat-total-bands');
  const statTotalStages = document.getElementById('stat-total-stages');
  const statTotalDays = document.getElementById('stat-total-days');
  const statFavoritesCount = document.getElementById('stat-favorites-count');

  const searchInput = document.getElementById('search-input');
  const stageSelect = document.getElementById('stage-select');
  const dayTabsContainer = document.getElementById('day-tabs-container');
  const lineupList = document.getElementById('lineup-list');
  const lineupLoader = document.getElementById('lineup-loader');
  const lineupEmpty = document.getElementById('lineup-empty');

  const plannerEmpty = document.getElementById('planner-empty');
  const overlapsContainer = document.getElementById('overlaps-container');
  const plannerList = document.getElementById('planner-list');
  const exportCsvBtn = document.getElementById('export-csv-btn');
  const exportIcsBtn = document.getElementById('export-ics-btn');

  // --- ESTADO DE LA APLICACIÓN ---
  let allConcerts = [];
  let favorites = [];
  let selectedDay = '';
  let selectedStage = '';
  let searchQuery = '';
  let showIncompatibilities = false;

  // --- INICIALIZACIÓN ---
  loadLineup();

  // --- BOTÓN SCRAPER EN VIVO ---
  runScraperBtn.addEventListener('click', runLiveScraper);
  closeConsoleBtn.addEventListener('click', () => {
    consoleSection.classList.add('hidden');
  });

  // --- EVENTOS DE FILTROS ---
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderLineupList();
  });

  stageSelect.addEventListener('change', (e) => {
    selectedStage = e.target.value;
    renderLineupList();
  });

  // --- EXPORTAR ---
  exportCsvBtn.addEventListener('click', exportToCSV);
  exportIcsBtn.addEventListener('click', () => {
    if (favorites.length === 0) return;
    window.location.href = `/api/calendar/agenda.ics?ids=${favorites.join(',')}`;
  });

  // --- CARGA DE DATOS DESDE EL BACKEND ---
  async function loadLineup() {
    showLoader(true);
    try {
      // Cargar favoritos: priorizar localStorage local para que sobreviva a redespliegues del servidor (Render).
      let serverFavs = [];
      try {
        const favResponse = await fetch('/api/favorites');
        if (favResponse.ok) {
          serverFavs = await favResponse.json();
        }
      } catch (favErr) {
        console.error('Error cargando favoritos del servidor:', favErr);
      }

      const localFavs = JSON.parse(localStorage.getItem('ps_favorites')) || [];

      // Sincronizar datos locales y del servidor
      if (localFavs.length > 0 && serverFavs.length === 0) {
        // El servidor se ha reiniciado/redesplegado y está vacío, pero tenemos datos locales
        favorites = localFavs;
        await syncFavoritesWithServer(localFavs);
      } else if (serverFavs.length > 0 && localFavs.length === 0) {
        // Primera carga en un nuevo dispositivo/navegador, usamos los del servidor
        favorites = serverFavs;
        localStorage.setItem('ps_favorites', JSON.stringify(favorites));
      } else if (localFavs.length > 0 && serverFavs.length > 0) {
        // Ambos tienen datos, hacemos la unión para no perder nada y sincronizamos si hay discrepancias
        const union = Array.from(new Set([...localFavs, ...serverFavs]));
        favorites = union;
        localStorage.setItem('ps_favorites', JSON.stringify(favorites));
        if (union.length !== serverFavs.length) {
          await syncFavoritesWithServer(union);
        }
      } else {
        favorites = [];
      }

      const response = await fetch('/api/lineup');
      const data = await response.json();
      
      if (data.lineup && data.lineup.length > 0) {
        allConcerts = data.lineup;
        lineupEmpty.classList.add('hidden');
        
        // Inicializar filtros
        buildDayTabs();
        buildStageDropdown();
        
        // Renderizar vistas
        renderLineupList();
        renderPlanner();
        updateStats();
      } else {
        allConcerts = [];
        lineupEmpty.classList.remove('hidden');
        lineupList.innerHTML = '';
        updateStats();
      }
    } catch (err) {
      console.error('Error cargando lineup:', err);
      appendConsoleLog(`[Error] No se pudieron cargar los horarios existentes: ${err.message}`, 'error');
    } finally {
      showLoader(false);
    }
  }

  function showLoader(show) {
    if (show) {
      lineupLoader.classList.remove('hidden');
      lineupEmpty.classList.add('hidden');
    } else {
      lineupLoader.classList.add('hidden');
    }
  }

  // --- INICIALIZADOR DE FILTROS DINÁMICOS ---
  function buildDayTabs() {
    const days = [...new Set(allConcerts.map(c => c.day))].filter(Boolean);
    // Ordenar días (Miércoles, Jueves, Viernes, Sábado, etc.)
    const dayOrder = ['miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado', 'domingo', 'lunes', 'martes'];
    days.sort((a, b) => {
      const idxA = dayOrder.indexOf(a.toLowerCase());
      const idxB = dayOrder.indexOf(b.toLowerCase());
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });

    // Mantener la primera pestaña estática de "Todos los Días"
    dayTabsContainer.innerHTML = `<button class="day-tab ${selectedDay === '' ? 'active' : ''}" data-day="">Todos los Días</button>`;
    
    days.forEach(day => {
      const button = document.createElement('button');
      button.className = `day-tab ${selectedDay === day ? 'active' : ''}`;
      button.dataset.day = day;
      button.textContent = capitalizeFirstLetter(day);
      dayTabsContainer.appendChild(button);
    });

    // Agregar event listeners a las pestañas
    const tabs = dayTabsContainer.querySelectorAll('.day-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        tabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        selectedDay = e.target.dataset.day;
        renderLineupList();
      });
    });
  }

  function buildStageDropdown() {
    const stages = [...new Set(allConcerts.map(c => c.stage))].filter(Boolean).sort();
    
    // Mantener opción inicial "Todos los escenarios"
    stageSelect.innerHTML = '<option value="">Todos los escenarios</option>';
    
    stages.forEach(stage => {
      const option = document.createElement('option');
      option.value = stage;
      option.textContent = stage;
      stageSelect.appendChild(option);
    });
  }

  // --- EJECUTOR DE SCRAPING CON SSE ---
  function runLiveScraper() {
    // Mostrar y resetear terminal
    consoleSection.classList.remove('hidden');
    consoleLogs.innerHTML = '';
    appendConsoleLog('[Sistema] Conectando con el servidor de scraping...', 'system');
    runScraperBtn.disabled = true;
    runScraperBtn.innerHTML = `<div class="spinner" style="width: 1rem; height: 1rem; border-width: 2px;"></div> Scrapeando...`;
    
    scraperProgress.style.width = '5%';
    progressText.textContent = 'Conectando...';

    // Establecer flujo SSE
    const eventSource = new EventSource('/api/scrape-stream');

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.message) {
        appendConsoleLog(data.message, data.status);
      }

      // Gestionar barra de progreso y estados de terminal
      if (data.status === 'start') {
        scraperProgress.style.width = '10%';
        progressText.textContent = 'Iniciando navegador...';
      } else if (data.message.includes('Navegando a la página')) {
        scraperProgress.style.width = '30%';
        progressText.textContent = 'Cargando web...';
      } else if (data.message.includes('Cargada la página')) {
        scraperProgress.style.width = '50%';
        progressText.textContent = 'Esperando carga dinámica...';
      } else if (data.message.includes('Extrayendo datos')) {
        scraperProgress.style.width = '70%';
        progressText.textContent = 'Procesando DOM...';
      } else if (data.message.includes('Guardado')) {
        scraperProgress.style.width = '90%';
        progressText.textContent = 'Guardando datos...';
      } else if (data.status === 'success') {
        scraperProgress.style.width = '100%';
        progressText.textContent = 'Completado';
        eventSource.close();
        finalizeScraping(true);
      } else if (data.status === 'error') {
        scraperProgress.style.width = '100%';
        progressText.textContent = 'Error';
        eventSource.close();
        finalizeScraping(false);
      } else if (data.status === 'end') {
        eventSource.close();
        finalizeScraping(true);
      }
    };

    eventSource.onerror = (err) => {
      console.error('Error en SSE:', err);
      appendConsoleLog('[Error] Conexión interrumpida o fallo del servidor.', 'error');
      eventSource.close();
      finalizeScraping(false);
    };
  }

  function finalizeScraping(success) {
    runScraperBtn.disabled = false;
    runScraperBtn.innerHTML = `<i data-lucide="play" class="btn-icon"></i> Ejecutar Scraper en Vivo`;
    lucide.createIcons();
    
    if (success) {
      appendConsoleLog('[Sistema] ¡Scraping terminado! Recargando horarios...', 'success');
      loadLineup();
    } else {
      appendConsoleLog('[Sistema] El scraping ha fallado o se ha cancelado.', 'error');
    }
  }

  function appendConsoleLog(message, type = 'info') {
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.textContent = message;
    consoleLogs.appendChild(line);
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
  }

  // --- RENDERIZADO DEL LISTADO ---
  function renderLineupList() {
    lineupList.innerHTML = '';
    
    if (allConcerts.length === 0) {
      lineupEmpty.classList.remove('hidden');
      return;
    }

    // Filtrar conciertos
    const filtered = allConcerts.filter(c => {
      const matchSearch = !searchQuery || c.name.toLowerCase().includes(searchQuery) || c.stage.toLowerCase().includes(searchQuery);
      const matchDay = !selectedDay || c.day.toLowerCase() === selectedDay.toLowerCase();
      const matchStage = !selectedStage || c.stage.toLowerCase() === selectedStage.toLowerCase();
      return matchSearch && matchDay && matchStage;
    });

    if (filtered.length === 0) {
      lineupList.innerHTML = `
        <div class="empty-state">
          <i data-lucide="search-code" class="empty-icon"></i>
          <h3>Sin resultados</h3>
          <p>No se encontraron conciertos que coincidan con los filtros actuales.</p>
        </div>`;
      lucide.createIcons();
      return;
    }

    // Ordenar cronológicamente (usando nuestro truco del festival de sumarle 24h a las horas de madrugada < 06:00)
    filtered.sort((a, b) => {
      // Ordenar por día primero si mostramos todos
      if (selectedDay === '') {
        const days = ['miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado', 'domingo', 'lunes', 'martes'];
        const dayDiff = days.indexOf(a.day.toLowerCase()) - days.indexOf(b.day.toLowerCase());
        if (dayDiff !== 0) return dayDiff;
      }
      
      const timeA = parseTimeToMinutes(a.startTime);
      const timeB = parseTimeToMinutes(b.startTime);
      return timeA - timeB;
    });

    // Obtener IDs de conciertos que tienen conflicto para marcarlos visualmente
    const conflictingIds = getConflictingIds();

    filtered.forEach(c => {
      const isFav = favorites.includes(c.id);
      const hasConflict = conflictingIds.includes(c.id);
      
      const card = document.createElement('div');
      card.className = `concert-card ${isFav ? 'favorited' : ''} ${hasConflict && isFav ? 'has-collision' : ''}`;
      card.innerHTML = `
        <div class="concert-info-side">
          <div class="concert-meta">
            <span class="badge ${getStageColorClass(c.stage)} stage-link" data-stage="${c.stage}">${c.stage}</span>
            <span class="concert-time">
              <i data-lucide="clock"></i>
              ${c.startTime} - ${c.endTime} (${capitalizeFirstLetter(c.day)})
            </span>
          </div>
          <div class="concert-name">${c.name}</div>
        </div>
        <div class="concert-actions-side">
          <button class="btn-fav ${isFav ? 'active' : ''}" data-id="${c.id}" title="${isFav ? 'Quitar de mi agenda' : 'Agregar a mi agenda'}">
            <i data-lucide="heart" style="fill: ${isFav ? 'currentColor' : 'none'};"></i>
          </button>
        </div>
      `;

      // Event listener para el botón de favorito
      const favBtn = card.querySelector('.btn-fav');
      favBtn.addEventListener('click', () => toggleFavorite(c.id));

      lineupList.appendChild(card);
    });

    lucide.createIcons();
  }

  // --- FUNCIÓN DE SINCRONIZACIÓN CON EL SERVIDOR ---
  async function syncFavoritesWithServer(favs) {
    try {
      await fetch('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ favorites: favs })
      });
    } catch (err) {
      console.error('Error al sincronizar favoritos con el servidor:', err);
    }
  }

  // --- CONTROLADOR DE FAVORITOS ---
  async function toggleFavorite(id) {
    const index = favorites.indexOf(id);
    if (index === -1) {
      favorites.push(id);
    } else {
      favorites.splice(index, 1);
    }
    
    // Guardar en localStorage local como copia de seguridad/redundancia
    localStorage.setItem('ps_favorites', JSON.stringify(favorites));
    
    // Sincronizar con el servidor
    await syncFavoritesWithServer(favorites);
    
    renderLineupList();
    renderPlanner();
    updateStats();
  }

  // --- PLANIFICADOR Y DETECTOR DE COLISIONES ---
  function renderPlanner() {
    plannerList.innerHTML = '';
    overlapsContainer.innerHTML = '';

    if (favorites.length === 0) {
      plannerEmpty.classList.remove('hidden');
      exportCsvBtn.disabled = true;
      exportIcsBtn.disabled = true;
      return;
    }

    plannerEmpty.classList.add('hidden');
    exportCsvBtn.disabled = false;
    exportIcsBtn.disabled = false;

    // Obtener los objetos completos de favoritos
    const favConcerts = allConcerts.filter(c => favorites.includes(c.id));

    // 1. Detectar colisiones entre favoritos
    const collisions = findCollisions(favConcerts);
    
    // Renderizar alertas de colisión
    if (collisions.length > 0) {
      const summaryCard = document.createElement('div');
      summaryCard.className = 'overlaps-summary-card';
      
      const text = collisions.length === 1 
        ? `Se ha detectado 1 incompatibilidad de horarios.`
        : `Se han detectado ${collisions.length} incompatibilidades de horarios.`;
        
      summaryCard.innerHTML = `
        <div class="overlaps-summary-info">
          <i data-lucide="alert-triangle" class="overlap-icon-warning"></i>
          <span>${text}</span>
        </div>
        <button id="toggle-incompatibilities-btn" class="btn-warning-sm">
          ${showIncompatibilities ? 'Cerrar incompatibilidades' : 'Abrir incompatibilidades'}
        </button>
      `;
      overlapsContainer.appendChild(summaryCard);

      const listContainer = document.createElement('div');
      listContainer.className = `incompatibilities-list ${showIncompatibilities ? '' : 'hidden'}`;
      
      collisions.forEach(col => {
        const alert = document.createElement('div');
        alert.className = 'overlap-alert-card';
        alert.innerHTML = `
          <i data-lucide="alert-triangle" class="overlap-icon"></i>
          <div class="overlap-desc">
            <strong>Solapamiento detectado!</strong> 
            El ${capitalizeFirstLetter(col.day)}: <strong>${col.concert1.name}</strong> (${col.concert1.startTime}-${col.concert1.endTime} en <span class="stage-link" data-stage="${col.concert1.stage}">${col.concert1.stage}</span>) y 
            <strong>${col.concert2.name}</strong> (${col.concert2.startTime}-${col.concert2.endTime} en <span class="stage-link" data-stage="${col.concert2.stage}">${col.concert2.stage}</span>) coinciden en su horario.
          </div>
        `;
        listContainer.appendChild(alert);
      });
      overlapsContainer.appendChild(listContainer);

      const toggleBtn = summaryCard.querySelector('#toggle-incompatibilities-btn');
      toggleBtn.addEventListener('click', () => {
        showIncompatibilities = !showIncompatibilities;
        if (showIncompatibilities) {
          listContainer.classList.remove('hidden');
          toggleBtn.textContent = 'Cerrar incompatibilidades';
        } else {
          listContainer.classList.add('hidden');
          toggleBtn.textContent = 'Abrir incompatibilidades';
        }
      });
    }

    // 2. Agrupar favoritos por día
    const grouped = favConcerts.reduce((acc, curr) => {
      if (!acc[curr.day]) acc[curr.day] = [];
      acc[curr.day].push(curr);
      return acc;
    }, {});

    // Ordenar los días para la agenda
    const days = Object.keys(grouped);
    const dayOrder = ['miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado', 'domingo', 'lunes', 'martes'];
    days.sort((a, b) => dayOrder.indexOf(a.toLowerCase()) - dayOrder.indexOf(b.toLowerCase()));

    // Renderizar cada grupo de día
    days.forEach(day => {
      const dayGroup = document.createElement('div');
      dayGroup.className = 'planner-day-group';
      
      const dayTitle = document.createElement('div');
      dayTitle.className = 'planner-day-title';
      dayTitle.textContent = capitalizeFirstLetter(day);
      dayGroup.appendChild(dayTitle);

      const itemsList = document.createElement('div');
      itemsList.className = 'planner-list';

      // Ordenar conciertos del día por hora de inicio
      const dayConcerts = grouped[day];
      dayConcerts.sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));

      dayConcerts.forEach(c => {
        // Verificar si este concierto específico tiene conflicto
        const hasCollision = collisions.some(col => col.concert1.id === c.id || col.concert2.id === c.id);
        
        const item = document.createElement('div');
        item.className = `planner-item ${hasCollision ? 'has-collision' : ''}`;
        item.innerHTML = `
          <div class="planner-item-info">
            <span class="planner-item-name">${c.name}</span>
            <div class="planner-item-meta">
              <span class="planner-item-time">${c.startTime} - ${c.endTime}</span>
              <span>•</span>
              <span class="planner-item-stage stage-link" data-stage="${c.stage}">${c.stage}</span>
            </div>
          </div>
          <div class="planner-item-actions">
            <button class="planner-item-calendar" data-id="${c.id}" title="Añadir al calendario del iPhone">
              <i data-lucide="calendar-plus" style="width: 0.95rem; height: 0.95rem;"></i>
            </button>
            <button class="planner-item-remove" data-id="${c.id}" title="Quitar de mi agenda">
              <i data-lucide="trash-2" style="width: 0.95rem; height: 0.95rem;"></i>
            </button>
          </div>
        `;

        item.querySelector('.planner-item-calendar').addEventListener('click', () => {
          window.location.href = `/api/calendar/event.ics?id=${c.id}`;
        });

        item.querySelector('.planner-item-remove').addEventListener('click', () => {
          toggleFavorite(c.id);
        });

        itemsList.appendChild(item);
      });

      dayGroup.appendChild(itemsList);
      plannerList.appendChild(dayGroup);
    });

    lucide.createIcons();
  }

  // --- MOTOR DE DETECCIÓN DE SOLAPAMIENTOS ---
  function findCollisions(concerts) {
    const collisions = [];
    
    // Comparar cada pareja de conciertos
    for (let i = 0; i < concerts.length; i++) {
      for (let j = i + 1; j < concerts.length; j++) {
        const c1 = concerts[i];
        const c2 = concerts[j];

        // Solo pueden colisionar si ocurren el mismo día
        if (c1.day.toLowerCase() === c2.day.toLowerCase()) {
          const start1 = parseTimeToMinutes(c1.startTime);
          const end1 = parseTimeToMinutes(c1.endTime);
          const start2 = parseTimeToMinutes(c2.startTime);
          const end2 = parseTimeToMinutes(c2.endTime);

          // Formula de overlap: start1 < end2 AND start2 < end1
          if (start1 < end2 && start2 < end1) {
            collisions.push({
              day: c1.day,
              concert1: c1,
              concert2: c2
            });
          }
        }
      }
    }
    return collisions;
  }

  // Obtener una lista plana de todos los IDs en conflicto
  function getConflictingIds() {
    if (favorites.length === 0) return [];
    const favConcerts = allConcerts.filter(c => favorites.includes(c.id));
    const collisions = findCollisions(favConcerts);
    const ids = new Set();
    collisions.forEach(col => {
      ids.add(col.concert1.id);
      ids.add(col.concert2.id);
    });
    return Array.from(ids);
  }

  // --- UTILIDADES ---

  // Convierte "HH:MM" a minutos del día. Truco: si es de madrugada (< 06:00) le sumamos 1440m (24 horas)
  function parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    let totalMinutes = hours * 60 + minutes;
    
    // Si la hora es de madrugada, consideramos que es parte del día del festival
    if (hours >= 0 && hours < 6) {
      totalMinutes += 24 * 60;
    }
    return totalMinutes;
  }

  function updateStats() {
    statTotalBands.textContent = allConcerts.length;
    
    const stages = [...new Set(allConcerts.map(c => c.stage))].filter(Boolean);
    statTotalStages.textContent = stages.length;
    
    const days = [...new Set(allConcerts.map(c => c.day))].filter(Boolean);
    statTotalDays.textContent = days.length;
    
    statFavoritesCount.textContent = favorites.length;
  }

  function getStageColorClass(stageName) {
    const lower = stageName.toLowerCase();
    if (lower.includes('amazon') || lower.includes('main') || lower.includes('escenario 1') || lower.includes('estrella')) {
      return 'badge-neon';
    } else if (lower.includes('cupra') || lower.includes('bits') || lower.includes('pull') || lower.includes('escenario 2')) {
      return 'badge-pink';
    } else {
      return 'badge-cyan';
    }
  }

  function capitalizeFirstLetter(string) {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  // --- EXPORTACIÓN DE DATOS ---
  function exportToCSV() {
    const favConcerts = allConcerts.filter(c => favorites.includes(c.id));
    if (favConcerts.length === 0) return;

    // Cabeceras de CSV
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Grupo,Dia,Escenario,Hora Inicio,Hora Fin\n";

    // Contenido
    favConcerts.forEach(c => {
      const row = [
        `"${c.name.replace(/"/g, '""')}"`,
        `"${c.day}"`,
        `"${c.stage.replace(/"/g, '""')}"`,
        `"${c.startTime}"`,
        `"${c.endTime}"`
      ].join(",");
      csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "agenda_primavera_sound_2026.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }



  // --- LÓGICA DE POPUP DE MAPA Y ZOOM ---
  const mapModal = document.getElementById('map-modal');
  const modalStageName = document.getElementById('modal-stage-name');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const mapViewport = document.getElementById('map-viewport');
  const mapZoomContainer = document.getElementById('map-zoom-container');
  const mapCanvas = document.getElementById('map-canvas');
  const mapLoader = document.getElementById('map-loader');

  let pdfDoc = null;
  let scale = 1;
  let translateX = 0;
  let translateY = 0;

  // Lógica de carga de PDF
  async function openMapPopup(stageName) {
    modalStageName.textContent = stageName;
    mapModal.classList.remove('hidden');
    // Forzar reflow para animación
    void mapModal.offsetWidth;
    mapModal.classList.add('active');

    if (!pdfDoc) {
      mapLoader.classList.remove('hidden');
      try {
        // Inicializar worker de PDF.js
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
        
        pdfDoc = await pdfjsLib.getDocument('/data/mapaprimavera.pdf').promise;
        const page = await pdfDoc.getPage(1);
        
        const ctx = mapCanvas.getContext('2d');
        const viewportForRender = page.getViewport({ scale: 2.0 }); // 2x para nitidez
        
        mapCanvas.width = viewportForRender.width;
        mapCanvas.height = viewportForRender.height;
        
        const renderContext = {
          canvasContext: ctx,
          viewport: viewportForRender
        };
        
        await page.render(renderContext).promise;
        mapLoader.classList.add('hidden');
        resetZoomAndPan();
      } catch (err) {
        console.error('Error al renderizar el mapa PDF:', err);
        mapLoader.innerHTML = `<p class="log-line error" style="padding: 1rem;">No se pudo cargar el mapa: ${err.message}</p>`;
      }
    } else {
      resetZoomAndPan();
    }
  }

  function closeMapPopup() {
    mapModal.classList.remove('active');
    setTimeout(() => {
      if (!mapModal.classList.contains('active')) {
        mapModal.classList.add('hidden');
      }
    }, 300);
  }

  function resetZoomAndPan() {
    if (!mapCanvas.width) return;
    
    const vw = mapViewport.clientWidth;
    const vh = mapViewport.clientHeight;
    const cw = mapCanvas.width;
    const ch = mapCanvas.height;
    
    // Escala para ajustar todo el canvas
    const scaleX = vw / cw;
    const scaleY = vh / ch;
    scale = Math.min(scaleX, scaleY) * 0.95;
    
    // Centrar canvas en viewport
    translateX = (vw - cw * scale) / 2;
    translateY = (vh - ch * scale) / 2;
    
    applyTransform();
  }

  function applyTransform() {
    mapZoomContainer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  }

  // Event Listeners de Cierre
  closeModalBtn.addEventListener('click', closeMapPopup);
  mapModal.addEventListener('click', (e) => {
    if (e.target === mapModal) {
      closeMapPopup();
    }
  });

  // Delegación de eventos para clics en escenarios
  document.addEventListener('click', (e) => {
    const stageLink = e.target.closest('.stage-link');
    if (stageLink) {
      e.preventDefault();
      e.stopPropagation();
      const stageName = stageLink.dataset.stage;
      openMapPopup(stageName);
    }
  });

  // --- CONTROLES DE ZOOM Y PAN PARA ESCRITORIO (MOUSE) ---
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  mapViewport.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Solo clic izquierdo
    isDragging = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
    mapViewport.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      mapViewport.style.cursor = 'grab';
    }
  });

  // Zoom con rueda del ratón
  mapViewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomIntensity = 0.08;
    const rect = mapViewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const oldScale = scale;
    
    if (e.deltaY < 0) {
      scale += scale * zoomIntensity;
    } else {
      scale -= scale * zoomIntensity;
    }
    
    // Limitar zoom
    scale = Math.min(Math.max(scale, 0.1), 8);
    
    // Zoom hacia la posición del ratón
    translateX = mouseX - (mouseX - translateX) * (scale / oldScale);
    translateY = mouseY - (mouseY - translateY) * (scale / oldScale);
    
    applyTransform();
  }, { passive: false });

  // --- CONTROLES TÁCTILES PARA MÓVIL (PAN & PINCH-TO-ZOOM) ---
  let touchStartDist = 0;
  let touchStartScale = 1;
  let touchStartMidX = 0;
  let touchStartMidY = 0;
  let touchStartTranslateX = 0;
  let touchStartTranslateY = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let isPanning = false;
  let isPinching = false;

  mapViewport.addEventListener('touchstart', (e) => {
    const rect = mapViewport.getBoundingClientRect();
    
    if (e.touches.length === 1) {
      isPanning = true;
      isPinching = false;
      touchStartX = e.touches[0].clientX - translateX;
      touchStartY = e.touches[0].clientY - translateY;
    } else if (e.touches.length === 2) {
      isPinching = true;
      isPanning = false;
      
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      
      touchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      touchStartScale = scale;
      
      touchStartMidX = ((t1.clientX + t2.clientX) / 2) - rect.left;
      touchStartMidY = ((t1.clientY + t2.clientY) / 2) - rect.top;
      
      touchStartTranslateX = translateX;
      touchStartTranslateY = translateY;
    }
  }, { passive: true });

  mapViewport.addEventListener('touchmove', (e) => {
    const rect = mapViewport.getBoundingClientRect();
    
    if (isPanning && e.touches.length === 1) {
      translateX = e.touches[0].clientX - touchStartX;
      translateY = e.touches[0].clientY - touchStartY;
      applyTransform();
    } else if (isPinching && e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      if (touchStartDist > 0) {
        const oldScale = scale;
        const factor = dist / touchStartDist;
        scale = touchStartScale * factor;
        
        // Limitar zoom
        scale = Math.min(Math.max(scale, 0.1), 8);
        
        const midX = ((t1.clientX + t2.clientX) / 2) - rect.left;
        const midY = ((t1.clientY + t2.clientY) / 2) - rect.top;
        
        translateX = midX - (midX - touchStartTranslateX) * (scale / touchStartScale);
        translateY = midY - (midY - touchStartTranslateY) * (scale / touchStartScale);
        
        applyTransform();
      }
    }
  }, { passive: true });

  mapViewport.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      isPanning = false;
      isPinching = false;
    } else if (e.touches.length === 1) {
      isPanning = true;
      isPinching = false;
      touchStartX = e.touches[0].clientX - translateX;
      touchStartY = e.touches[0].clientY - translateY;
    }
  });

  // Reajustar al cambiar tamaño de pantalla
  window.addEventListener('resize', resetZoomAndPan);
});
