const statusEl = document.getElementById('status');
const gasListEl = document.getElementById('gasList');
const sortSelect = document.getElementById('sortSelect');
const fuelFilterSelect = document.getElementById('fuelFilter');

let userLocation = null;
let stationsRaw = [];
let stationsProcessed = [];

let bestRouteLine = null;

const RADIUS_KM = 8;

/* -----------------------------------------
   APLICAR CARBURANTE PREFERIDO AL ARRANCAR
----------------------------------------- */
{
  const savedFuel = localStorage.getItem("preferredFuel");

  if (savedFuel) {
    const exists = [...fuelFilterSelect.options].some(o => o.value === savedFuel);
    if (exists) {
      fuelFilterSelect.value = savedFuel;   // ⭐ El combo arranca ya con el valor correcto
    }
  }
}

/* -----------------------------------------
   GET ADBLUE PRICE
----------------------------------------- */
function getAdBluePrice(raw) {
  for (const key in raw) {
    const normalized = key.normalize("NFKD").toLowerCase().replace(/\s+/g, "");

    // Buscar cualquier campo que contenga "adblue"
    if (normalized.includes("precioadblue")) {
      const val = raw[key].trim().replace(",", ".");
      const num = parseFloat(val);

      if (!isNaN(num) && num > 0) {
        return num;
      }
    }
  }

  return null;
}



/* -----------------------------------------
   GUARDAR CARBURANTE PREFERIDO
----------------------------------------- */
fuelFilterSelect.addEventListener("change", () => {
  localStorage.setItem("preferredFuel", fuelFilterSelect.value);
  applyFiltersAndRender();
});

/* -----------------------------------------
   MAPA LEAFLET
----------------------------------------- */
let map = L.map('map');
let markersLayer = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 45,
  spiderfyOnEveryZoom: false,
  spiderfyDistanceMultiplier: 1.4
}).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19
}).addTo(map);

document.getElementById("locateBtn").addEventListener("click", () => {
  if (!userLocation) return;

  map.setView([userLocation.lat, userLocation.lng], 16, {
    animate: true,
    duration: 0.6
  });

  if (window.cheapestMarker) {
    markersLayer.zoomToShowLayer(window.cheapestMarker);
  }
});

/* -----------------------------------------
   ICONOS
----------------------------------------- */
const gasIcon = L.icon({
  iconUrl: "icons/gas-normal.svg",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -28]
});

const gasBestIcon = L.icon({
  iconUrl: "icons/gas-best.svg",
  iconSize: [38, 38],
  iconAnchor: [19, 38],
  popupAnchor: [0, -32]
});

const userIcon = L.icon({
  iconUrl: "icons/user-location.svg",
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

/* -----------------------------------------
   UBICACIÓN
----------------------------------------- */
window.addEventListener("load", () => {
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      map.setView([userLocation.lat, userLocation.lng], 12);

      showSkeletons();
      loadStations();
    },
    () => setStatus("No se pudo obtener tu ubicación"),
    { enableHighAccuracy: true }
  );
});

sortSelect.addEventListener('change', applyFiltersAndRender);

/* -----------------------------------------
   ESTADO
----------------------------------------- */
function setStatus(msg) {
  statusEl.textContent = msg;
}

/* -----------------------------------------
   SKELETON
----------------------------------------- */
function showSkeletons() {
  gasListEl.innerHTML = "";

  for (let i = 0; i < 6; i++) {
    const sk = document.createElement("div");
    sk.className = "skeleton-card";
    sk.innerHTML = `
      <div class="skeleton" style="height: 18px; width: 60%;"></div>
      <div class="skeleton" style="height: 14px; width: 40%;"></div>
      <div class="skeleton" style="height: 12px; width: 80%;"></div>
    `;
    gasListEl.appendChild(sk);
  }
}

/* -----------------------------------------
   CARGAR GASOLINERAS
----------------------------------------- */
async function loadStations() {
  setStatus("Cargando gasolineras...");

  const url =
    "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/";

  const res = await fetch(url);
  const data = await res.json();

  let allStations = data.ListaEESSPrecio
    .map(normalizeStation)
    .filter(s => s && s.lat && s.lng);

  if (!userLocation) {
    setTimeout(loadStations, 300);
    return;
  }

  allStations = allStations.map(s => ({
    ...s,
    distanceKm: haversine(userLocation.lat, userLocation.lng, s.lat, s.lng)
  }));

  stationsRaw = allStations.filter(
    s => !isNaN(s.distanceKm) && s.distanceKm <= RADIUS_KM
  );

  processStations();
}

/* -----------------------------------------
   NORMALIZAR
----------------------------------------- */
function normalizeStation(item) {
  const lat = parseFloat(item["Latitud"].trim().replace(",", "."));
  const lng = parseFloat(item["Longitud (WGS84)"].trim().replace(",", "."));

  if (isNaN(lat) || isNaN(lng)) return null;

  return {
    id: item["IDEESS"],
    name: item["Rótulo"],
    address: `${item["Dirección"]} - ${item["Municipio"]} (${item["Provincia"]})`,
    lat,
    lng,
    raw: item
  };
}

/* -----------------------------------------
   PROCESAR
----------------------------------------- */
function processStations() {
  setStatus(`Encontradas ${stationsRaw.length} gasolineras cerca de ti`);
  sortSelect.value = "distance";
  applyFiltersAndRender();
}

/* -----------------------------------------
   FILTRAR + RENDERIZAR
----------------------------------------- */
function applyFiltersAndRender() {
  setStatus("");

  showSkeletons();

  setTimeout(() => {

    const fuelField = fuelFilterSelect.value || "Precio Gasolina 95 E5";

    stationsProcessed = stationsRaw
      .map(s => {
        let price = null;

        if (fuelField === "AdBlue") {
          price = getAdBluePrice(s.raw);
        } else {
          const rawPrice = s.raw[fuelField];
          price = rawPrice ? parseFloat(rawPrice.replace(",", ".")) : null;
        }

        return {
          ...s,
          price,
          fuelType: fuelField.replace("Precio ", "")
        };
      })
      .filter(s => s.price != null);

    if (stationsProcessed.length === 0) {
      setStatus("No hay datos de precio para este carburante en tu zona");
      gasListEl.innerHTML = "";
      markersLayer.clearLayers();
      return;
    }

    const cheapest = [...stationsProcessed].sort((a, b) => a.price - b.price)[0];

    stationsProcessed = stationsProcessed.map(s => ({
      ...s,
      isCheapest: s.id === cheapest.id
    }));

    const listWithoutCheapest = stationsProcessed.filter(
      s => s.id !== cheapest.id
    );

    if (sortSelect.value === "distance") {
      listWithoutCheapest.sort((a, b) => a.distanceKm - b.distanceKm);
    } else {
      listWithoutCheapest.sort((a, b) => a.price - b.price);
    }

    renderStations(listWithoutCheapest, cheapest);
    renderMapMarkers(cheapest);
  }, 150);
}

/* -----------------------------------------
   RENDER TARJETAS
----------------------------------------- */
function renderStations(list, cheapest) {
  gasListEl.innerHTML = '<div id="bestCard"></div>';

  const bestCardContainer = document.getElementById("bestCard");
  renderBestCard(cheapest, bestCardContainer);

  list.forEach((s, i) => {

    if (i > 0 && i % 5 === 0) {
      const ad = document.createElement("div");
      ad.innerHTML = `
        <ins class="adsbygoogle"
             style="display:block; margin: 12px 0;"
             data-ad-client="ca-pub-7902959475180328"
             data-ad-slot="2752355337"
             data-ad-format="auto"
             data-full-width-responsive="true"></ins>
      `;
      gasListEl.appendChild(ad);

      try {
        (adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) {
        console.warn("AdSense no cargó todavía:", e);
      }
    }

    const item = document.createElement("article");
    item.className = "gas-item";

    item.innerHTML = `
      <div class="gas-main">
        <div class="gas-name">${s.name}</div>
        <div class="gas-meta">Distancia: ${s.distanceKm.toFixed(2)} km</div>
        <div class="gas-address">${s.address}</div>
      </div>

      <div class="gas-actions">
        <div class="gas-price">
          ${s.price.toFixed(3)} €/L
          <div class="fuel-type">${s.fuelType}</div>
        </div>

        <a class="maps-link" href="https://www.google.com/maps?q=${s.lat},${s.lng}" target="_blank">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="#0d6efd" viewBox="0 0 16 16">
            <path d="M8 0a5.53 5.53 0 0 0-5.5 5.5c0 3.038 2.686 6.287 5.03 9.02a1 1 0 0 0 1.44 0C10.814 11.787 13.5 8.538 13.5 5.5A5.53 5.53 0 0 0 8 0zm0 7.5A2 2 0 1 1 8 3.5a2 2 0 0 1 0 4z"/>
          </svg>
        </a>
      </div>
    `;

    gasListEl.appendChild(item);
  });
}

/* -----------------------------------------
   TARJETA MÁS BARATA
----------------------------------------- */
function renderBestCard(s, container) {
  container.innerHTML = `
    <article class="gas-item best">
      
      <div class="best-header">
        <span class="best-icon">⭐</span>
        <span class="best-label">Más barata</span>
      </div>

      <div class="best-name">${s.name}</div>

      <div class="best-price">${s.price.toFixed(3)} €/L</div>

      <div class="best-distance">🚗 ${s.distanceKm.toFixed(2)} km</div>

      <div class="best-address">${s.address}</div>

      <a class="best-route-btn" 
         href="https://www.google.com/maps?q=${s.lat},${s.lng}" 
         target="_blank">
        Ruta
      </a>

    </article>
  `;
}

/* -----------------------------------------
   MARCADORES + LÍNEA
----------------------------------------- */
function renderMapMarkers(cheapest) {
  markersLayer.clearLayers();

  if (userLocation && cheapest) {
    const bounds = L.latLngBounds(
      [userLocation.lat, userLocation.lng],
      [cheapest.lat, cheapest.lng]
    );

    map.fitBounds(bounds, {
      padding: [50, 50],
      animate: true,
      duration: 0.8
    });
  }

  stationsProcessed.slice(0, 80).forEach(s => {
    const iconToUse = s.isCheapest ? gasBestIcon : gasIcon;

    const marker = L.marker([s.lat, s.lng], { icon: iconToUse })
      .bindPopup(`
        <strong>${s.name}</strong><br>
        ${s.price.toFixed(3)} €/L
      `);

    markersLayer.addLayer(marker);
  });

  if (userLocation) {
    const userMarker = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
      .bindPopup("Tu ubicación");

    userMarker.addTo(map);
  }

  if (bestRouteLine) {
    map.removeLayer(bestRouteLine);
  }

  bestRouteLine = L.polyline(
    [
      [userLocation.lat, userLocation.lng],
      [cheapest.lat, cheapest.lng]
    ],
    {
      color: "#10b981",
      weight: 4,
      opacity: 0.8,
      dashArray: "6, 8"
    }
  ).addTo(map);
}

/* -----------------------------------------
   HAVERSINE
----------------------------------------- */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = deg => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let deferredPrompt;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;

  const btn = document.getElementById("btn-instalar");
  btn.style.display = "block";

  btn.addEventListener("click", () => {
    btn.style.display = "none";
    deferredPrompt.prompt();

    deferredPrompt.userChoice.then((choice) => {
      deferredPrompt = null;
    });
  });
});
