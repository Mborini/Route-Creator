mapboxgl.accessToken =
  "pk.eyJ1IjoibW9oYm9yaW5pIiwiYSI6ImNtMDNzajUyczAxMHYycnM0cTE4cTV4amoifQ.0KnW_JhYY7pcTx9NVVWFXg";

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v11",
  zoom: 7,
  center: [36.921516122133, 31.333221199],
});

let routeGeometry = []; // Global variable to store the combined route
let waypoints = []; // Global variable to store the waypoints
let start = []; // Global variable to store the start point
let end = []; // Global variable to store the end point
let isLoading = false; // Global variable to track loading state

// Function to validate coordinates
function validateCoordinates(coords) {
  const [lng, lat] = coords;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// Function to calculate the distance between two points
function calculateDistance(point1, point2) {
  const [lng1, lat1] = point1;
  const [lng2, lat2] = point2;
  const R = 6371e3; // Radius of the Earth in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Function to sort waypoints by nearest neighbor
function sortWaypointsByNearest(start, waypoints) {
  const sortedWaypoints = [];
  let currentPoint = start;

  while (waypoints.length > 0) {
    let nearestIndex = 0;
    let nearestDistance = calculateDistance(currentPoint, waypoints[0]);

    for (let i = 1; i < waypoints.length; i++) {
      const distance = calculateDistance(currentPoint, waypoints[i]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    const nearestWaypoint = waypoints.splice(nearestIndex, 1)[0];
    sortedWaypoints.push(nearestWaypoint);
    currentPoint = nearestWaypoint;
  }

  return sortedWaypoints;
}

// Function to call the Mapbox Directions API and get route data
async function getRoute(waypoints) {
  const coords = waypoints.map((coord) => coord.join(",")).join(";");
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!data.routes || !Array.isArray(data.routes) || data.routes.length === 0) {
      throw new Error("No route found for the given waypoints.");
    }
    return {
      geometry: data.routes[0].geometry.coordinates,
      distance: data.routes[0].distance, // Distance in meters
      duration: data.routes[0].duration, // Duration in seconds
    };
  } catch (error) {
    console.error("Error fetching route data:", error.message);
    return { geometry: [], distance: 0, duration: 0 };
  }
}

async function getRouteInChunks(start, waypoints, end) {
  const chunkSize = 25; // The maximum number of waypoints allowed per request (start + 23 waypoints + end)
  let routeGeometry = [];
  let lastPoint = start;
  let totalDistance = 0;
  let totalDuration = 0;

  for (let i = 0; i < waypoints.length; i += chunkSize - 2) {
    const chunk = waypoints.slice(i, i + chunkSize - 2);
    const chunkRoute = await getRoute([lastPoint, ...chunk, end]);

    if (chunkRoute.geometry && chunkRoute.geometry.length > 0) {
      routeGeometry = routeGeometry.concat(chunkRoute.geometry);
      lastPoint = chunkRoute.geometry[chunkRoute.geometry.length - 1];
      totalDistance += chunkRoute.distance; // Accumulate distance
      totalDuration += chunkRoute.duration; // Accumulate duration
    } else {
      console.error("Chunk route data is missing or malformed.");
    }
  }

  return {
    geometry: routeGeometry,
    distance: totalDistance,
    duration: totalDuration,
  };
}

// Function to reverse geocode coordinates to get street names and landmarks
async function reverseGeocode(coords) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${coords[0]},${coords[1]}.json?access_token=${mapboxgl.accessToken}`;
  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.features && data.features.length > 0) {
      const feature = data.features[0];
      const placeName = feature.place_name || "Unknown Place";
      const context = feature.context || [];
      const city =
        context.find((c) => c.id.includes("place"))?.text || "Unknown City";
      const country =
        context.find((c) => c.id.includes("country"))?.text ||
        "Unknown Country";
      
      return {
        placeName,
        city,
        country,
      };
    } else {
      return {
        placeName: "Unknown Place",     
        city: "Unknown City",
        country: "Unknown Country",
      };
    }
  } catch (error) {
    console.error("Error reverse geocoding:", error.message);
    return {
      placeName: "Unknown Place",     
      city: "Unknown City",
      country: "Unknown Country",
    };
  }
}

async function updateRoute() {
  const startInput = document.getElementById("start").value;
  const endInput = document.getElementById("end").value;
  const waypointsInput = document.getElementById("waypoints").value;

  const coordinatesList = document.getElementById("coordinatesList");
  const controlsDiv = document.getElementById("routeInfo");

  // Set loading state
  isLoading = true;
  coordinatesList.innerHTML = "Loading...";
  controlsDiv.innerHTML = "Loading...";

  // Parse the input coordinates
  start = startInput.split(",").map(Number).reverse();
  end = endInput.split(",").map(Number).reverse();
  waypoints = waypointsInput
    .split(";")
    .filter((point) => point.trim() !== "")
    .map((point) => point.split(",").map(Number).reverse())
    .filter(validateCoordinates);

  // Sort waypoints by nearest neighbor strategy
  waypoints = sortWaypointsByNearest(start, waypoints);

  // Get route data in chunks to handle more than 100 waypoints
  const routeData = await getRouteInChunks(start, waypoints, end);
  routeGeometry = routeData.geometry; // Update the global routeGeometry

  // Display the route on the map
  displayRoute(routeGeometry);

  // Clear inputs after updating the route
  document.getElementById("start").value = "";
  document.getElementById("end").value = "";
  document.getElementById("waypoints").value = "";

  // Remove existing markers
  document.querySelectorAll(".marker").forEach((marker) => marker.remove());

  // Add markers for start, end, and waypoints
  addMarker(
    start,
    "Start",
    "https://docs.mapbox.com/mapbox-gl-js/assets/custom_marker.png"
  );

  addMarker(
    end,
    "End",
    "https://docs.mapbox.com/mapbox-gl-js/assets/custom_marker.png"
  );

  waypoints.forEach((waypoint, index) => {
    addMarker(
      waypoint,
      `Stop ${index + 1}`,
      "https://docs.mapbox.com/mapbox-gl-js/assets/custom_marker.png"
    );
  });

  // Fit the map to the route bounds
  map.fitBounds(
    [
      [
        Math.min(...routeGeometry.map((coord) => coord[0])),
        Math.min(...routeGeometry.map((coord) => coord[1])),
      ],
      [
        Math.max(...routeGeometry.map((coord) => coord[0])),
        Math.max(...routeGeometry.map((coord) => coord[1])),
      ],
    ],
    { padding: 50 }
  );

  // Populate the coordinates list
  coordinatesList.innerHTML = "";
  addCoordinateToList(start, "Start");
  waypoints.forEach((waypoint, index) => {
    addCoordinateToList(waypoint, `Stop ${index + 1}`);
  });
  addCoordinateToList(end, "End");

  // Populate the route information with distance and duration
  controlsDiv.innerHTML = `
    <div class="route-info">
      <div class="route-info-item">
        <h4>Total Distance:</h4>
        <p>${(routeData.distance / 1000).toFixed(2)} km</p>
      </div>
      <div class="route-info-item">
        <h4>Estimated Duration:</h4>
        <p>${(routeData.duration / 60).toFixed(2)} minutes</p>
      </div>
    </div>
    <h4>Waypoints Information</h4>
  `;

  // Reverse geocode and display information for each waypoint
  for (const [index, waypoint] of waypoints.entries()) {
    const info = await reverseGeocode(waypoint);
    controlsDiv.innerHTML += `<div class="route-info-item">
    <p><strong>Stop ${index + 1}:</p> 
    <p><strong>Information :</strong> ${info.placeName}</p>
    <p><strong>City:</strong> ${info.city}</p>
    <p><strong>Country:</strong> ${info.country}</p>
  </div>`;
  }

  const startInfo = await reverseGeocode(start);
  const endInfo = await reverseGeocode(end);
  controlsDiv.innerHTML += `
    <div class="route-info-item">
      <p><strong>Start:</strong> ${startInfo.placeName}</p>
      <p><strong>City:</strong> ${startInfo.city}</p>
      <p><strong>Country:</strong> ${startInfo.country}</p>
    </div>
    <div class="route-info-item">
      <p><strong>End:</strong> ${endInfo.placeName}</p>
      <p><strong>City:</strong> ${endInfo.city}</p>
      <p><strong>Country:</strong> ${endInfo.country}</p>
    </div>
  `;

  // Clear the loading state
  isLoading = false;
}

// Function to display the route on the map
function displayRoute(route) {
  if (map.getLayer("route")) {
    map.removeLayer("route");
    map.removeSource("route");
  }

  map.addLayer({
    id: "route",
    type: "line",
    source: {
      type: "geojson",
      data: {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: route,
        },
      },
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": "#0078ff",
      "line-width": 5,
      "line-dasharray": [2, 2], // Dashed line style
    },
  });

  map.addLayer({
    id: "route-arrows",
    type: "symbol",
    source: {
      type: "geojson",
      data: {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: route,
        },
      },
    },
    layout: {
      "symbol-placement": "line",
      "text-field": "▶",
      "text-size": 30,
      "symbol-spacing": 50,
      "text-keep-upright": false,
    },
    paint: {
      "text-color": "#0078ff",
      "text-halo-color": "#ffffff",
      "text-halo-width": 2,
    },
  });
}

// Function to add a marker to the map
function addMarker(coords, label, iconUrl) {
  new mapboxgl.Marker({ className: "marker" })
    .setLngLat(coords)
    .setPopup(new mapboxgl.Popup({ offset: 25 }).setText(label))
    .addTo(map);
}

// Function to add coordinates to the list and make them clickable
function addCoordinateToList(coords, label) {
  const coordinatesList = document.getElementById("coordinatesList");

  const coordinateDiv = document.createElement("div");
  coordinateDiv.className = "coordinate-item";
  coordinateDiv.textContent = `${label}: ${coords[1].toFixed(
    6
  )}, ${coords[0].toFixed(6)}`;
  coordinateDiv.style.cursor = "pointer";
  coordinateDiv.style.backgroundColor = "#d1e7ff"; // Light blue highlight
  coordinateDiv.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.2)";

  // Add click event to focus on the map
  coordinateDiv.addEventListener("click", () => {
    map.flyTo({ center: coords, zoom: 20 });
    new mapboxgl.Popup({ offset: 25 })
      .setLngLat(coords)
      .setText(label)
      .addTo(map);
  });

  coordinatesList.appendChild(coordinateDiv);
}

// Function to generate and download KML
function exportToKML() {
  if (!routeGeometry || routeGeometry.length === 0) {
    console.error("No route available to export."); // Log the error for debugging
    Toastify({
      text: "No route available to export.",
      duration: 3000,
      gravity: "bottom", // `top` or `bottom`
      position: "left", // `left`, `center` or `right`
      backgroundColor: "#ff0000",
      stopOnFocus: true, // Prevents dismissing of toast on hover
    }).showToast();
    return;
  }

  let kml = `<?xml version="1.0" encoding="UTF-8"?>
  <kml xmlns="http://www.opengis.net/kml/2.2">
    <Document>
      <Placemark>
        <name>Route</name>
        <LineString>
          <coordinates>`;

  routeGeometry.forEach((coord) => {
    kml += `${coord[0]},${coord[1]} `;
  });

  kml += `</coordinates>
        </LineString>
      </Placemark>`;

  // Add start point to the KML
  kml += `
      <Placemark>
        <name>Start</name>
        <Point>
          <coordinates>${start[0]},${start[1]}</coordinates>
        </Point>
      </Placemark>`;

  // Add waypoints to the KML
  waypoints.forEach((waypoint, index) => {
    kml += `
      <Placemark>
        <name>Stop ${index + 1}</name>
        <Point>
          <coordinates>${waypoint[0]},${waypoint[1]}</coordinates>
        </Point>
      </Placemark>`;
  });

  // Add end point to the KML
  kml += `
      <Placemark>
        <name>End</name>
        <Point>
          <coordinates>${end[0]},${end[1]}</coordinates>
        </Point>
      </Placemark>`;

  kml += `</Document>
  </kml>`;

  const blob = new Blob([kml], {
    type: "application/vnd.google-earth.kml+xml",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "route.kml";
  a.click();
  URL.revokeObjectURL(url);
}

// Event listeners
document.getElementById("updateRoute").addEventListener("click", updateRoute);
document.getElementById("exportKML").addEventListener("click", exportToKML);
