const fs = require('fs');

if (fs.existsSync('initial_data_structure.json')) {
  const data = JSON.parse(fs.readFileSync('initial_data_structure.json', 'utf8'));
  
  console.log("=== BÚSQUEDA DE DATOS DE ARTISTAS ===");
  
  // Función para buscar recursivamente
  function traverse(obj, path = '') {
    if (!obj) return;
    
    if (Array.isArray(obj)) {
      if (obj.length > 0) {
        // Inspeccionar el primer elemento para ver si parece de lineup
        const firstEl = obj[0];
        console.log(`Array encontrado en ${path} (longitud: ${obj.length})`);
        if (firstEl && typeof firstEl === 'object') {
          console.log(`  Estructura primer elemento:`, Object.keys(firstEl));
          // Si tiene propiedades típicas
          if (firstEl.name || firstEl.title || firstEl.artist || firstEl.stage) {
            console.log(`  🌟 ¡POSIBLE CANDIDATO DE LINEUP ENCONTRADO EN: ${path}!`);
          }
        }
      }
      obj.forEach((item, idx) => {
        traverse(item, `${path}[${idx}]`);
      });
    } else if (typeof obj === 'object') {
      for (const key in obj) {
        traverse(obj[key], path ? `${path}.${key}` : key);
      }
    } else if (typeof obj === 'string') {
      if (obj.toLowerCase().includes('doja cat') || obj.toLowerCase().includes('the cure') || obj.toLowerCase().includes('parc del fòrum')) {
        console.log(`Texto coincidente encontrado en ${path}: ${obj.substring(0, 100)}`);
      }
    }
  }
  
  traverse(data);
  console.log("=====================================");
} else {
  console.log("No existe el archivo initial_data_structure.json");
}
